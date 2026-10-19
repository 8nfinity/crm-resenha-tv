import { prisma } from "@/lib/db";
import { leadAutomatico, recalculateScore } from "@/lib/deals";
import { evolution } from "@/lib/evolution/client";
import { isPersonJid, jidAlternativo } from "@/lib/evolution/parse";
import type { EvolutionChat } from "@/lib/evolution/types";
import { ingestMessages, upsertContact } from "@/lib/ingest";
import { mesclarContatos } from "@/lib/mesclar-contatos";
import { avisarMudanca } from "@/lib/eventos";
import { registrarEventoDeConexao } from "@/lib/eventos-conexao";
import { emFila } from "@/lib/fila";
import { descobrirPessoa, formaConhecidaDoTelefone, pessoaPelaFoto } from "@/lib/identidade-contato";

/**
 * Varredura de segurança: busca na Evolution o que o webhook não entregou.
 *
 * O webhook é o caminho rápido (a mensagem aparece em menos de um segundo),
 * mas ele falha em silêncio quando o CRM está reiniciando (toda publicação na
 * Railway reinicia), quando a Evolution reinicia, ou quando o endereço do
 * webhook fica errado. O que chega nesses intervalos se perderia para sempre.
 *
 * A cada minuto, para cada número conectado: pergunta quais conversas tiveram
 * atividade desde a última varredura, busca as mensagens mais recentes delas e
 * grava o que faltar. Gravar é idempotente (a chave é o id da mensagem), então
 * repetir uma mensagem que o webhook já trouxe não duplica nada.
 */

/** Folga para trás na janela: relógios da Evolution e do CRM não batem exato. */
const FOLGA_MS = 2 * 60 * 1000;
/** Conversas por varredura — uma volta longa (CRM ficou dias fora) se divide em várias. */
const MAX_CONVERSAS_POR_VOLTA = 40;
const MENSAGENS_POR_CONVERSA = 30;

/** Último momento com atividade numa conversa, pelo que a Evolution informa. */
export function atividadeDoChat(chat: EvolutionChat): number {
  const atualizado = chat.updatedAt ? Date.parse(chat.updatedAt) : 0;
  const ts = chat.lastMessage?.messageTimestamp;
  const n = typeof ts === "string" ? Number.parseInt(ts, 10) : (ts ?? 0);
  const ultimaMsg = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : 0;
  return Math.max(Number.isFinite(atualizado) ? atualizado : 0, ultimaMsg);
}

/**
 * Conversas de pessoas (não grupos) com atividade desde `desde`, da mais
 * recente para a mais antiga, limitadas a `limite`.
 */
export function chatsComAtividade(chats: EvolutionChat[], desde: number, limite = MAX_CONVERSAS_POR_VOLTA) {
  return chats
    .map((c) => ({ jid: c.remoteJid ?? c.id ?? "", quando: atividadeDoChat(c), chat: c }))
    .filter((c) => c.jid && isPersonJid(c.jid) && c.quando >= desde - FOLGA_MS)
    .sort((a, b) => b.quando - a.quando)
    .slice(0, limite);
}

// Estado na memória do processo: até onde cada conta já foi varrida, e
// quando cada contato "só LID" foi conferido fora da rotina.
const global_ = globalThis as unknown as {
  crmVarredura?: { desde: Map<string, number>; rodando: boolean };
  crmUnificacaoLid?: Map<string, number>;
};
const estado = (global_.crmVarredura ??= { desde: new Map(), rodando: false });
const conferidoEm = (global_.crmUnificacaoLid ??= new Map<string, number>());

/**
 * Ponto de partida de uma conta: a mensagem mais recente que o CRM já tem
 * dela. É o que faz o CRM recuperar, ao subir, tudo o que chegou enquanto
 * estava fora do ar.
 */
