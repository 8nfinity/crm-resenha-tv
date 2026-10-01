import { prisma } from "@/lib/db";
import { createDealForContact, moveDealToStage, recalculateScore } from "@/lib/deals";
import { evolution } from "@/lib/evolution/client";
import { isPersonJid } from "@/lib/evolution/parse";
import { upsertContact } from "@/lib/ingest";
import { estaIgnorado, ignorarContato, voltarAMostrar } from "@/lib/ignorar";

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
  | { acao: "ignorado"; motivo: string };

/**
 * Processa uma etiquetagem vinda do celular.
 *
 * Se a conversa ainda não é um lead, ela vira um — etiquetar é justamente o
 * gesto de dizer "esta pessoa interessa", então criar o card é o que você
 * espera que aconteça.
 */
export async function aplicarEtiqueta(
  accountId: string,
  chatId: string,
  labelId: string,
): Promise<ResultadoEtiqueta> {
  if (!isPersonJid(chatId)) {
    return { acao: "ignorado", motivo: "não é uma conversa pessoal" };
  }

  const etiqueta = await prisma.whatsAppLabel.findUnique({
    where: { accountId_labelId: { accountId, labelId } },
  });

  // Etiqueta desconhecida: pode ter sido criada no celular depois da última
  // sincronização. Registra para aparecer na tela de mapeamento, mas não
  // inventa um destino no funil.
  if (!etiqueta) {
    await prisma.whatsAppLabel.create({
      data: { accountId, labelId, name: `Etiqueta ${labelId}` },
    });
    return { acao: "ignorado", motivo: "etiqueta ainda não mapeada" };
  }

  // Etiqueta de "ignorar": o contato some do CRM (e não volta enquanto
  // estiver com ela). Vale mais que qualquer mapeamento de estágio.
  if (etiqueta.ignoreContact) {
    await ignorarContato(accountId, chatId);
    return { acao: "ignorado", motivo: "contato marcado para ignorar" };
  }

  if (!etiqueta.stageId) {
    return { acao: "ignorado", motivo: "etiqueta sem estágio mapeado" };
  }

  // Contato ignorado não volta para o funil por causa de outra etiqueta.
  if (await estaIgnorado(accountId, chatId)) {
    return { acao: "ignorado", motivo: "contato está ignorado" };
  }

  const estagio = await prisma.stage.findUnique({ where: { id: etiqueta.stageId } });
  if (!estagio) {
    return { acao: "ignorado", motivo: "estágio mapeado não existe mais" };
  }

  // Etiquetar uma conversa que ainda não está no funil traz ela para dentro.
  const contato = await upsertContact({ accountId, waJid: chatId });
  const deal = await createDealForContact(contato.id);

  if (deal.stageId === etiqueta.stageId) {
    return { acao: "ignorado", motivo: "o lead já está nesse estágio" };
  }

  // moveDealToStage grava a transição: a etiquetagem entra no histórico do
  // funil igual a um arrasto manual, e as métricas de conversão contam ela.
  await moveDealToStage(deal.id, etiqueta.stageId);
  await recalculateScore(deal.id);

  return { acao: "movido", dealId: deal.id, estagio: estagio.name };
}

/**
 * Remoção de etiqueta.
 *
 * Etiqueta de ESTÁGIO: não faz nada, e isso é uma decisão, não um
 * esquecimento — tirar "Reunião marcada" não diz para onde o lead deveria
 * voltar, e adivinhar errado bagunça o histórico de conversão.
 *
 * Etiqueta de IGNORAR: aí o sentido é claro. Tirar a etiqueta traz o contato
 * de volta ao CRM, do jeito que estava.
 */
export async function removerEtiqueta(
  accountId: string,
  chatId: string,
  labelId: string,
): Promise<ResultadoEtiqueta> {
  const etiqueta = await prisma.whatsAppLabel.findUnique({
    where: { accountId_labelId: { accountId, labelId } },
  });
  if (!etiqueta?.ignoreContact) {
    return { acao: "ignorado", motivo: "remoção de etiqueta não move o lead" };
  }

  const contato = await prisma.contact.findUnique({
    where: { accountId_waJid: { accountId, waJid: chatId } },
    select: { id: true },
  });
  if (contato) await voltarAMostrar(contato.id);
  return { acao: "ignorado", motivo: "contato voltou a aparecer" };
}
