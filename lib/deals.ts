import { prisma } from "@/lib/db";
import { averageResponseHours, calculateScore, type ScoreResult } from "@/lib/scoring";

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
  return prisma.$transaction(async (tx) => {
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

    return tx.deal.update({
      where: { id: dealId },
      data: { stageId: toStageId, enteredStageAt: now },
    });
  });
}

/**
 * Cria o deal de um contato, já com a transição de nascimento registrada.
 * Idempotente: se o contato já tem deal, devolve o existente.
 */
export async function createDealForContact(contactId: string, stageId?: string) {
  const existing = await prisma.deal.findUnique({ where: { contactId } });
  if (existing) return existing;

  const firstStage = stageId
    ? await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })
    : await primeiraColuna();

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
    if (!stageId && colunaGuardada && (error as { code?: string }).code === "P2003") {
      colunaGuardada = null;
      return createDealForContact(contactId);
    }
    throw error;
  }
}

/**
 * Primeira coluna em andamento (onde todo lead novo entra), guardada por
 * 30 s. Cada lead novo pagava uma ida ao banco só para descobrir isso.
 */
let colunaGuardada: { id: string; ate: number } | null = null;

async function primeiraColuna(): Promise<{ id: string }> {
  if (colunaGuardada && colunaGuardada.ate > Date.now()) return { id: colunaGuardada.id };
  const stage = await prisma.stage.findFirstOrThrow({
    where: { isWon: false, isLost: false },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  colunaGuardada = { id: stage.id, ate: Date.now() + 30_000 };
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

  const activeStages = await prisma.stage.count({
    where: { isWon: false, isLost: false },
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
