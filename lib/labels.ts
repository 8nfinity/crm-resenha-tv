import { prisma } from "@/lib/db";
import { createDealForContact, moveDealToStage, recalculateScore } from "@/lib/deals";
import { evolution } from "@/lib/evolution/client";
import { isPersonJid, parseMessage } from "@/lib/evolution/parse";
import { descobrirPessoa, formaConhecidaDoTelefone, pessoaPelaFoto } from "@/lib/identidade-contato";
import type { EvolutionMessage } from "@/lib/evolution/types";
import { acharContato, ingestMessages, upsertContact } from "@/lib/ingest";
import { emFila } from "@/lib/fila";
import { ignorarContato, quemEstaComAEtiqueta, voltarAMostrar } from "@/lib/ignorar";
import { corrigirNomeEtiqueta, estagioDeMesmoNome, nomeParaGuardar, nomeProvisorio } from "@/lib/etiquetas-nomes";
import { avisarMudanca } from "@/lib/eventos";
import { marcarLidConferido, unificarEmSegundoPlano } from "@/lib/sincronizacao";
import { completarPerfil } from "@/lib/perfil-contato";
import { MINUTO } from "@/lib/saude-etiquetas";
import { limparEventosAntigos, ultimoQrCode } from "@/lib/eventos-conexao";

/**
 * Etiquetas do WhatsApp Business → estágios do funil.
 *
 * Quando você aplica uma etiqueta numa conversa pelo celular, a Evolution
 * dispara `labels.association` e o lead anda no funil sozinho.
 *
 * A sincronia é de MÃO ÚNICA, de propósito. Mão dupla (mover o card também
 * aplicar a etiqueta no celular) criaria eco: o CRM muda o estágio, isso
 * aplica a etiqueta, a etiqueta volta como evento e mexe no estágio de novo.
 * Dá para quebrar esse ciclo, mas é complexidade que só se paga se você
 * realmente trabalhar pelos dois lados.
 *
 * E o CRM NUNCA escreve nas etiquetas do WhatsApp — nem para testar. Uma
 * "leitura forçada" antiga retirava uma etiqueta inexistente da conversa
 * "Mensagem para mim": por dentro, isso grava uma alteração de verdade nos
 * dados da conta, que vai para o celular e para todos os aparelhos.
 *
 * As etiquetas que paravam de chegar ~5 min depois de conectar NÃO eram
 * isso: é um defeito da Evolution 2.3.3–2.3.7, que estraga a chave das
 * etiquetas quando o cache de 5 min vence (ver infra/evolution-railway).
 */

/**
 * Espelha as etiquetas do aparelho no banco.
 *
 * Preserva os mapeamentos existentes: renomear uma etiqueta no celular não
 * pode desfazer a ligação dela com o estágio, porque o que identifica a
 * etiqueta é o `labelId`, não o nome.
 */
