import { prisma } from "@/lib/db";
import { averageResponseHours, calculateScore, type ScoreResult } from "@/lib/scoring";
import { envioAutomatico } from "@/lib/pipedrive";

/**
 * Operações sobre deals.
 *
 * Regra que não pode ser contornada: NADA muda `Deal.stageId` direto. Toda
 * mudança passa por `moveDealToStage`, que grava a linha correspondente em
 * `StageTransition` na mesma transação. Se alguém escrever o estágio pela
 * lateral, as métricas de conversão silenciosamente passam a mentir — e o erro
 * só aparece meses depois, quando não dá mais para reconstruir o histórico.
 */

/** Move um card de coluna e registra a passagem. Atômico. */
export async function moveDealToStage(dealId: string, toStageId: string) {
  let moveu = false;
  const resultado = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findUniqueOrThrow({
      where: { id: dealId },
      select: { id: true, stageId: true, enteredStageAt: true },
    });

    if (deal.stageId === toStageId) return deal;

    const now = new Date();
    const hoursInFrom =
      (now.getTime() - deal.enteredStageAt.getTime()) / (1000 * 60 * 60);

    await tx.stageTransition.create({
      data: {
        dealId,
        fromStageId: deal.stageId,
        toStageId,
        at: now,
        hoursInFrom,
      },
    });

    moveu = true;
    return tx.deal.update({
      where: { id: dealId },
      data: { stageId: toStageId, enteredStageAt: now },
    });
  });

  // Coluna com envio automático ao Pipedrive: vale para arrasto, etiqueta e
  // painel, porque todo movimento passa por aqui. Não espera nem atrapalha.
  if (moveu) void envioAutomatico(dealId, toStageId);
  return resultado;
}

/**
 * Cria o deal de um contato, já com a transição de nascimento registrada.
 * Idempotente: se o contato já tem deal, devolve o existente.
 *
 * Sem estágio informado, o lead entra na primeira coluna do funil de entrada
 * do número de WhatsApp por onde ele chegou.
 */
export async function createDealForContact(contactId: string, stageId?: string) {
  const existing = await prisma.deal.findUnique({ where: { contactId } });
  if (existing) return existing;

  const firstStage = stageId
    ? await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })
    : await primeiraColuna(await funilDeEntrada(contactId));

  try {
    return await prisma.$transaction(async (tx) => {
      const deal = await tx.deal.create({
        data: { contactId, stageId: firstStage.id },
      });
      // `fromStageId` nulo marca a entrada no funil.
      await tx.stageTransition.create({
        data: { dealId: deal.id, fromStageId: null, toStageId: firstStage.id },
      });
      return deal;
    });
  } catch (error) {
    // Corrida: a importação e o webhook (ou duas importações) criaram o deal
    // do mesmo contato ao mesmo tempo. Quem perdeu usa o do vencedor — o
    // resultado é o mesmo que teria saído sem a disputa.
    if ((error as { code?: string }).code === "P2002") {
      const vencedor = await prisma.deal.findUnique({ where: { contactId } });
      if (vencedor) return vencedor;
    }
    // Coluna guardada foi excluída nesse meio-tempo: esquece e tenta de novo
    // com a primeira coluna atual.
    if (!stageId && colunasGuardadas.size > 0 && (error as { code?: string }).code === "P2003") {
      colunasGuardadas.clear();
      return createDealForContact(contactId);
    }
    throw error;
  }
}

/**
 * Lead do contato quando chega mensagem ou importação: o que já existe, ou
 * um novo. Nulo quando o número está no modo "só entram contatos
 * etiquetados" e este ainda não é lead — a conversa fica guardada, e o lead
 * nasce quando a etiqueta for posta no celular (ver lib/labels.ts).
 */
export async function leadAutomatico(contactId: string): Promise<{ id: string } | null> {
  const contato = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { deals: { select: { id: true }, take: 1 }, account: { select: { soComEtiqueta: true } } },
  });
  if (!contato) return null;
  if (contato.deals[0]) return contato.deals[0];
  if (contato.account.soComEtiqueta) return null;
  return createDealForContact(contactId);
}