async function pontoDePartida(accountId: string): Promise<number> {
  const ultima = await prisma.message.findFirst({
    where: { contact: { accountId } },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  return ultima ? ultima.timestamp.getTime() : Date.now() - 24 * 60 * 60 * 1000;
}

export type ResultadoVarredura = {
  conta: string;
  status: string;
  conversasVistas: number;
  mensagensNovas: number;
  leadsAfetados: number;
};

/** Varre uma conta. Devolve o que encontrou (para log e teste). */
export async function varrerConta(conta: { id: string; instanceName: string; status: string }): Promise<ResultadoVarredura> {
  const resultado: ResultadoVarredura = {
    conta: conta.instanceName,
    status: conta.status,
    conversasVistas: 0,
    mensagensNovas: 0,
    leadsAfetados: 0,
  };

  // O estado de verdade vem da Evolution: o evento de conexão do webhook
  // também pode se perder, e a tela precisa saber se o WhatsApp caiu.
  const status = await evolution.connectionState(conta.instanceName).catch(() => "unknown");
  resultado.status = status;
  if (status !== conta.status && status !== "unknown") {
    await prisma.whatsAppAccount.update({ where: { id: conta.id }, data: { status } });
    if (status === "open" || status === "close") {
      await registrarEventoDeConexao(conta.id, status).catch(() => {});
    }
    avisarMudanca({ dealIds: [], motivo: "conexao" });
  }
  if (status !== "open") return resultado;

  const desde = estado.desde.get(conta.id) ?? (await pontoDePartida(conta.id));
  const inicioDaVolta = Date.now();
  // Só a janela desde a última volta: pedir a lista inteira a cada minuto
  // fazia a Evolution varrer TODAS as mensagens do número (ela não tem índice
  // por conversa) — e ela ficava mais lenta a cada semana de mensagens.
  const inicioDaJanela = new Date(desde - FOLGA_MS);
  const janela = { desde: inicioDaJanela, ate: new Date(Date.now() + FOLGA_MS) };
  const chats = chatsComAtividade(await evolution.findChats(conta.instanceName, janela), desde);
  resultado.conversasVistas = chats.length;

  const afetados = new Set<string>();
  for (const { jid, chat } of chats) {
    try {
      const mensagens = await evolution.findMessages(conta.instanceName, jid, MENSAGENS_POR_CONVERSA, {
        desde: inicioDaJanela,
      });
      if (mensagens.length === 0) continue;

      // O nome vem de uma mensagem DELE (a sua traria o seu próprio nome).
      const pushName =
        mensagens.find((m) => m.key?.fromMe === false)?.pushName ?? chat.pushName ?? null;
      const alt = mensagens.map(jidAlternativo).find(Boolean) ?? null;
      const contato = await upsertContact({ accountId: conta.id, waJid: jid, alt, pushName });
      if (contato.ignoredAt) continue; // número marcado para ignorar

      const novas = await ingestMessages(contato.id, mensagens);
      if (novas === 0) continue;

      resultado.mensagensNovas += novas;
      const deal = await leadAutomatico(contato.id);
      if (!deal) continue; // número só com etiqueta: guarda a conversa, sem lead
      await recalculateScore(deal.id);
      afetados.add(deal.id);
    } catch (error) {
      console.warn(`Varredura: conversa ${jid} falhou —`, (error as Error).message);
    }
  }

  resultado.leadsAfetados = afetados.size;
  if (afetados.size > 0) avisarMudanca({ dealIds: [...afetados], motivo: "mensagem" });

  // Se a volta bateu no limite, a próxima continua de onde parou em vez de
  // pular para "agora" e deixar conversas para trás.
  const proximo = chats.length >= MAX_CONVERSAS_POR_VOLTA ? chats[chats.length - 1].quando : inicioDaVolta;
  estado.desde.set(conta.id, proximo);

  // Arruma, aos poucos, contatos que entraram só pelo LID (antes desta
  // correção, ou de conversas que nunca trouxeram o telefone).
  await unificarContatosLid(conta).catch((e) => console.warn("Unificação de LID falhou:", (e as Error).message));
  return resultado;
}

/**
 * Contato que ficou sem telefone volta a ser tentado depois deste tempo: a
 * Evolution aprende o número quando a pessoa escreve pelo telefone.
 */
const NOVA_TENTATIVA_LID_MS = 6 * 60 * 60 * 1000;

/**
 * Contatos que só têm o "@lid": descobre o telefone (ver
 * identidade-contato.ts) e junta com o contato do telefone — o lead duplicado
 * some e fica um só, com tudo. Sem telefone conhecido, marca a tentativa e
 * volta a tentar daqui a algumas horas (antes, desistia para sempre — e o
 * duplicado ficava).
 *
 * Só quem é LEAD: a agenda do celular chega inteira pelo LID (milhares de
 * contatos) e nenhum deles aparece no funil. Perguntar por todos, de novo a
 * cada 6 h, era carga à toa na Evolution — a mesma que atende as etiquetas.
 */
export async function unificarContatosLid(
  conta: { id: string; instanceName: string },
  limite = 10,
): Promise<number> {
  const pendentes = await prisma.contact.findMany({
    where: {
      accountId: conta.id,
      waJid: { endsWith: "@lid" },
      deals: { some: {} },
      OR: [{ lid: null }, { updatedAt: { lt: new Date(Date.now() - NOVA_TENTATIVA_LID_MS) } }],
    },
    // Os nunca tentados primeiro; depois, os tentados há mais tempo.
    orderBy: [{ lid: { sort: "asc", nulls: "first" } }, { updatedAt: "asc" }],
    select: { id: true, waJid: true },
    take: limite,
  });
  let unidos = 0;
  for (const c of pendentes) {
    try {
      if (await unificarContatoLid(conta, c)) unidos++;
    } catch (error) {
      console.warn(`LID ${c.waJid}: `, (error as Error).message);
    }
  }
  if (unidos > 0) {
    console.log(`Unificação: ${unidos} contato(s) duplicado(s) pelo LID juntado(s)`);
    avisarMudanca({ dealIds: [], motivo: "mensagem" });
  }
  return unidos;
}

/** Junta UM contato "só LID" com o do telefone, se der para descobrir. Devolve se juntou. */
export async function unificarContatoLid(
  conta: { id: string; instanceName: string },
  c: { id: string; waJid: string },
  opcoes: { rapido?: boolean } = {},
): Promise<boolean> {
  const { alt } = await descobrirPessoa(conta.instanceName, c.waJid, opcoes);
  if (alt?.endsWith("@s.whatsapp.net")) {
    // Com o telefone e o LID juntos, upsertContact junta (ou converte) os dois.
    const telefone = await formaConhecidaDoTelefone(conta.id, alt);
    await upsertContact({ accountId: conta.id, waJid: telefone, alt: c.waJid });
    return true;
  }
  // Já existe quem tenha esse LID guardado (o contato do telefone): junta.
  const dono = await prisma.contact.findFirst({
    where: { accountId: conta.id, lid: c.waJid, NOT: { id: c.id } },
    select: { id: true },
  });
  if (dono) {
    await mesclarContatos(dono.id, c.id);
    return true;
  }
  // Lead sem nenhuma mensagem pelo LID — nasceu de uma etiqueta: a conversa
  // da pessoa pode estar guardada pelo telefone, num lead que ainda não sabe
  // o LID. A foto de perfil diz qual (ver pessoaPelaFoto). Só para esses:
  // perguntar a foto de todo lead pelo LID seria consulta demais ao WhatsApp.
  const temMensagem = await prisma.message.findFirst({ where: { contactId: c.id }, select: { id: true } });
  if (!temMensagem) {
    const pelaFoto = await pessoaPelaFoto(conta, c.waJid);
    if (pelaFoto) {
      await mesclarContatos(pelaFoto.id, c.id);
      return true;
    }
  }
  // Sem telefone por enquanto: marca a tentativa (a data de atualização).
  await prisma.contact.update({ where: { id: c.id }, data: { lid: c.waJid } });
  return false;
}

const RECONFERIR_LID_MS = 10 * 60 * 1000;

/**
 * Confere em segundo plano se um contato "só LID" é a cópia de um lead do
 * telefone — e junta, se for. Para quem não pode esperar a Evolution (a fila
 * das etiquetas): a etiqueta move o lead na hora e, se havia uma cópia, a
 * junção vem segundos depois, levando o estágio novo junto (ver
 * copiaDecideOEstagio). Cada contato no máximo uma vez a cada 10 min.
 */
export function unificarEmSegundoPlano(conta: { id: string; instanceName: string }, c: { id: string; waJid: string }) {
  if (!c.waJid.endsWith("@lid")) return;
  const ultima = conferidoEm.get(c.id) ?? 0;
  if (Date.now() - ultima < RECONFERIR_LID_MS) return;
  marcarLidConferido(c.id);

  void emFila(`unificar:${conta.id}`, () => unificarContatoLid(conta, c, { rapido: true }), 30_000).catch((error) =>
    console.warn(`LID ${c.waJid} (em segundo plano):`, (error as Error).message),
  );
}

/** O contato acabou de passar pela conferência completa: a de segundo plano não precisa repetir. */
export function marcarLidConferido(contactId: string) {
  if (conferidoEm.size > 5000) conferidoEm.clear();
  conferidoEm.set(contactId, Date.now());
}

/** Varre todas as contas. Nunca roda duas voltas ao mesmo tempo. */
export async function varrerTudo(): Promise<ResultadoVarredura[]> {
  if (estado.rodando) return [];
  estado.rodando = true;
  try {
    const contas = await prisma.whatsAppAccount.findMany({
      select: { id: true, instanceName: true, status: true },
    });
    const resultados: ResultadoVarredura[] = [];
    for (const conta of contas) {
      try {
        resultados.push(await varrerConta(conta));
      } catch (error) {
        console.warn(`Varredura de ${conta.instanceName} falhou —`, (error as Error).message);
      }
    }
    for (const r of resultados) {
      if (r.mensagensNovas > 0) {
        console.log(`Varredura ${r.conta}: ${r.mensagensNovas} mensagens que o webhook não trouxe, ${r.leadsAfetados} leads`);
      }
    }
    return resultados;
  } finally {
    estado.rodando = false;
  }
}