export async function sincronizarEtiquetas(accountId: string) {
  const conta = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
  if (!conta) return [];

  const doAparelho = await evolution.findLabels(conta.instanceName);
  const atuais = new Map(
    (
      await prisma.whatsAppLabel.findMany({
        where: { accountId },
        select: { labelId: true, name: true, color: true, stageId: true, ignoreContact: true, isSeller: true },
      })
    ).map((e) => [e.labelId, e]),
  );

  for (const etiqueta of doAparelho) {
    const antes = atuais.get(etiqueta.labelId) ?? null;
    // A lista da Evolution vem sem acentos (e sem emoji): não estraga o nome
    // certo que o evento do celular já trouxe.
    const nome = nomeParaGuardar(antes?.name, etiqueta.name) ?? nomeProvisorio(etiqueta.labelId);
    const estagio = await estagioParaEtiquetaNova(antes, etiqueta.labelId, nome);
    // Sem mudança, sem escrita: a data de atualização das etiquetas é o que
    // faz as telas abertas recarregarem a lista (ver /api/eventos/versao).
    if (antes && antes.name === nome && antes.color === etiqueta.color && !estagio) continue;
    await prisma.whatsAppLabel.upsert({
      where: {
        accountId_labelId: { accountId, labelId: etiqueta.labelId },
      },
      update: { name: nome, color: etiqueta.color, ...(estagio ? { stageId: estagio.id } : {}) },
      create: { accountId, labelId: etiqueta.labelId, name: nome, color: etiqueta.color, stageId: estagio?.id ?? null },
    });
    if (estagio) levarQuemJaTem(accountId, etiqueta.labelId);
  }

  // Etiquetas apagadas do celular somem daqui junto. Manter uma regra apontando
  // para etiqueta que não existe mais só geraria confusão na tela.
  // Lista VAZIA não apaga nada: quase sempre é a Evolution que ainda não
  // recebeu as etiquetas, e apagar levaria junto toda a configuração feita.
  const idsAtuais = doAparelho.map((e) => e.labelId);
  if (idsAtuais.length > 0) {
    // A recém-criada fica: o evento do celular chega antes de a Evolution
    // gravar a etiqueta no banco dela, e a lista pode ainda não ter ela.
    await prisma.whatsAppLabel.deleteMany({
      where: { accountId, labelId: { notIn: idsAtuais }, createdAt: { lt: new Date(Date.now() - 10 * MINUTO) } },
    });
  }

  return prisma.whatsAppLabel.findMany({
    where: { accountId, removedAt: null },
    include: { stage: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Uma etiqueta ou lista foi criada, renomeada ou apagada no celular.
 *
 * Usa o que veio NO EVENTO, sem reler a lista da Evolution: ela dispara o
 * evento antes de gravar a mudança no banco dela, e reler ali devolvia a lista
 * velha — a lista recém-criada não aparecia, e a apagada voltava como se
 * existisse. O evento ainda traz o nome com acento, que a lista não traz.
 */
export async function registrarEdicaoDeEtiqueta(
  accountId: string,
  evento: { labelId: string; name?: string | null; color?: string | null; deleted?: boolean },
): Promise<"apagada" | "gravada"> {
  const { labelId } = evento;
  if (evento.deleted) {
    await prisma.whatsAppLabel.deleteMany({ where: { accountId, labelId } });
    return "apagada";
  }

  const nome = evento.name?.trim() ? corrigirNomeEtiqueta(evento.name.trim()) : null;
  const cor = evento.color != null && evento.color !== "" ? String(evento.color) : undefined;
  const antes = await buscarEtiqueta(accountId, labelId);
  const estagio = nome ? await estagioParaEtiquetaNova(antes, labelId, nome) : null;
  await prisma.whatsAppLabel.upsert({
    where: { accountId_labelId: { accountId, labelId } },
    // Mexeram nela no celular: existe. Se tinha sido tirada do CRM, volta.
    update: {
      ...(nome ? { name: nome } : {}),
      ...(cor !== undefined ? { color: cor } : {}),
      ...(estagio ? { stageId: estagio.id } : {}),
      removedAt: null,
    },
    create: { accountId, labelId, name: nome ?? nomeProvisorio(labelId), color: cor ?? null, stageId: estagio?.id ?? null },
  });
  if (estagio) {
    console.log(`Etiqueta/lista "${nome}" ligada sozinha ao estágio "${estagio.name}" (mesmo nome)`);
    levarQuemJaTem(accountId, labelId);
  }
  return "gravada";
}

/**
 * A etiqueta acabou de ser ligada sozinha a um estágio (pelo nome). Quem já
 * estava com ela — porque a etiquetagem chegou antes do nome, quando ela
 * ainda era "Etiqueta 12" e não movia ninguém — anda agora, pelas mesmas
 * regras do mapeamento feito à mão (só para a frente).
 *
 * Não espera: pode ter sido chamada de dentro da fila das etiquetas, e as
 * etiquetagens que isto põe na fila só rodam depois que a atual terminar.
 */
function levarQuemJaTem(accountId: string, labelId: string) {
  void moverQuemJaTemAEtiqueta(accountId, labelId)
    .then((movidos) => {
      if (movidos) avisarMudanca({ dealIds: [], motivo: "etiqueta" });
    })
    .catch((error) => console.warn(`Levar quem já tem a etiqueta ${labelId}:`, (error as Error).message));
}

/**
 * Etiqueta ou lista NOVA com o nome de um estágio ("Qualificado") já nasce
 * ligada a ele: criar a lista no celular basta para ela mover o lead.
 *
 * Só vale para a que acabou de aparecer no CRM (ou que ainda tinha o nome
 * provisório) e não faz nada ainda — uma etiqueta que você já configurou,
 * inclusive como "Não move o lead", nunca é trocada.
 */
async function estagioParaEtiquetaNova(
  antes: { name: string; stageId: string | null; ignoreContact: boolean; isSeller: boolean } | null,
  labelId: string,
  nome: string,
): Promise<{ id: string; name: string } | null> {
  const nova = !antes || antes.name === nomeProvisorio(labelId);
  if (!nova || (antes && (antes.stageId || antes.ignoreContact || antes.isSeller))) return null;
  const estagios = await prisma.stage.findMany({ select: { id: true, name: true } });
  return estagioDeMesmoNome(nome, estagios);
}

/**
 * "Não existe mais no celular": tira a etiqueta da tela e desfaz o que ela
 * fazia. Serve para a etiqueta fantasma — apagada no celular num momento em
 * que a Evolution estava sem a chave, e que a lista dela continua trazendo.
 * Se a etiqueta for usada de novo no celular, ela volta.
 */
export async function tirarEtiquetaDoCrm(accountId: string, labelId: string) {
  return prisma.whatsAppLabel.updateMany({
    where: { accountId, labelId },
    data: { removedAt: new Date(), stageId: null, ignoreContact: false, isSeller: false },
  });
}

let atualizandoListas = false;

/**
 * Rotina do servidor: copia para o CRM a lista de etiquetas e listas de cada
 * número conectado. O caminho normal é o aviso do celular, na hora em que a
 * etiqueta é criada; esta rotina é a rede de segurança — se o aviso se
 * perdeu, a etiqueta nova aparece mesmo assim em poucos minutos, sem
 * precisar apertar "Atualizar". Só lê o banco da Evolution; não mexe no
 * WhatsApp.
 */
export async function atualizarEtiquetasDosNumeros(): Promise<void> {
  if (atualizandoListas) return;
  atualizandoListas = true;
  try {
    const contas = await prisma.whatsAppAccount.findMany({
      where: { status: "open" },
      select: { id: true, instanceName: true },
    });
    for (const conta of contas) {
      try {
        const antes = await prisma.whatsAppLabel.findMany({ where: { accountId: conta.id }, select: { labelId: true } });
        const conhecidas = new Set(antes.map((e) => e.labelId));
        await sincronizarEtiquetas(conta.id);
        const depois = await prisma.whatsAppLabel.findMany({ where: { accountId: conta.id }, select: { labelId: true, name: true } });
        const novas = depois.filter((e) => !conhecidas.has(e.labelId));
        if (novas.length > 0) {
          console.log(`Etiquetas novas em ${conta.instanceName}: ${novas.map((e) => e.name).join(", ")}`);
        }
        if (novas.length > 0 || depois.length !== antes.length) {
          avisarMudanca({ dealIds: [], motivo: "etiqueta" });
        }
      } catch (error) {
        console.warn(`Lista de etiquetas de ${conta.instanceName}:`, (error as Error).message);
      }
    }
    await limparEventosAntigos();
  } finally {
    atualizandoListas = false;
  }
}

export type ResultadoEtiqueta = (
  | { acao: "movido"; dealId: string; estagio: string }
  | { acao: "atendente"; atendente: string }
  | { acao: "ignorado"; motivo: string }
) & {
  /** Nomes para o painel de conferência (ver etiquetagens-recebidas.ts). */
  contato?: string;
  etiqueta?: string;
};

/** Como o contato aparece no painel: o nome que você salvou, o dele ou o número. */
function nomeDoContato(c: { savedName: string | null; pushName: string | null; phone: string | null; waJid: string }): string {
  return c.savedName ?? c.pushName ?? (c.phone ? `+${c.phone}` : c.waJid.split("@")[0]);
}

type Etiqueta = NonNullable<Awaited<ReturnType<typeof buscarEtiqueta>>>;

function buscarEtiqueta(accountId: string, labelId: string) {
  return prisma.whatsAppLabel.findUnique({ where: { accountId_labelId: { accountId, labelId } } });
}

/**
 * Tipos de etiqueta no histórico. "vendedor" é o nome antigo de "atendente"
 * (linhas gravadas antes da mudança) — as duas valem como atendimento.
 */
export const TIPOS_ATENDENTE = ["atendente", "vendedor"];

/** O que a etiqueta faz, na palavra que vai para o histórico. */
function tipoDa(etiqueta: Etiqueta | null): string {
  if (!etiqueta) return "nenhum";
  if (etiqueta.ignoreContact) return "ignorar";
  if (etiqueta.isSeller) return "atendente";
  if (etiqueta.stageId) return "estagio";
  return "nenhum";
}

/** Quem atendeu, pela etiqueta: o próprio nome dela ("João"). */
export function nomeDoAtendente(etiqueta: { name: string }): string {
  return etiqueta.name.trim() || "Atendente";
}

/**
 * Complemento da linha "Maria atendeu o lead" no histórico: diz se o
 * atendimento veio de outra pessoa. Primeiro atendimento não precisa de
 * complemento.
 */
export function textoDoAtendimento(anterior: string | null, atual: string): string | null {
  if (!anterior) return null;
  if (anterior === atual) return `${atual} continuou o atendimento`;
  return `Atendimento passou de ${anterior} para ${atual}`;
}

/** Último atendente registrado no histórico do contato. */
async function atendenteAnterior(contactId: string): Promise<string | null> {
  const ultimo = await prisma.labelEvent.findFirst({
    where: { contactId, kind: { in: TIPOS_ATENDENTE }, action: "add" },
    orderBy: { createdAt: "desc" },
    select: { labelName: true },
  });
  return ultimo?.labelName ?? null;
}

/**
 * Grava uma linha no histórico de etiquetas do contato — vale para TODA
 * etiqueta, mesmo as que não fazem nada no CRM: o histórico mostra o que
 * aconteceu na conversa, não só o que o CRM fez com isso.
 */
async function registrar(
  contactId: string,
  labelId: string,
  etiqueta: Etiqueta | null,
  acao: "add" | "remove",
  detalhe: string | null,
) {
  await prisma.labelEvent.create({
    data: {
      contactId,
      labelId,
      labelName: etiqueta?.name ?? `Etiqueta ${labelId}`,
      labelColor: etiqueta?.color ?? null,
      action: acao,
      kind: tipoDa(etiqueta),
      detail: detalhe,
    },
  });
}

/** Última linha do histórico desta etiqueta neste contato. */
async function ultimoEvento(contactId: string, labelId: string) {
  return prisma.labelEvent.findFirst({
    where: { contactId, labelId },
    orderBy: { createdAt: "desc" },
    select: { action: true, createdAt: true },
  });
}

async function ultimaAcao(contactId: string, labelId: string): Promise<string | null> {
  return (await ultimoEvento(contactId, labelId))?.action ?? null;
}

/**
 * A Evolution reenvia o evento quando o CRM demora ou falha. Dentro deste
 * prazo, a mesma etiqueta de novo na mesma conversa é reenvio, não
 * etiquetagem nova (no WhatsApp não dá para pôr a mesma etiqueta duas vezes).
 */
const PRAZO_REENVIO_MS = 10 * MINUTO;

/**
 * Logo depois de PAREAR (QR Code), o WhatsApp manda de novo TODAS as
 * etiquetas que já estão nas conversas, de uma vez — não são etiquetagens
 * novas, é a cópia do estado. Ela se reconhece por chegar em rajada nos
 * minutos seguintes a um QR Code gerado pelo CRM. Fora disso, nada é tratado
 * como cópia: nem a etiquetagem em massa (50 conversas de uma vez), nem a
 * que vem depois de a conexão cair e voltar sozinha.
 */
const JANELA_PAREAMENTO_MS = 15 * MINUTO;
const JANELA_RAJADA_MS = MINUTO;
const RAJADA = 5;

const global_ = globalThis as unknown as {
  crmChegadasEtiqueta?: Map<string, number[]>;
  crmNomesPendentes?: Set<string>;
};
const chegadas = (global_.crmChegadasEtiqueta ??= new Map<string, number[]>());
/** Contas com a releitura do nome de uma etiqueta provisória já marcada. */
const nomesPendentes = (global_.crmNomesPendentes ??= new Set<string>());

/** Anota a chegada de um evento de etiqueta e diz quantos chegaram no último minuto. */
function anotarChegada(accountId: string): number {
  const agora = Date.now();
  const recentes = (chegadas.get(accountId) ?? []).filter((t) => agora - t < JANELA_RAJADA_MS);
  recentes.push(agora);
  chegadas.set(accountId, recentes);
  return recentes.length;
}

async function ehCopiaDoEstado(accountId: string): Promise<boolean> {
  if (anotarChegada(accountId) < RAJADA) return false;
  const qr = await ultimoQrCode(accountId);
  return Boolean(qr && Date.now() - qr.getTime() < JANELA_PAREAMENTO_MS);
}

/**
 * O telefone da conversa (se ela veio pelo telefone ou se a Evolution revelou
 * um), na forma que o CRM já usa — com ou sem o 9 —, o LID e o nome da pessoa.
 * Só para conversa que o CRM ainda não conhece: é a parte que espera a Evolution.
 */
async function quemEDaConversa(conta: { id: string; instanceName: string }, chatId: string) {
  const { alt, pushName } = await descobrirPessoa(conta.instanceName, chatId, { rapido: true });
  const pn = chatId.endsWith("@s.whatsapp.net") ? chatId : alt?.endsWith("@s.whatsapp.net") ? alt : null;
  return {
    telefone: pn ? await formaConhecidaDoTelefone(conta.id, pn) : null,
    lid: chatId.endsWith("@lid") ? chatId : alt?.endsWith("@lid") ? alt : null,
    pushName,
  };
}

/**
 * O contato JÁ existente da conversa, pelo telefone ou pelo LID — sem criar
 * nenhum. Usado na retirada da etiqueta: se ela chegasse pelo LID e o contato
 * estivesse guardado pelo telefone, a retirada se perdia, e a próxima vez que
 * você pusesse a etiqueta parecia repetida.
 */
async function contatoExistenteDaConversa(conta: { id: string; instanceName: string }, chatId: string) {
  const achado = await acharContato(conta.id, chatId);
  if (achado) return achado;
  const { telefone, lid } = await quemEDaConversa(conta, chatId);
  for (const outro of [telefone, lid]) {
    if (!outro || outro === chatId) continue;
    const pelaOutraForma = await acharContato(conta.id, outro);
    if (pelaOutraForma) return pelaOutraForma;
  }
  return null;
}

/** A etiqueta do evento, criada na hora se o CRM ainda não a conhece. */
async function garantirEtiqueta(accountId: string, labelId: string): Promise<Etiqueta> {
  const existente = await buscarEtiqueta(accountId, labelId);
  if (existente && !existente.removedAt) return existente;
  if (existente) {
    // Tinha sido tirada do CRM como "não existe mais", mas acabou de ser
    // usada no celular: existe. Volta para a tela (sem ação, que foi desfeita).
    return prisma.whatsAppLabel.update({ where: { id: existente.id }, data: { removedAt: null } });
  }
  // Desconhecida: criada no celular e o evento dela ainda não chegou.
  // Registra para aparecer na tela de mapeamento. Upsert porque o evento da
  // criação pode estar sendo gravado neste mesmo instante.
  const criada = await prisma.whatsAppLabel.upsert({
    where: { accountId_labelId: { accountId, labelId } },
    update: {},
    create: { accountId, labelId, name: nomeProvisorio(labelId) },
  });
  if (criada.name === nomeProvisorio(labelId)) buscarNomeDepois(accountId);
  return criada;
}

/**
 * Etiqueta que chegou antes do próprio nome ("Etiqueta 12"): daqui a pouco
 * relê a lista da Evolution — que grava o nome logo depois de avisar — para
 * a tela mostrar o nome de verdade sem esperar a rotina de 5 minutos.
 */
function buscarNomeDepois(accountId: string) {
  if (nomesPendentes.has(accountId)) return;
  nomesPendentes.add(accountId);
  setTimeout(() => {
    nomesPendentes.delete(accountId);
    void sincronizarEtiquetas(accountId)
      .then(() => avisarMudanca({ dealIds: [], motivo: "etiqueta" }))
      .catch((error) => console.warn("Nome da etiqueta nova:", (error as Error).message));
  }, 20_000).unref?.();
}

/**
 * O contato da conversa etiquetada.
 *
 * A etiqueta chega ora pelo telefone, ora pelo LID da conversa. O CRM guarda
 * os dois no contato (o LID também vem das mensagens — ver ingestLiveMessage),
 * então o contato já conhecido sai direto do banco, sem esperar a Evolution:
 * é o que faz 50 conversas etiquetadas de uma vez andarem em segundos.
 *
 * Só a conversa que o CRM nunca viu pergunta à Evolution quem é a pessoa
 * (telefone ↔ LID), para não criar uma cópia de quem já está no funil pela
 * outra forma — e para o lead novo não entrar sem nome.
 */
async function contatoDaConversa(conta: { id: string; instanceName: string }, chatId: string) {
  const achado = await acharContato(conta.id, chatId);
  if (achado) return achado;
  const { telefone, lid, pushName } = await quemEDaConversa(conta, chatId);
  // LID que a Evolution não liga a telefone nenhum: pode ser de um lead cuja
  // conversa veio do histórico pelo telefone. A foto de perfil diz de quem.
  const doTelefone = !telefone && lid ? await pessoaPelaFoto(conta, lid) : null;
  if (doTelefone) {
    console.log(`Etiqueta pelo LID ${lid}: é o lead ${doTelefone.waJid} (mesma foto de perfil)`);
    return upsertContact({ accountId: conta.id, waJid: doTelefone.waJid, alt: lid, pushName });
  }
  // Sem a Evolution, fica com o identificador que veio.
  const novo = await upsertContact({
    accountId: conta.id,
    waJid: telefone ?? chatId,
    alt: telefone ? lid : null,
    pushName,
  });
  // Já passou por tudo que a conferência de segundo plano faria.
  marcarLidConferido(novo.id);
  return novo;
}

/**
 * Depois de mover: o score (uma dúzia de idas ao banco) e, para o lead que
 * acabou de entrar no funil pela etiqueta, as últimas mensagens da conversa —
 * sem elas o card nasce vazio, sem prévia nem temperatura.
 *
 * Roda numa fila própria, depois da resposta: com 50 conversas etiquetadas de
 * uma vez, os 50 leads mudam de coluna primeiro, e os scores vêm em seguida.
 */
function depoisDeMover(
  conta: { instanceName: string },
  contato: { id: string; waJid: string; lid: string | null },
  dealId: string,
  chatId: string,
  novo: boolean,
) {
  void emFila(
    "etiquetas:depois",
    async () => {
      if (novo) {
        await trazerConversaRecente(conta.instanceName, contato, dealId, chatId);
        // Lead que entrou pela etiqueta sem nome nem foto: a Evolution costuma saber.
        const atual = await prisma.contact.findUnique({
          where: { id: contato.id },
          select: { id: true, waJid: true, lid: true, savedName: true, pushName: true, profilePicUrl: true },
        });
        if (atual) await completarPerfil(conta.instanceName, atual).catch(() => false);
      }
      await recalculateScore(dealId);
      avisarMudanca({ dealIds: [dealId], motivo: "etiqueta" });
    },
    60_000,
  ).catch((error) => console.warn(`Depois da etiqueta (lead ${dealId}):`, (error as Error).message));
}

const MENSAGENS_DO_LEAD_NOVO = 50;

async function trazerConversaRecente(
  instanceName: string,
  contato: { id: string; waJid: string; lid: string | null },
  dealId: string,
  chatId: string,
) {
  const contactId = contato.id;
  // Pelas duas formas da pessoa: a Evolution guarda cada mensagem pelo
  // identificador por onde ela chegou, e a conversa pode estar pelo telefone
  // mesmo que a etiqueta tenha chegado pelo LID (e vice-versa).
  const identificadores = [...new Set([chatId, contato.waJid, contato.lid].filter((j): j is string => Boolean(j)))];
  const porId = new Map<string, EvolutionMessage>();
  for (const jid of identificadores) {
    try {
      for (const m of await evolution.findMessages(instanceName, jid, MENSAGENS_DO_LEAD_NOVO)) {
        porId.set(m.key?.id ?? `${jid}:${porId.size}`, m);
      }
    } catch {
      // A conversa chega depois, pela varredura ou pela próxima mensagem.
    }
  }
  const mensagens = [...porId.values()];
  if (mensagens.length === 0) return;
  await ingestMessages(contactId, mensagens);

  // O nome que a pessoa usa no WhatsApp, se o contato entrou sem nenhum.
  const nome = mensagens.find((m) => m.key?.fromMe === false && m.pushName)?.pushName;
  if (nome) {
    await prisma.contact.updateMany({ where: { id: contactId, pushName: null }, data: { pushName: nome } });
  }

  // O funil é ordenado pela última mensagem: a do lead que entrou agora conta.
  const lidas = mensagens.map(parseMessage).filter((m): m is NonNullable<typeof m> => m !== null);
  const maisRecente = (lista: typeof lidas) =>
    lista.reduce<Date | null>((max, m) => (!max || m.timestamp > max ? m.timestamp : max), null);
  const ultima = maisRecente(lidas);
  const ultimaDele = maisRecente(lidas.filter((m) => !m.fromMe));
  if (ultima) {
    await prisma.deal.updateMany({
      where: { id: dealId, OR: [{ lastInteractionAt: null }, { lastInteractionAt: { lt: ultima } }] },
      data: { lastInteractionAt: ultima },
    });
  }
  if (ultimaDele) {
    await prisma.deal.updateMany({
      where: { id: dealId, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: ultimaDele } }] },
      data: { lastInboundAt: ultimaDele },
    });
  }
}

/**
 * Quanto uma etiquetagem pode segurar a fila. Normal é uma fração de
 * segundo; passa disso só esperando a Evolution — e aí as próximas seguem.
 */
const LIMITE_POR_ETIQUETA_MS = 45_000;

/** Fila das etiquetagens de uma conta: uma de cada vez, na ordem em que chegam. */
export function naFilaDeEtiquetas<T>(accountId: string, tarefa: () => Promise<T>): Promise<T> {
  return emFila(`etiquetas:${accountId}`, tarefa, LIMITE_POR_ETIQUETA_MS);
}

/**
 * De onde vem a etiquetagem:
 *  - "celular": o evento do WhatsApp. Move para o estágio da etiqueta, para
 *    frente ou para trás — é você dizendo onde o lead está.
 *  - "mapeamento": você acabou de ligar a etiqueta a um estágio e o CRM está
 *    aplicando em quem JÁ estava com ela.
 *  - "conferencia": a conferência periódica achou na Evolution uma etiqueta
 *    cujo aviso nunca chegou ao CRM (ver conferencia-etiquetas.ts). Não se
 *    sabe quando ela foi posta: só para a frente, como no mapeamento.
 */
export type OrigemEtiqueta = "celular" | "mapeamento" | "conferencia";

/** Complemento do histórico para o que a conferência recuperou. */
const RECUPERADA = "etiqueta recuperada: o aviso do celular não tinha chegado";

/**
 * Processa uma etiquetagem.
 *
 * Toda etiqueta vai para o histórico do contato. Além disso, conforme o que
 * ela faz no CRM: ignora o contato, registra quem atendeu ou move o lead de
 * estágio. Etiqueta de estágio traz a conversa para o funil se ela ainda não
 * é um lead — etiquetar é justamente o gesto de dizer "esta pessoa interessa".
 */
export async function aplicarEtiqueta(
  accountId: string,
  chatId: string,
  labelId: string,
  origem: OrigemEtiqueta = "celular",
): Promise<ResultadoEtiqueta> {
  const nomes: Anotacoes = {};
  const resultado = await aplicar(accountId, chatId, labelId, origem, nomes);
  // Só depois de mover: se o contato for a cópia (só LID) de um lead do
  // telefone, a junção leva junto o estágio que a etiqueta acabou de dar.
  nomes.depois?.();
  return { ...resultado, contato: nomes.contato, etiqueta: nomes.etiqueta };
}

type Anotacoes = {
  /** Nomes para o painel de conferência. */
  contato?: string;
  etiqueta?: string;
  /** O que fazer quando a etiquetagem terminar. */
  depois?: () => void;
};

async function aplicar(
  accountId: string,
  chatId: string,
  labelId: string,
  origem: OrigemEtiqueta,
  nomes: Anotacoes,
): Promise<ResultadoEtiqueta> {
  // Antes de qualquer outra coisa: a rajada é contada por chegada.
  const copiaDoEstado = origem === "celular" && (await ehCopiaDoEstado(accountId));

  if (!isPersonJid(chatId)) {
    return { acao: "ignorado", motivo: "não é uma conversa pessoal (grupo ou canal)" };
  }
  const conta = await prisma.whatsAppAccount.findUnique({
    where: { id: accountId },
    select: { id: true, instanceName: true },
  });
  if (!conta) return { acao: "ignorado", motivo: "conta desconhecida" };

  const etiqueta = await garantirEtiqueta(accountId, labelId);
  nomes.etiqueta = etiqueta.name;
  const contato = await contatoDaConversa(conta, chatId);
  nomes.contato = nomeDoContato(contato);
  nomes.depois = () => unificarEmSegundoPlano(conta, contato);

  // Pelo celular, a mesma etiqueta de novo numa conversa que o histórico já
  // diz estar com ela é repetição — reenvio do webhook (logo em seguida) ou a
  // cópia do estado ao parear. Aplicar de novo puxaria de volta um lead que
  // você já moveu no CRM. Fora desses dois casos, vale: a retirada anterior
  // é que se perdeu, e você acabou de pôr a etiqueta de novo.
  if (origem === "celular") {
    const ultimo = await ultimoEvento(contato.id, labelId);
    if (ultimo?.action === "add" && (copiaDoEstado || Date.now() - ultimo.createdAt.getTime() < PRAZO_REENVIO_MS)) {
      return { acao: "ignorado", motivo: "aviso repetido — essa etiqueta já tinha sido aplicada nesta conversa" };
    }
  }
  // A conferência decide fora da fila: o aviso de verdade pode ter chegado
  // enquanto ela esperava a vez. Se o histórico já tem, não há o que recuperar.
  if (origem === "conferencia" && (await ultimaAcao(contato.id, labelId)) === "add") {
    return { acao: "ignorado", motivo: "o aviso chegou antes da conferência" };
  }
  // Pelo mapeamento, pela conferência ou na cópia do estado ao parear, não se
  // sabe quando a etiqueta foi posta: o lead só anda para a frente.
  const soParaFrente = origem === "mapeamento" || origem === "conferencia" || copiaDoEstado;
  // No mapeamento, quem já está com a etiqueta já tem a linha no histórico:
  // só ganha outra se algo acontecer. Na conferência a linha é justamente o
  // que faltava (e é ela que impede de recuperar a mesma etiqueta de novo).
  const registrarSempre = origem === "celular" || origem === "conferencia";
  const comOrigem = (detalhe: string | null) =>
    origem === "conferencia" ? (detalhe ? `${detalhe} (${RECUPERADA})` : `Etiqueta registrada (${RECUPERADA})`) : detalhe;

  // Etiqueta de "ignorar": o contato some do CRM (e não volta enquanto
  // estiver com ela). Vale mais que qualquer outra ação.
  if (etiqueta.ignoreContact) {
    await registrar(contato.id, labelId, etiqueta, "add", comOrigem("Contato passou a ser ignorado pelo CRM"));
    await ignorarContato(accountId, contato.waJid);
    return { acao: "ignorado", motivo: "contato marcado para ignorar" };
  }

  // Contato ignorado não volta para o funil por causa de outra etiqueta —
  // mas a etiqueta fica no histórico dele.
  if (contato.ignoredAt) {
    if (registrarSempre) await registrar(contato.id, labelId, etiqueta, "add", comOrigem(null));
    return { acao: "ignorado", motivo: "contato está ignorado" };
  }

  // Etiqueta de atendente: só registra quem atendeu. Não atribui o lead a
  // ninguém nem mexe no funil.
  if (etiqueta.isSeller) {
    const atendente = nomeDoAtendente(etiqueta);
    const anterior = await atendenteAnterior(contato.id);
    await registrar(contato.id, labelId, etiqueta, "add", comOrigem(textoDoAtendimento(anterior, atendente)));
    return { acao: "atendente", atendente };
  }

  const estagio = etiqueta.stageId ? await prisma.stage.findUnique({ where: { id: etiqueta.stageId } }) : null;
  if (!estagio) {
    if (registrarSempre) await registrar(contato.id, labelId, etiqueta, "add", comOrigem(null));
    return {
      acao: "ignorado",
      motivo: "essa etiqueta/lista não está ligada a nenhum estágio — escolha o estágio dela na lista abaixo",
    };
  }

  const existente = await prisma.deal.findUnique({
    where: { contactId: contato.id },
    include: { stage: { select: { order: true, name: true, pipelineId: true } } },
  });

  if (soParaFrente && existente) {
    // Lead arquivado fica arquivado e lead que já avançou não volta. "Adiante"
    // só existe dentro do mesmo funil: etiqueta de outro funil leva o lead
    // para lá.
    const motivo = existente.archivedAt
      ? "lead arquivado"
      : existente.stageId === estagio.id
        ? "o lead já está nesse estágio"
        : existente.stage.pipelineId === estagio.pipelineId && existente.stage.order > estagio.order
          ? `o lead já está adiante (${existente.stage.name})`
          : null;
    if (motivo) {
      if (registrarSempre) {
        await registrar(contato.id, labelId, etiqueta, "add", comOrigem(`Etiqueta já estava na conversa; ${motivo}`));
      }
      return { acao: "ignorado", motivo };
    }
  }

  // Etiquetar uma conversa que ainda não está no funil traz ela para dentro.
  const deal = existente ?? (await createDealForContact(contato.id));

  // Lead arquivado etiquetado no celular: você está dizendo que ele voltou a
  // interessar. Volta para o funil, no estágio da etiqueta.
  const desarquivou = Boolean(deal.archivedAt);
  if (desarquivou) await prisma.deal.update({ where: { id: deal.id }, data: { archivedAt: null } });

  const jaEstava = deal.stageId === estagio.id;
  // moveDealToStage grava a transição: a etiquetagem entra no histórico do
  // funil igual a um arrasto manual, e as métricas de conversão contam ela.
  if (!jaEstava) await moveDealToStage(deal.id, estagio.id);

  const agiu = !existente || desarquivou || !jaEstava;
  if (agiu) {
    // O card aparece na coluna certa JÁ; o score e, para o lead novo, a
    // conversa vêm logo depois, e a tela se atualiza de novo.
    avisarMudanca({ dealIds: [deal.id], motivo: "etiqueta" });
    depoisDeMover(conta, contato, deal.id, chatId, !existente);
  }

  const detalhe = !existente
    ? `Entrou no funil em ${estagio.name}`
    : desarquivou
      ? `Voltou ao funil em ${estagio.name}`
      : jaEstava
        ? `Já estava em ${estagio.name}`
        : `Moveu para ${estagio.name}`;
  if (registrarSempre || agiu) {
    await registrar(
      contato.id,
      labelId,
      etiqueta,
      "add",
      origem === "mapeamento" ? `${detalhe} (a conversa já estava com a etiqueta quando ela foi ligada ao estágio)` : comOrigem(detalhe),
    );
  }

  if (!agiu) return { acao: "ignorado", motivo: "o lead já está nesse estágio" };
  return { acao: "movido", dealId: deal.id, estagio: estagio.name };
}

/**
 * Remoção de etiqueta. Também vai para o histórico.
 *
 * Etiqueta de ESTÁGIO: não move o lead — tirar "Reunião marcada" não diz para
 * onde ele deveria voltar, e adivinhar errado bagunça o histórico de conversão.
 *
 * Etiqueta de IGNORAR: traz o contato de volta ao CRM.
 */
export async function removerEtiqueta(
  accountId: string,
  chatId: string,
  labelId: string,
): Promise<ResultadoEtiqueta> {
  anotarChegada(accountId); // a retirada também faz parte de uma rajada
  if (!isPersonJid(chatId)) return { acao: "ignorado", motivo: "não é uma conversa pessoal (grupo ou canal)" };

  const conta = await prisma.whatsAppAccount.findUnique({
    where: { id: accountId },
    select: { id: true, instanceName: true },
  });
  if (!conta) return { acao: "ignorado", motivo: "conta desconhecida" };

  const etiqueta = await buscarEtiqueta(accountId, labelId);
  // A etiqueta pode chegar pelo telefone ou pelo LID da conversa.
  const contato = await contatoExistenteDaConversa(conta, chatId);
  const nomes = { etiqueta: etiqueta?.name ?? nomeProvisorio(labelId), contato: contato ? nomeDoContato(contato) : chatId.split("@")[0] };
  if (!contato) return { acao: "ignorado", motivo: "contato que o CRM não conhece", ...nomes };

  if (etiqueta?.ignoreContact) {
    await voltarAMostrar(contato.id);
    await registrar(contato.id, labelId, etiqueta, "remove", "Contato voltou a aparecer no CRM");
    return { acao: "ignorado", motivo: "contato voltou a aparecer no CRM", ...nomes };
  }

  // Só registra a retirada do que o histórico diz que estava lá: a cópia do
  // estado que chega ao parear traz também etiquetas que nunca estiveram.
  if ((await ultimaAcao(contato.id, labelId)) !== "add") {
    return { acao: "ignorado", motivo: "etiqueta não estava registrada nesta conversa", ...nomes };
  }
  await registrar(contato.id, labelId, etiqueta, "remove", null);
  return { acao: "ignorado", motivo: "retirada registrada no histórico (tirar a etiqueta não move o lead)", ...nomes };
}

/**
 * Ao ligar uma etiqueta a um estágio, leva para lá quem JÁ estava com ela no
 * celular — sem isso, só quem fosse etiquetado dali em diante andaria no
 * funil. Só para a frente: não se sabe quando a etiqueta foi posta, e um lead
 * que já avançou no CRM não deve voltar. Devolve quantos leads andaram.
 */
export async function moverQuemJaTemAEtiqueta(accountId: string, labelId: string): Promise<number> {
  const etiqueta = await buscarEtiqueta(accountId, labelId);
  if (!etiqueta?.stageId) return 0;

  // Todos, sem limite: 50 conversas com a etiqueta são 50 leads no estágio.
  // Pela mesma fila dos avisos do celular, para não atropelar um que chegue agora.
  let movidos = 0;
  for (const jid of await quemEstaComAEtiqueta(accountId, labelId)) {
    try {
      const r = await naFilaDeEtiquetas(accountId, () => aplicarEtiqueta(accountId, jid, labelId, "mapeamento"));
      if (r.acao === "movido") movidos++;
    } catch (error) {
      console.warn(`Etiqueta ${labelId} em ${jid}:`, (error as Error).message);
    }
  }
  return movidos;
}

/**
 * Leva ao estágio quem já está com QUALQUER etiqueta ligada a estágio e não
 * andou — o evento se perdeu, a etiqueta foi ligada ao estágio depois, ou
 * moveu uma cópia do contato pelo LID. Mesmas regras do mapeamento: só para a
 * frente e sem mexer em lead arquivado. Roda no "Atualizar" da tela de etiquetas.
 */
export async function aplicarEtiquetasMapeadas(accountId: string): Promise<number> {
  const mapeadas = await prisma.whatsAppLabel.findMany({
    where: { accountId, stageId: { not: null }, removedAt: null },
    select: { labelId: true },
  });
  let movidos = 0;
  for (const { labelId } of mapeadas) {
    movidos += await moverQuemJaTemAEtiqueta(accountId, labelId);
  }
  return movidos;
}

/**
 * Ao marcar uma etiqueta como "de atendente", o histórico passa a valer para
 * ela também no passado:
 *  - etiquetagens antigas com essa etiqueta viram "Fulano atendeu";
 *  - conversas que já estão com ela no celular, mas sem registro no
 *    histórico, ganham a linha agora.
 * Devolve quantos contatos ganharam registro novo.
 */
export async function registrarAtendenteDeQuemJaTemAEtiqueta(accountId: string, labelId: string): Promise<number> {
  const etiqueta = await buscarEtiqueta(accountId, labelId);
  if (!etiqueta?.isSeller) return 0;

  // Quem já está com a etiqueta tem a linha no histórico (toda etiquetagem
  // vira uma): basta ela passar a contar como atendimento.
  await prisma.labelEvent.updateMany({
    where: { labelId, contact: { accountId }, kind: { notIn: TIPOS_ATENDENTE } },
    data: { kind: "atendente" },
  });
  return (await quemEstaComAEtiqueta(accountId, labelId)).length;
}
