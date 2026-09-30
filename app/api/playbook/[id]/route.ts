import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { avisarMudanca } from "@/lib/eventos";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().max(100_000).optional(),
  mover: z.enum(["cima", "baixo"]).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { mover, ...campos } = parsed.data;

  const atual = await prisma.playbookSection.findUnique({ where: { id } });
  if (!atual) return NextResponse.json({ error: "Seção não encontrada" }, { status: 404 });

  if (mover) {
    const vizinha = await prisma.playbookSection.findFirst({
      where: mover === "cima" ? { order: { lt: atual.order } } : { order: { gt: atual.order } },
      orderBy: { order: mover === "cima" ? "desc" : "asc" },
    });
    if (vizinha) {
      await prisma.$transaction([
        prisma.playbookSection.update({ where: { id: atual.id }, data: { order: vizinha.order } }),
        prisma.playbookSection.update({ where: { id: vizinha.id }, data: { order: atual.order } }),
      ]);
    }
  }

  const secao = Object.keys(campos).length
    ? await prisma.playbookSection.update({ where: { id }, data: campos })
    : await prisma.playbookSection.findUniqueOrThrow({ where: { id } });

  avisarMudanca({ dealIds: [], motivo: "playbook" });
  return NextResponse.json(secao);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await prisma.playbookSection.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "Seção não encontrada" }, { status: 404 });
  }
  avisarMudanca({ dealIds: [], motivo: "playbook" });
  return NextResponse.json({ ok: true });
}
