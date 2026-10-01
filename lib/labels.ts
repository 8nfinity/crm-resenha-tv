import { prisma } from "@/lib/db";
import { createDealForContact, moveDealToStage, recalculateScore } from "@/lib/deals";
import { evolution } from "@/lib/evolution/client";
import { isPersonJid } from "@/lib/evolution/parse";
import { acharContato, upsertContact } from "@/lib/ingest";
import { etiquetasDoChat, ignorarContato, voltarAMostrar } from "@/lib/ignorar";
import { corrigirNomeEtiqueta } from "@/lib/etiquetas-nomes";

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

  for (const etiqueta of doAparelho) {
    await prisma.whatsAppLabel.upsert({
      where: {
        accountId_labelId: { accountId, labelId: etiqueta.labelId },
      },
      update: { name: corrigirNomeEtiqueta(etiqueta.name), color: etiqueta.color },
      create: {
        accountId,
        labelId: etiqueta.labelId,
        name: corrigirNomeEtiqueta(etiqueta.name),
        color: etiqueta.color,
      },
    });
  }

  // Etiquetas apagadas do celular somem daqui junto. Manter uma regra apontando
  // para etiqueta que não existe mais só geraria confusão na tela.
  // Lista VAZIA não apaga nada: quase sempre é a Evolution que ainda não
  // recebeu as etiquetas, e apagar levaria junto toda a configuração feita.
  const idsAtuais = doAparelho.map((e) => e.labelId);
  if (idsAtuais.length > 0) {
    await prisma.whatsAppLabel.deleteMany({ where: { accountId, labelId: { notIn: idsAtuais } } });
  }

  return prisma.whatsAppLabel.findMany({
    where: { accountId },
    include: { stage: true },
    orderBy: { name: "asc" },
  });
}

/** Id que não existe em nenhum celular: retirá-la de uma conversa não muda nada. */
const ETIQUETA_INEXISTENTE = "987654321";

/**
 * Força a Evolution a ler as etiquetas do WhatsApp agora, sem desconectar.
 *
 * As etiquetas chegam por um canal separado das mensagens (os "dados da
 * conta"), e às vezes a conexão nunca faz essa leitura. Pedir para RETIRAR
 * uma etiqueta inexistente da conversa "Mensagem para mim" não muda nada no
 * celular, mas obriga a biblioteca do WhatsApp a baixar antes todas as
 * etiquetas da conta e quem está com cada uma — e a Evolution repassa ao CRM.
 *
 * Se o WhatsApp nunca entregou a chave desses dados para esta conexão, a
 * resposta diz exatamente isso ("App state key not present").
 */
export async function forcarLeituraDasEtiquetas(accountId: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const conta = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
  if (!conta) return { ok: false, erro: "Conta não encontrada." };
  if (conta.status !== "open") return { ok: false, erro: "Conecte o número antes de buscar as etiquetas." };

  const numero =
    conta.phone ??
    (await prisma.contact.findFirst({ where: { accountId, phone: { not: null } }, select: { phone: true } }))?.phone;
  if (!numero) return { ok: false, erro: "Não encontrei um número desta conta para fazer a leitura." };

  try {
    await evolution.handleLabel(conta.instanceName, numero, ETIQUETA_INEXISTENTE, "remove");
    return { ok: true };
  } catch (error) {
    const detalhe = `${(error as Error).message} ${(error as { body?: string }).body ?? ""}`;
    if (/myAppStateKey .*not present/i.test(detalhe)) {
      // A conexão sabe QUAL chave abre os dados da conta, mas o arquivo dela
      // sumiu: a Evolution reiniciou sem volume em /evolution/instances.
      return {
        ok: false,
        erro:
          "A Evolution perdeu a chave que abre as etiquetas (ela reiniciou e os arquivos da sessão não foram " +
          "guardados). Confira se o serviço da Evolution na Railway tem um volume em /evolution/instances e " +
          "conecte o número de novo — a chave volta no pareamento.",
      };
    }
    if (/app state key not present/i.test(detalhe)) {
      return {
        ok: false,
        erro:
          "O WhatsApp ainda não enviou a chave das etiquetas para esta conexão. Espere alguns minutos depois de " +
          "conectar e tente de novo; se continuar, conecte o número de novo.",
      };
    }
    return { ok: false, erro: `A leitura forçada das etiquetas falhou: ${detalhe.trim().slice(0, 300)}` };
  }
}

