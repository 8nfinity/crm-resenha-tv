import { prisma } from "@/lib/db";
import { createDealForContact, moveDealToStage, recalculateScore } from "@/lib/deals";
import { evolution } from "@/lib/evolution/client";
import { isPersonJid } from "@/lib/evolution/parse";
import { upsertContact } from "@/lib/ingest";
import { etiquetasDoChat, ignorarContato, voltarAMostrar } from "@/lib/ignorar";

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
      update: { name: etiqueta.name, color: etiqueta.color },
      create: {
        accountId,
        labelId: etiqueta.labelId,
        name: etiqueta.name,
        color: etiqueta.color,
      },
    });
  }

  // Etiquetas apagadas do celular somem daqui junto. Manter uma regra apontando
  // para etiqueta que não existe mais só geraria confusão na tela.
  const idsAtuais = doAparelho.map((e) => e.labelId);
  await prisma.whatsAppLabel.deleteMany({
    where: {
      accountId,
      ...(idsAtuais.length > 0 ? { labelId: { notIn: idsAtuais } } : {}),
    },
  });

  return prisma.whatsAppLabel.findMany({
    where: { accountId },
    include: { stage: true },
    orderBy: { name: "asc" },
  });
}

export type ResultadoEtiqueta =
  | { acao: "movido"; dealId: string; estagio: string }
  | { acao: "vendedor"; dealId: string; vendedor: string }
  | { acao: "ignorado"; motivo: string };

type EtiquetaComVendedor = Awaited<ReturnType<typeof buscarEtiqueta>>;

function buscarEtiqueta(accountId: string, labelId: string) {
  return prisma.whatsAppLabel.findUnique({
    where: { accountId_labelId: { accountId, labelId } },
    include: { sellerUser: { select: { id: true, name: true, active: true } } },
  });
}

/** Nome do vendedor de uma etiqueta: o usuário ligado a ela ou, sem ele, o nome da etiqueta. */
export function nomeDoVendedor(etiqueta: { name: string; sellerUser?: { name: string } | null }): string {
  return etiqueta.sellerUser?.name ?? etiqueta.name;
}

/** O que a etiqueta faz, na palavra que vai para o histórico. */
function tipoDa(etiqueta: NonNullable<EtiquetaComVendedor> | null): string {
  if (!etiqueta) return "nenhum";
  if (etiqueta.ignoreContact) return "ignorar";
  if (etiqueta.isSeller) return "vendedor";
  if (etiqueta.stageId) return "estagio";
  return "nenhum";
}

/**
 * Grava uma linha no histórico de etiquetas do contato — vale para TODA
 * etiqueta, mesmo as que não fazem nada no CRM: o histórico mostra o que
 * aconteceu na conversa, não só o que o CRM fez com isso.
 */
async function registrar(
  contactId: string,
  labelId: string,
  etiqueta: NonNullable<EtiquetaComVendedor> | null,
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
 * Coloca o lead com o vendedor da etiqueta. Cria o lead se a conversa ainda
 * não estava no funil (etiquetar com um vendedor é dizer "este é cliente").
 */
async function atribuirVendedor(contactId: string, etiqueta: NonNullable<EtiquetaComVendedor>) {
  const deal = await createDealForContact(contactId);
  const vendedor = nomeDoVendedor(etiqueta);
  const anterior = deal.ownerName;
  await prisma.deal.update({
    where: { id: deal.id },
    data: { ownerName: vendedor, ownerUserId: etiqueta.sellerUser?.active ? etiqueta.sellerUser.id : null },
  });
  const detalhe =
    anterior && anterior !== vendedor
      ? `Passou do vendedor ${anterior} para ${vendedor}`
      : anterior === vendedor
        ? `Continua com o vendedor ${vendedor}`
        : `Passou para o vendedor ${vendedor}`;
  return { dealId: deal.id, vendedor, detalhe };
}

/**
 * Processa uma etiquetagem vinda do celular.
 *
 * Toda etiqueta vai para o histórico do contato. Além disso, conforme o que
 * ela faz no CRM: ignora o contato, define o vendedor do lead ou move o lead
 * de estágio. Se a conversa ainda não é um lead, ela vira um — etiquetar é
 * justamente o gesto de dizer "esta pessoa interessa".
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

  if (etiqueta?.isSeller) {
    const r = await atribuirVendedor(contato.id, etiqueta);
    await registrar(contato.id, labelId, etiqueta, "add", r.detalhe);
    return { acao: "vendedor", dealId: r.dealId, vendedor: r.vendedor };
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
 *
 * Etiqueta de VENDEDOR: se o lead estava com esse vendedor, fica sem
 * vendedor até outra etiqueta de vendedor ser aplicada.
 */
export async function removerEtiqueta(
  accountId: string,
  chatId: string,
  labelId: string,
): Promise<ResultadoEtiqueta> {
  if (!isPersonJid(chatId)) return { acao: "ignorado", motivo: "não é uma conversa pessoal" };

  const etiqueta = await buscarEtiqueta(accountId, labelId);
  const contato = await prisma.contact.findUnique({
    where: { accountId_waJid: { accountId, waJid: chatId } },
    select: { id: true },
  });
  if (!contato) return { acao: "ignorado", motivo: "contato desconhecido" };

  if (etiqueta?.ignoreContact) {
    await voltarAMostrar(contato.id);
    await registrar(contato.id, labelId, etiqueta, "remove", "Contato voltou a aparecer no CRM");
    return { acao: "ignorado", motivo: "contato voltou a aparecer" };
  }

  if (etiqueta?.isSeller) {
    const vendedor = nomeDoVendedor(etiqueta);
    const deal = await prisma.deal.findUnique({ where: { contactId: contato.id } });
    let detalhe: string | null = null;
    if (deal?.ownerName === vendedor) {
      await prisma.deal.update({ where: { id: deal.id }, data: { ownerName: null, ownerUserId: null } });
      detalhe = `Saiu do vendedor ${vendedor} (ficou sem vendedor)`;
    }
    await registrar(contato.id, labelId, etiqueta, "remove", detalhe);
    return { acao: "ignorado", motivo: "etiqueta de vendedor retirada" };
  }

  await registrar(contato.id, labelId, etiqueta, "remove", null);
  return { acao: "ignorado", motivo: "remoção de etiqueta não move o lead" };
}

/**
 * Ao marcar uma etiqueta como "de vendedor", aplica nos leads que JÁ estavam
 * com ela no celular. Devolve quantos leads ficaram com o vendedor.
 */
export async function atribuirVendedorQuemJaTemAEtiqueta(accountId: string, labelId: string): Promise<number> {
  const [conta, etiqueta] = await Promise.all([
    prisma.whatsAppAccount.findUnique({ where: { id: accountId } }),
    buscarEtiqueta(accountId, labelId),
  ]);
  if (!conta || !etiqueta?.isSeller) return 0;

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
    const r = await atribuirVendedor(contato.id, etiqueta);
    await registrar(contato.id, labelId, etiqueta, "add", `${r.detalhe} (etiqueta já estava no celular)`);
    total++;
  }
  return total;
}
