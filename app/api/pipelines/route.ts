import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { avisarMudanca } from "@/lib/eventos";
import { COLUNAS_DE_FUNIL_NOVO } from "@/lib/funis";

/** Funis com quantos leads ativos cada um tem — o seletor do funil mostra isso. */
export async function GET() {
  const [funis, porColuna] = await Promise.all([
    prisma.pipeline.findMany({
      orderBy: { order: "asc" },
      select: {
        id: true,
        name: true,
        order: true,
        stages: { orderBy: { order: "asc" }, select: { id: true, name: true, color: true, isWon: true, isLost: true } },
      },
    }),
    prisma.deal.groupBy({ by: ["stageId"], where: { archivedAt: null }, _count: { _all: true } }),
  ]);
  const leadsNaColuna = new Map(porColuna.map((c) => [c.stageId, c._count._all]));

  return NextResponse.json(
    funis.map((f) => ({
      ...f,
      leads: f.stages.reduce((s, c) => s + (leadsNaColuna.get(c.id) ?? 0), 0),
    })),
  );
}

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });

/** Cria um funil já com colunas, inclusive Ganho e Perdido. Entra no fim da lista. */
export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dê um nome ao funil." }, { status: 400 });

  const ultimo = await prisma.pipeline.findFirst({ orderBy: { order: "desc" }, select: { order: true } });
  const funil = await prisma.pipeline.create({
    data: {
      name: parsed.data.name,
      order: (ultimo?.order ?? -1) + 1,
      stages: { create: COLUNAS_DE_FUNIL_NOVO.map((c, i) => ({ ...c, order: i })) },
    },
  });

  avisarMudanca({ dealIds: [], motivo: "funil" });
  return NextResponse.json(funil, { status: 201 });
}