export type ResultadoEtiqueta =
  | { acao: "movido"; dealId: string; estagio: string }
  | { acao: "atendente"; atendente: string }
  | { acao: "ignorado"; motivo: string };

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

/**
 * Processa uma etiquetagem vinda do celular.
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
): Promise<ResultadoEtiqueta> {
  if (!isPersonJid(chatId)) {
    return { acao: "ignorado", motivo: "não é uma conversa pessoal" };
  }

  let etiqueta = await buscarEtiqueta(accountId, labelId);

  // Etiqueta desconhecida: pode ter sido criada no celular depois da última
  // sincronização. Registra para aparecer na tela de mapeamento.
  if (!etiqueta) {
    await prisma.whatsAppLabel.create({ data: { accountId, labelId, name: `Etiqueta ${labelId}` } });
    etiqueta = await buscarEtiqueta(accountId, labelId);
  }

  const contato = await upsertContact({ accountId, waJid: chatId });

  // Etiqueta de "ignorar": o contato some do CRM (e não volta enquanto
  // estiver com ela). Vale mais que qualquer outra ação.
  if (etiqueta?.ignoreContact) {
    await registrar(contato.id, labelId, etiqueta, "add", "Contato passou a ser ignorado pelo CRM");
    await ignorarContato(accountId, chatId);
    return { acao: "ignorado", motivo: "contato marcado para ignorar" };
  }

  // Contato ignorado não volta para o funil por causa de outra etiqueta —
  // mas a etiqueta fica no histórico dele.
  if (contato.ignoredAt) {
    await registrar(contato.id, labelId, etiqueta, "add", null);
    return { acao: "ignorado", motivo: "contato está ignorado" };
  }

  // Etiqueta de atendente: só registra quem atendeu. Não atribui o lead a
  // ninguém nem mexe no funil.
  if (etiqueta?.isSeller) {
    const atendente = nomeDoAtendente(etiqueta);
    const anterior = await atendenteAnterior(contato.id);
    await registrar(contato.id, labelId, etiqueta, "add", textoDoAtendimento(anterior, atendente));
    return { acao: "atendente", atendente };
  }

  const estagio = etiqueta?.stageId ? await prisma.stage.findUnique({ where: { id: etiqueta.stageId } }) : null;
  if (!estagio) {
    await registrar(contato.id, labelId, etiqueta, "add", null);
    return { acao: "ignorado", motivo: "etiqueta sem estágio mapeado" };
  }

  // Etiquetar uma conversa que ainda não está no funil traz ela para dentro.
  const deal = await createDealForContact(contato.id);
  if (deal.stageId === estagio.id) {
    await registrar(contato.id, labelId, etiqueta, "add", `Já estava em ${estagio.name}`);
    return { acao: "ignorado", motivo: "o lead já está nesse estágio" };
  }

  // moveDealToStage grava a transição: a etiquetagem entra no histórico do
  // funil igual a um arrasto manual, e as métricas de conversão contam ela.
  await moveDealToStage(deal.id, estagio.id);
  await recalculateScore(deal.id);
  await registrar(contato.id, labelId, etiqueta, "add", `Moveu para ${estagio.name}`);

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
  if (!isPersonJid(chatId)) return { acao: "ignorado", motivo: "não é uma conversa pessoal" };

  const etiqueta = await buscarEtiqueta(accountId, labelId);
  // A etiqueta pode chegar pelo telefone ou pelo LID da conversa.
  const contato = await acharContato(accountId, chatId);
  if (!contato) return { acao: "ignorado", motivo: "contato desconhecido" };

  if (etiqueta?.ignoreContact) {
    await voltarAMostrar(contato.id);
    await registrar(contato.id, labelId, etiqueta, "remove", "Contato voltou a aparecer no CRM");
    return { acao: "ignorado", motivo: "contato voltou a aparecer" };
  }

  await registrar(contato.id, labelId, etiqueta, "remove", null);
  return { acao: "ignorado", motivo: "remoção de etiqueta não move o lead" };
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
