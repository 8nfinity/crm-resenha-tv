import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { avisarMudanca } from "@/lib/eventos";

/** Todas as colunas de todos os funis, na ordem dos funis e depois das colunas. */
export async function GET() {
  const stages = await prisma.stage.findMany({
    orderBy: [{ pipeline: { order: "asc" } }, { order: "asc" }],
    include: {
      _count: { select: { deals: true } },
      pipeline: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(stages);
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#64748b"),
  /** Funil da coluna. Sem ele, o primeiro funil. */
  pipelineId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Nome inválido" }, { status: 400 });
  }

  const funil = parsed.data.pipelineId
    ? await prisma.pipeline.findUnique({ where: { id: parsed.data.pipelineId } })
    : await prisma.pipeline.findFirst({ orderBy: { order: "asc" } });
  if (!funil) return NextResponse.json({ error: "Funil não encontrado" }, { status: 404 });
  const pipelineId = funil.id;

  // Entra antes dos estágios finais: um estágio novo quase nunca deve ficar
  // depois de "Ganho" e "Perdido".
  const ultimoAtivo = await prisma.stage.findFirst({
    where: { pipelineId, isWon: false, isLost: false },
    orderBy: { order: "desc" },
  });
  const finais = await prisma.stage.findMany({
    where: { pipelineId, OR: [{ isWon: true }, { isLost: true }] },
    orderBy: { order: "asc" },
  });

  const novaOrdem = (ultimoAtivo?.order ?? -1) + 1;

  // `order` é único, então os finais precisam abrir espaço. Da maior ordem para
  // a menor, senão um update colide com o próximo valor ainda ocupado.
  return prisma.$transaction(async (tx) => {
    for (const final of [...finais].reverse()) {
      await tx.stage.update({
        where: { id: final.id },
        data: { order: final.order + 1 },
      });
    }

    const stage = await tx.stage.create({
      data: { name: parsed.data.name, color: parsed.data.color, order: novaOrdem, pipelineId },
    });

    return stage;
  }).then((stage) => {
    avisarMudanca({ dealIds: [], motivo: "funil" });
    return NextResponse.json(stage, { status: 201 });
  });
}