/**
 * Funil onde caem os leads novos do número por onde o contato chegou. Nulo:
 * o número não escolheu, vale o primeiro funil.
 */
async function funilDeEntrada(contactId: string): Promise<string | null> {
  const contato = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { account: { select: { entryPipelineId: true } } },
  });
  return contato?.account.entryPipelineId ?? null;
}

/**
 * Primeira coluna em andamento de um funil (onde o lead novo entra), guardada
 * por 30 s. Cada lead novo pagava uma ida ao banco só para descobrir isso.
 * `null` é o primeiro funil.
 */
const colunasGuardadas = new Map<string, { id: string; ate: number }>();

async function primeiraColuna(pipelineId: string | null): Promise<{ id: string }> {
  const chave = pipelineId ?? "";
  const guardada = colunasGuardadas.get(chave);
  if (guardada && guardada.ate > Date.now()) return { id: guardada.id };

  const emAndamento = { isWon: false, isLost: false };
  const stage =
    (pipelineId &&
      (await prisma.stage.findFirst({
        where: { ...emAndamento, pipelineId },
        orderBy: { order: "asc" },
        select: { id: true },
      }))) ||
    // Sem funil escolhido (ou o escolhido sumiu): o primeiro funil.
    (await prisma.stage.findFirstOrThrow({
      where: emAndamento,
      orderBy: [{ pipeline: { order: "asc" } }, { order: "asc" }],
      select: { id: true },
    }));
  colunasGuardadas.set(chave, { id: stage.id, ate: Date.now() + 30_000 });
  return stage;
}

/**
 * Recalcula o score de um deal a partir das mensagens do contato.
 * Chamado pelo webhook a cada mensagem nova e pelo cron diário (a passagem do
 * tempo sozinha esfria um lead, mesmo sem nada acontecer).
 */
export async function recalculateScore(dealId: string): Promise<ScoreResult | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { stage: true },
  });
  if (!deal) return null;

  const messages = await prisma.message.findMany({
    where: { contactId: deal.contactId },
    select: { fromMe: true, timestamp: true },
    orderBy: { timestamp: "asc" },
  });

  const inbound = messages.filter((m) => !m.fromMe);
  const outbound = messages.filter((m) => m.fromMe);

  // A posição do lead conta dentro do funil dele: a 2ª de 3 colunas num funil
  // curto é tão adiante quanto a 4ª de 6 num funil longo.
  const activeStages = await prisma.stage.count({
    where: { isWon: false, isLost: false, pipelineId: deal.stage.pipelineId },
  });

  const result = calculateScore({
    lastInboundAt: inbound.at(-1)?.timestamp ?? null,
    lastInteractionAt: messages.at(-1)?.timestamp ?? null,
    enteredStageAt: deal.enteredStageAt,
    stageOrder: deal.stage.order,
    totalStages: Math.max(activeStages, 1),
    isWon: deal.stage.isWon,
    isLost: deal.stage.isLost,
    inboundCount: inbound.length,
    outboundCount: outbound.length,
    avgResponseHours: averageResponseHours(messages),
    value: deal.value ? Number(deal.value) : null,
  });

  await prisma.deal.update({
    where: { id: dealId },
    data: {
      score: result.score,
      scoreFactors: {
        summary: result.summary,
        factors: result.factors,
      },
      scoreUpdatedAt: new Date(),
      lastInboundAt: inbound.at(-1)?.timestamp ?? null,
      lastInteractionAt: messages.at(-1)?.timestamp ?? null,
    },
  });

  return result;
}

/** Recalcula todos os deals ativos. Usado pelo cron e pelo fim da importação. */
export async function recalculateAllScores(): Promise<number> {
  const deals = await prisma.deal.findMany({
    where: { archivedAt: null },
    select: { id: true },
  });

  for (const deal of deals) {
    await recalculateScore(deal.id);
  }
  return deals.length;
}
