import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { avisarMudanca } from "@/lib/eventos";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  /** Troca de lugar com o funil vizinho na lista. */
  mover: z.enum(["cima", "baixo"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { mover, ...campos } = parsed.data;

  const atual = await prisma.pipeline.findUnique({ where: { id } });
  if (!atual) return NextResponse.json({ error: "Funil não encontrado" }, { status: 404 });

  if (mover) {
    const vizinho = await prisma.pipeline.findFirst({
      where: { order: mover === "cima" ? { lt: atual.order } : { gt: atual.order } },
      orderBy: { order: mover === "cima" ? "desc" : "asc" },
    });
    if (vizinho) {
      // `order` é único: a troca passa por um valor provisório.
      await prisma.$transaction([
        prisma.pipeline.update({ where: { id: atual.id }, data: { order: -1_000_000 } }),
        prisma.pipeline.update({ where: { id: vizinho.id }, data: { order: atual.order } }),
        prisma.pipeline.update({ where: { id: atual.id }, data: { order: vizinho.order } }),
      ]);
    }
  }

  const funil =
    Object.keys(campos).length > 0
      ? await prisma.pipeline.update({ where: { id }, data: campos })
      : await prisma.pipeline.findUniqueOrThrow({ where: { id } });

  avisarMudanca({ dealIds: [], motivo: "funil" });
  return NextResponse.json(funil);
}

/**
 * Exclui um funil.
 *
 * Sem leads e sem histórico: sai direto. Com eles, é preciso dizer para qual
 * coluna (de outro funil) vão os leads (`?moverPara=<id da coluna>`). Como na
 * exclusão de coluna, o histórico de passagens é FUNDIDO no destino em vez de
 * apagado — as métricas não perdem o passado. Números que tinham este funil
 * como entrada voltam a usar o primeiro funil. O último funil não sai.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const moverPara = new URL(request.url).searchParams.get("moverPara");

  const funil = await prisma.pipeline.findUnique({ where: { id }, include: { stages: { select: { id: true } } } });
  if (!funil) return NextResponse.json({ error: "Funil não encontrado" }, { status: 404 });

  if ((await prisma.pipeline.count()) <= 1) {
    return NextResponse.json({ error: "É o único funil. Renomeie em vez de excluir." }, { status: 409 });
  }

  const colunas = funil.stages.map((s) => s.id);
  const [deals, transicoes] = await Promise.all([
    prisma.deal.count({ where: { stageId: { in: colunas } } }),
    prisma.stageTransition.count({
      where: { OR: [{ toStageId: { in: colunas } }, { fromStageId: { in: colunas } }] },
    }),
  ]);

  if ((deals > 0 || transicoes > 0) && !moverPara) {
    return NextResponse.json(
      { error: "Escolha para qual coluna de outro funil vão os leads deste.", deals, precisaDestino: true },
      { status: 409 },
    );
  }

  if (moverPara) {
    const destino = await prisma.stage.findUnique({ where: { id: moverPara } });
    if (!destino || destino.pipelineId === id) {
      return NextResponse.json({ error: "O destino precisa ser uma coluna de outro funil." }, { status: 400 });
    }
  }

  await prisma.$transaction([
    ...(moverPara
      ? [
          prisma.deal.updateMany({ where: { stageId: { in: colunas } }, data: { stageId: moverPara } }),
          prisma.stageTransition.updateMany({ where: { toStageId: { in: colunas } }, data: { toStageId: moverPara } }),
          prisma.stageTransition.updateMany({ where: { fromStageId: { in: colunas } }, data: { fromStageId: moverPara } }),
          prisma.stageTransition.deleteMany({ where: { fromStageId: moverPara, toStageId: moverPara } }),
          prisma.whatsAppLabel.updateMany({ where: { stageId: { in: colunas } }, data: { stageId: moverPara } }),
        ]
      : [prisma.whatsAppLabel.updateMany({ where: { stageId: { in: colunas } }, data: { stageId: null } })]),
    // A coluna de envio automático ao Pipedrive não pode apontar para o nada.
    prisma.systemState.updateMany({
      where: { pipedriveAutoStageId: { in: colunas } },
      data: { pipedriveAutoStageId: null },
    }),
    prisma.stage.deleteMany({ where: { pipelineId: id } }),
    prisma.pipeline.delete({ where: { id } }),
  ]);

  avisarMudanca({ dealIds: [], motivo: "funil" });
  return NextResponse.json({ ok: true, movidos: deals });
}
