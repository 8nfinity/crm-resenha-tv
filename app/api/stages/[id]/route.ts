import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { avisarMudanca } from "@/lib/eventos";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Troca de lugar com a coluna vizinha. */
  mover: z.enum(["esquerda", "direita"]).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const { mover, ...campos } = parsed.data;

  const atual = await prisma.stage.findUnique({ where: { id } });
  if (!atual) return NextResponse.json({ error: "Coluna não encontrada" }, { status: 404 });

  if (mover) {
    // Só troca com vizinha do mesmo funil e do mesmo tipo: uma coluna em
    // andamento não passa para depois de Ganho/Perdido, que fecham o funil.
    const mesmoTipo = { pipelineId: atual.pipelineId, isWon: atual.isWon, isLost: atual.isLost };
    const vizinha = await prisma.stage.findFirst({
      where:
        mover === "esquerda"
          ? { ...mesmoTipo, order: { lt: atual.order } }
          : { ...mesmoTipo, order: { gt: atual.order } },
      orderBy: { order: mover === "esquerda" ? "desc" : "asc" },
    });
    if (vizinha) {
      // `order` é único: a troca passa por um valor provisório, senão o
      // primeiro update colide com a vizinha que ainda ocupa o lugar.
      await prisma.$transaction([
        prisma.stage.update({ where: { id: atual.id }, data: { order: -1_000_000 } }),
        prisma.stage.update({ where: { id: vizinha.id }, data: { order: atual.order } }),
        prisma.stage.update({ where: { id: atual.id }, data: { order: vizinha.order } }),
      ]);
    }
  }

  const stage =
    Object.keys(campos).length > 0
      ? await prisma.stage.update({ where: { id }, data: campos })
      : await prisma.stage.findUniqueOrThrow({ where: { id } });

  avisarMudanca({ dealIds: [], motivo: "funil" });
  return NextResponse.json(stage);
}

/**
 * Exclui uma coluna.
 *
 * Vazia e sem histórico: sai direto. Com leads ou histórico, é preciso dizer
 * para onde vão (`?moverPara=<id>`): os leads mudam para lá e o histórico de
 * passagens é FUNDIDO na coluna de destino — as métricas passam a contar as
 * duas como uma só, em vez de perder o passado. Passagens que viram "de X
 * para X" com a fusão são descartadas, porque não representam movimento.
 *
 * Ganho e Perdido não saem: são eles que dão sentido a conversão e perdas.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const moverPara = new URL(request.url).searchParams.get("moverPara");

  const stage = await prisma.stage.findUnique({ where: { id } });
  if (!stage) return NextResponse.json({ error: "Coluna não encontrada" }, { status: 404 });

  if (stage.isWon || stage.isLost) {
    return NextResponse.json(
      {
        error: `"${stage.name}" é uma coluna final: é ela que conta os ${
          stage.isWon ? "ganhos" : "perdidos"
        } nas métricas. Renomeie em vez de excluir.`,
      },
      { status: 409 },
    );
  }

  // Lead novo cai na primeira coluna em andamento do funil: sem nenhuma, ele
  // não teria onde entrar.
  const emAndamento = await prisma.stage.count({
    where: { pipelineId: stage.pipelineId, isWon: false, isLost: false },
  });
  if (emAndamento <= 1) {
    return NextResponse.json(
      { error: `"${stage.name}" é a única coluna em andamento deste funil — é nela que os leads novos entram. Crie outra antes de excluir.` },
      { status: 409 },
    );
  }

  const [deals, transicoes] = await Promise.all([
    prisma.deal.count({ where: { stageId: id } }),
    prisma.stageTransition.count({ where: { OR: [{ toStageId: id }, { fromStageId: id }] } }),
  ]);

  if ((deals > 0 || transicoes > 0) && !moverPara) {
    return NextResponse.json(
      { error: "Escolha para qual coluna vão os leads desta.", deals, precisaDestino: true },
      { status: 409 },
    );
  }

  if (moverPara) {
    if (moverPara === id) {
      return NextResponse.json({ error: "O destino precisa ser outra coluna." }, { status: 400 });
    }
    const destino = await prisma.stage.findUnique({ where: { id: moverPara } });
    if (!destino) return NextResponse.json({ error: "Coluna de destino não existe." }, { status: 400 });

    await prisma.$transaction([
      prisma.deal.updateMany({ where: { stageId: id }, data: { stageId: moverPara } }),
      prisma.stageTransition.updateMany({ where: { toStageId: id }, data: { toStageId: moverPara } }),
      prisma.stageTransition.updateMany({ where: { fromStageId: id }, data: { fromStageId: moverPara } }),
      prisma.stageTransition.deleteMany({ where: { fromStageId: moverPara, toStageId: moverPara } }),
      // Etiqueta do WhatsApp que levava para cá passa a levar para o destino.
      prisma.whatsAppLabel.updateMany({ where: { stageId: id }, data: { stageId: moverPara } }),
      prisma.systemState.updateMany({ where: { pipedriveAutoStageId: id }, data: { pipedriveAutoStageId: moverPara } }),
      prisma.stage.delete({ where: { id } }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.systemState.updateMany({ where: { pipedriveAutoStageId: id }, data: { pipedriveAutoStageId: null } }),
      prisma.stage.delete({ where: { id } }),
    ]);
  }

  avisarMudanca({ dealIds: [], motivo: "funil" });
  return NextResponse.json({ ok: true, movidos: deals });
}
