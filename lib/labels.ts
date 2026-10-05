import { prisma } from "@/lib/db";
import { createDealForContact, moveDealToStage, recalculateScore } from "@/lib/deals";
import { evolution, EvolutionError } from "@/lib/evolution/client";
import { isPersonJid, jidAlternativo, parseMessage } from "@/lib/evolution/parse";
import type { EvolutionChat, EvolutionMessage } from "@/lib/evolution/types";
import { acharContato, ingestMessages, upsertContact } from "@/lib/ingest";
import { emFila } from "@/lib/fila";
import { etiquetasDoChat, ignorarContato, quemEstaComAEtiqueta, voltarAMostrar } from "@/lib/ignorar";
import { corrigirNomeEtiqueta, estagioDeMesmoNome, nomeParaGuardar, nomeProvisorio } from "@/lib/etiquetas-nomes";
import { avisarMudanca } from "@/lib/eventos";
import { classificarFalha, eventoDoEstado, MINUTO, precisaVerificar, type EstadoChave } from "@/lib/saude-etiquetas";
import { limparEventosAntigos, registrarEventoDeConexao, ultimaAbertura, ultimoQrCode } from "@/lib/eventos-conexao";

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
        select: { labelId: true, name: true, stageId: true, ignoreContact: true, isSeller: true },
      })
    ).map((e) => [e.labelId, e]),
  );

  for (const etiqueta of doAparelho) {
    const antes = atuais.get(etiqueta.labelId) ?? null;
    // A lista da Evolution vem sem acentos: não estraga o nome certo que o
    // evento do celular já trouxe.
    const nome = nomeParaGuardar(antes?.name, etiqueta.name);
    const estagio = await estagioParaEtiquetaNova(antes, etiqueta.labelId, nome);
    await prisma.whatsAppLabel.upsert({
      where: {
        accountId_labelId: { accountId, labelId: etiqueta.labelId },
      },
      update: { name: nome, color: etiqueta.color, ...(estagio ? { stageId: estagio.id } : {}) },
      create: { accountId, labelId: etiqueta.labelId, name: nome, color: etiqueta.color, stageId: estagio?.id ?? null },
    });
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
  if (estagio) console.log(`Etiqueta/lista "${nome}" ligada sozinha ao estágio "${estagio.name}" (mesmo nome)`);
  return "gravada";
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

/** Id que não existe em nenhum celular: retirá-la de uma conversa não muda nada. */
const ETIQUETA_INEXISTENTE = "987654321";

type ResultadoLeitura = { ok: true } | { ok: false; erro: string; estado?: EstadoChave };

/**
 * Força a Evolution a ler as etiquetas do WhatsApp agora, sem desconectar.
 *
 * As etiquetas chegam por um canal separado das mensagens (os "dados da
 * conta"), e às vezes a conexão nunca faz essa leitura. Pedir para RETIRAR
 * uma etiqueta inexistente da conversa "Mensagem para mim" não muda nada no
 * celular, mas obriga a biblioteca do WhatsApp a baixar antes todas as
 * etiquetas da conta e quem está com cada uma — e a Evolution repassa ao CRM.
 *
 * É também o único jeito de saber se a chave desses dados está lá: sem ela, a
 * resposta diz exatamente isso (ver classificarFalha).
 */
async function forcarLeituraDasEtiquetas(conta: {
  id: string;
  instanceName: string;
  status: string;
  phone: string | null;
}): Promise<ResultadoLeitura> {
  if (conta.status !== "open") return { ok: false, erro: "Conecte o número antes de buscar as etiquetas." };

  const numero =
    conta.phone ??
    (await prisma.contact.findFirst({ where: { accountId: conta.id, phone: { not: null } }, select: { phone: true } }))
      ?.phone;
  if (!numero) return { ok: false, erro: "Não encontrei um número desta conta para fazer a leitura." };

  try {
    await evolution.handleLabel(conta.instanceName, numero, ETIQUETA_INEXISTENTE, "remove");
    return { ok: true };
  } catch (error) {
    const status = error instanceof EvolutionError ? error.status : null;
    const corpo = error instanceof EvolutionError ? error.body : "";
    const { estado, texto } = classificarFalha((error as Error).message, status, corpo);
    return { ok: false, erro: texto, estado };
  }
}

function quando(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * Lê as etiquetas à força e guarda o resultado na conta (a tela de etiquetas
 * mostra) e na linha do tempo da conexão, quando ele muda.
 */
export async function verificarChaveDasEtiquetas(accountId: string): Promise<ResultadoLeitura> {
  const conta = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
  if (!conta) return { ok: false, erro: "Conta não encontrada." };

  const leitura = await forcarLeituraDasEtiquetas(conta);
  // Sem estado: nem chegou a perguntar (número desconectado). Nada a guardar.
  if (!leitura.ok && !leitura.estado) return leitura;

  const estado: EstadoChave = leitura.ok ? "ok" : leitura.estado!;
  let detalhe = leitura.ok ? null : leitura.erro;

  if (estado === "chave_perdida" && conta.labelKeyStatus === "ok" && conta.labelKeyCheckedAt) {
    // Estava boa e sumiu: se houve reconexão no meio, é a Evolution que
    // reiniciou sem guardar os arquivos. Data e hora ajudam a achar no log.
    const reconexao = await ultimaAbertura(accountId);
    if (reconexao && reconexao > conta.labelKeyCheckedAt) {
      detalhe =
        `Em ${quando(conta.labelKeyCheckedAt)} a chave estava OK; o WhatsApp reconectou em ${quando(reconexao)} ` +
        `e voltou sem ela. ${detalhe}`;
    }
  }

  await prisma.whatsAppAccount.update({
    where: { id: accountId },
    data: { labelKeyStatus: estado, labelKeyCheckedAt: new Date(), labelKeyDetail: detalhe },
  });
  if (estado !== conta.labelKeyStatus) {
    await registrarEventoDeConexao(accountId, eventoDoEstado(estado), detalhe);
  }
  return leitura;
}

let atualizandoListas = false;

/**
 * Rotina do servidor: copia para o CRM a lista de etiquetas e listas de cada
 * número conectado. O caminho normal é o aviso do celular, na hora em que a
 * etiqueta é criada; esta rotina é a rede de segurança — se o aviso se
 * perdeu, a etiqueta nova aparece mesmo assim em poucos minutos, sem
 * precisar apertar "Buscar do aparelho". Só lê o banco da Evolution; não
 * mexe no WhatsApp.
 */
export async function atualizarEtiquetasDosNumeros(): Promise<void> {
  if (atualizandoListas) return;
  atualizandoListas = true;
  try {
    const contas = await prisma.whatsAppAccount.findMany({
      where: { status: "open" },
      select: { id: true, instanceName: true, labelKeyStatus: true },
    });
    for (const conta of contas) {
      // Sem a chave, a lista da Evolution parou no tempo: não traz nada novo.
      if (conta.labelKeyStatus === "chave_perdida") continue;
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
  } finally {
    atualizandoListas = false;
  }
}

let conferindoChaves = false;

/**
 * Rotina do servidor: confere a chave das etiquetas de cada número conectado
 * quando é hora (ver precisaVerificar) — principalmente logo depois de uma
 * reconexão, que é quando a Evolution pode ter voltado sem os arquivos.
 */
export async function conferirChavesDasEtiquetas(): Promise<void> {
  if (conferindoChaves) return;
  conferindoChaves = true;
  try {
    const contas = await prisma.whatsAppAccount.findMany({
      where: { status: "open" },
      select: { id: true, instanceName: true, labelKeyStatus: true, labelKeyCheckedAt: true },
    });
    for (const conta of contas) {
      if (!precisaVerificar(conta, await ultimaAbertura(conta.id))) continue;
      const r = await verificarChaveDasEtiquetas(conta.id);
      if (!r.ok) console.warn(`Etiquetas de ${conta.instanceName}: ${r.erro}`);
    }
    await limparEventosAntigos();
  } finally {
    conferindoChaves = false;
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

const global_ = globalThis as unknown as { crmChegadasEtiqueta?: Map<string, number[]> };
const chegadas = (global_.crmChegadasEtiqueta ??= new Map<string, number[]>());

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
 * O que as últimas mensagens da conversa dizem da pessoa: o outro
 * identificador (telefone ↔ LID) e o nome que ela usa no WhatsApp. Vazio se a
 * Evolution não souber ou não responder.
 */
async function pelaConversa(
  instanceName: string,
  chatId: string,
): Promise<{ alt: string | null; pushName: string | null }> {
  try {
    const mensagens = await evolution.findMessages(instanceName, chatId, 5);
    return {
      alt: mensagens.map(jidAlternativo).find(Boolean) ?? null,
      // O nome vem de uma mensagem DELA (a sua traria o seu próprio nome).
      pushName: mensagens.find((m) => m.key?.fromMe === false && m.pushName)?.pushName ?? null,
    };
  } catch {
    return { alt: null, pushName: null };
  }
}

async function outroIdentificador(instanceName: string, chatId: string): Promise<string | null> {
  return (await pelaConversa(instanceName, chatId)).alt;
}

/**
 * O contato JÁ existente da conversa, pelo telefone ou pelo LID — sem criar
 * nenhum. Usado na retirada da etiqueta: se ela chegasse pelo LID e o contato
 * estivesse guardado pelo telefone, a retirada se perdia, e a próxima vez que
 * você pusesse a etiqueta parecia repetida.
 */
async function contatoExistenteDaConversa(conta: { id: string; instanceName: string }, chatId: string) {
  const achado = await acharContato(conta.id, chatId);
  if (achado?.waJid.endsWith("@s.whatsapp.net")) return achado;
  const alt = await outroIdentificador(conta.instanceName, chatId);
  return (alt ? await acharContato(conta.id, alt) : null) ?? achado;
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
  return prisma.whatsAppLabel.upsert({
    where: { accountId_labelId: { accountId, labelId } },
    update: {},
    create: { accountId, labelId, name: nomeProvisorio(labelId) },
  });
}

/**
 * O contato da conversa etiquetada.
 *
 * A etiqueta chega ora pelo telefone, ora pelo LID da conversa. Criar um
 * contato novo para o LID de quem já está no funil pelo telefone duplicava o
 * lead — e a etiqueta movia a cópia, não o card que você estava vendo. Quando
 * só o LID é conhecido, as mensagens da conversa dizem o telefone — e o nome
 * da pessoa, para o lead de quem nunca falou com o CRM não entrar sem nome.
 */
async function contatoDaConversa(conta: { id: string; instanceName: string }, chatId: string) {
  const achado = await acharContato(conta.id, chatId);
  if (achado?.waJid.endsWith("@s.whatsapp.net")) return achado;
  // Sem a Evolution, fica com o identificador que veio.
  const { alt, pushName } = await pelaConversa(conta.instanceName, chatId);
  return upsertContact({ accountId: conta.id, waJid: chatId, alt, pushName });
}

/**
 * Depois de mover: o score (uma dúzia de idas ao banco) e, para o lead que
 * acabou de entrar no funil pela etiqueta, as últimas mensagens da conversa —
 * sem elas o card nasce vazio, sem prévia nem temperatura.
 *
 * Roda numa fila própria, depois da resposta: com 50 conversas etiquetadas de
 * uma vez, os 50 leads mudam de coluna primeiro, e os scores vêm em seguida.
 */
function depoisDeMover(conta: { instanceName: string }, contactId: string, dealId: string, chatId: string, novo: boolean) {
  void emFila("etiquetas:depois", async () => {
    if (novo) await trazerConversaRecente(conta.instanceName, contactId, dealId, chatId);
    await recalculateScore(dealId);
    avisarMudanca({ dealIds: [dealId], motivo: "etiqueta" });
  }).catch((error) => console.warn(`Depois da etiqueta (lead ${dealId}):`, (error as Error).message));
}

const MENSAGENS_DO_LEAD_NOVO = 50;

async function trazerConversaRecente(instanceName: string, contactId: string, dealId: string, chatId: string) {
  let mensagens: EvolutionMessage[];
  try {
    mensagens = await evolution.findMessages(instanceName, chatId, MENSAGENS_DO_LEAD_NOVO);
  } catch {
    return; // A conversa chega depois, pela varredura ou pela próxima mensagem.
  }
  if (mensagens.length === 0) return;
  await ingestMessages(contactId, mensagens);

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

/** Fila das etiquetagens de uma conta: uma de cada vez, na ordem em que chegam. */
export function filaDeEtiquetas(accountId: string): string {
  return `etiquetas:${accountId}`;
}

/**
 * De onde vem a etiquetagem:
 *  - "celular": o evento do WhatsApp. Move para o estágio da etiqueta, para
 *    frente ou para trás — é você dizendo onde o lead está.
 *  - "mapeamento": você acabou de ligar a etiqueta a um estágio e o CRM está
 *    aplicando em quem JÁ estava com ela.
 */
export type OrigemEtiqueta = "celular" | "mapeamento";

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
  const nomes: { contato?: string; etiqueta?: string } = {};
  const resultado = await aplicar(accountId, chatId, labelId, origem, nomes);
  return { ...resultado, ...nomes };
}

async function aplicar(
  accountId: string,
  chatId: string,
  labelId: string,
  origem: OrigemEtiqueta,
  nomes: { contato?: string; etiqueta?: string },
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
  // Pelo mapeamento, ou na cópia do estado ao parear, não se sabe quando a
  // etiqueta foi posta: o lead só anda para a frente.
  const soParaFrente = origem === "mapeamento" || copiaDoEstado;
  // No mapeamento, quem já está com a etiqueta já tem a linha no histórico:
  // só ganha outra se algo acontecer.
  const registrarSempre = origem === "celular";

  // Etiqueta de "ignorar": o contato some do CRM (e não volta enquanto
  // estiver com ela). Vale mais que qualquer outra ação.
  if (etiqueta.ignoreContact) {
    await registrar(contato.id, labelId, etiqueta, "add", "Contato passou a ser ignorado pelo CRM");
    await ignorarContato(accountId, contato.waJid);
    return { acao: "ignorado", motivo: "contato marcado para ignorar" };
  }

  // Contato ignorado não volta para o funil por causa de outra etiqueta —
  // mas a etiqueta fica no histórico dele.
  if (contato.ignoredAt) {
    if (registrarSempre) await registrar(contato.id, labelId, etiqueta, "add", null);
    return { acao: "ignorado", motivo: "contato está ignorado" };
  }

  // Etiqueta de atendente: só registra quem atendeu. Não atribui o lead a
  // ninguém nem mexe no funil.
  if (etiqueta.isSeller) {
    const atendente = nomeDoAtendente(etiqueta);
    const anterior = await atendenteAnterior(contato.id);
    await registrar(contato.id, labelId, etiqueta, "add", textoDoAtendimento(anterior, atendente));
    return { acao: "atendente", atendente };
  }

  const estagio = etiqueta.stageId ? await prisma.stage.findUnique({ where: { id: etiqueta.stageId } }) : null;
  if (!estagio) {
    if (registrarSempre) await registrar(contato.id, labelId, etiqueta, "add", null);
    return {
      acao: "ignorado",
      motivo: "essa etiqueta/lista não está ligada a nenhum estágio — escolha o estágio dela na lista abaixo",
    };
  }

  const existente = await prisma.deal.findUnique({
    where: { contactId: contato.id },
    include: { stage: { select: { order: true, name: true } } },
  });

  if (soParaFrente && existente) {
    // Lead arquivado fica arquivado e lead que já avançou não volta.
    const motivo = existente.archivedAt
      ? "lead arquivado"
      : existente.stageId === estagio.id
        ? "o lead já está nesse estágio"
        : existente.stage.order > estagio.order
          ? `o lead já está adiante (${existente.stage.name})`
          : null;
    if (motivo) {
      if (registrarSempre) {
        await registrar(contato.id, labelId, etiqueta, "add", `Etiqueta já estava na conversa; ${motivo}`);
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
    depoisDeMover(conta, contato.id, deal.id, chatId, !existente);
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
      origem === "mapeamento" ? `${detalhe} (a conversa já estava com a etiqueta quando ela foi ligada ao estágio)` : detalhe,
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
export async function moverQuemJaTemAEtiqueta(
  accountId: string,
  labelId: string,
  conversas?: EvolutionChat[],
): Promise<number> {
  const [conta, etiqueta] = await Promise.all([
    prisma.whatsAppAccount.findUnique({ where: { id: accountId }, select: { instanceName: true } }),
    buscarEtiqueta(accountId, labelId),
  ]);
  if (!conta || !etiqueta?.stageId) return 0;

  // Todos, sem limite: 50 conversas com a etiqueta são 50 leads no estágio.
  // Pela mesma fila dos avisos do celular, para não atropelar um que chegue agora.
  let movidos = 0;
  for (const jid of await quemEstaComAEtiqueta(accountId, conta.instanceName, labelId, conversas)) {
    try {
      const r = await emFila(filaDeEtiquetas(accountId), () => aplicarEtiqueta(accountId, jid, labelId, "mapeamento"));
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
 * frente e sem mexer em lead arquivado. Roda no "Buscar do aparelho".
 */
export async function aplicarEtiquetasMapeadas(accountId: string): Promise<number> {
  const conta = await prisma.whatsAppAccount.findUnique({ where: { id: accountId }, select: { instanceName: true } });
  if (!conta) return 0;
  const mapeadas = await prisma.whatsAppLabel.findMany({
    where: { accountId, stageId: { not: null }, removedAt: null },
    select: { labelId: true },
  });
  if (mapeadas.length === 0) return 0;

  const conversas = await evolution.findChats(conta.instanceName).catch(() => [] as EvolutionChat[]);
  let movidos = 0;
  for (const { labelId } of mapeadas) {
    movidos += await moverQuemJaTemAEtiqueta(accountId, labelId, conversas);
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
  const [conta, etiqueta] = await Promise.all([
    prisma.whatsAppAccount.findUnique({ where: { id: accountId } }),
    buscarEtiqueta(accountId, labelId),
  ]);
  if (!conta || !etiqueta?.isSeller) return 0;

  await prisma.labelEvent.updateMany({
    where: { labelId, contact: { accountId }, kind: { notIn: TIPOS_ATENDENTE } },
    data: { kind: "atendente" },
  });

  let chats;
  try {
    chats = await evolution.findChats(conta.instanceName);
  } catch {
    return 0; // Evolution fora do ar: vale a partir da próxima etiquetagem.
  }

  let total = 0;
  for (const chat of chats) {
    const jid = chat.remoteJid ?? chat.id ?? "";
    if (!isPersonJid(jid) || !etiquetasDoChat(chat).includes(labelId)) continue;
    const contato = await upsertContact({ accountId, waJid: jid });
    if (contato.ignoredAt) continue;

    // Já registrado (a etiqueta foi aplicada com o CRM ligado): não repete.
    const ultimo = await prisma.labelEvent.findFirst({
      where: { contactId: contato.id, labelId },
      orderBy: { createdAt: "desc" },
      select: { action: true },
    });
    if (ultimo?.action === "add") continue;

    const anterior = await atendenteAnterior(contato.id);
    const texto = textoDoAtendimento(anterior, nomeDoAtendente(etiqueta));
    await registrar(
      contato.id,
      labelId,
      etiqueta,
      "add",
      texto ? `${texto} (etiqueta já estava no celular)` : "Etiqueta já estava no celular",
    );
    total++;
  }
  return total;
}
