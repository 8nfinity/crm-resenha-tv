import { prisma } from "@/lib/db";
import { createDealForContact, recalculateScore } from "@/lib/deals";
import { evolution } from "@/lib/evolution/client";
import { isPersonJid } from "@/lib/evolution/parse";
import type { EvolutionChat } from "@/lib/evolution/types";
import { ingestMessages, upsertContact } from "@/lib/ingest";
import { avisarMudanca } from "@/lib/eventos";

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

// Estado na memória do processo: até onde cada conta já foi varrida.
const global_ = globalThis as unknown as {
  crmVarredura?: { desde: Map<string, number>; rodando: boolean };
};
const estado = (global_.crmVarredura ??= { desde: new Map(), rodando: false });

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
    avisarMudanca({ dealIds: [], motivo: "conexao" });
  }
  if (status !== "open") return resultado;

  const desde = estado.desde.get(conta.id) ?? (await pontoDePartida(conta.id));
  const inicioDaVolta = Date.now();
  const chats = chatsComAtividade(await evolution.findChats(conta.instanceName), desde);
  resultado.conversasVistas = chats.length;

  const afetados = new Set<string>();
  for (const { jid, chat } of chats) {
    try {
      const mensagens = await evolution.findMessages(conta.instanceName, jid, MENSAGENS_POR_CONVERSA);
      if (mensagens.length === 0) continue;

      // O nome vem de uma mensagem DELE (a sua traria o seu próprio nome).
      const pushName =
        mensagens.find((m) => m.key?.fromMe === false)?.pushName ?? chat.pushName ?? null;
      const contato = await upsertContact({ accountId: conta.id, waJid: jid, pushName });
      if (contato.ignoredAt) continue; // número marcado para ignorar

      const novas = await ingestMessages(contato.id, mensagens);
      if (novas === 0) continue;

      resultado.mensagensNovas += novas;
      const deal = await createDealForContact(contato.id);
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
  return resultado;
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
