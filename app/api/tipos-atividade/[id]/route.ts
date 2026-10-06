import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { exigirAdmin } from "@/lib/auth/usuario";
import { avisarMudanca } from "@/lib/eventos";
import { esquemaTipo } from "@/lib/tipos-atividade";

export const runtime = "nodejs";

/** PATCH — renomeia ou troca a cor de um tipo seu. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await exigirAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const parsed = esquemaTipo.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  try {
    const tipo = await prisma.activityKind.update({
      where: { id },
      data: parsed.data,
      select: { id: true, name: true, color: true },
    });
    avisarMudanca({ dealIds: [], motivo: "atividade" });
    return NextResponse.json(tipo);
  } catch {
    return NextResponse.json({ error: "Tipo não encontrado" }, { status: 404 });
  }
}

/**
 * DELETE — apaga um tipo seu. As atividades dele NÃO somem: voltam a ser
 * "Outro" (com o título de sempre).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await exigirAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  try {
    await prisma.activityKind.delete({ where: { id } });
    avisarMudanca({ dealIds: [], motivo: "atividade" });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Tipo não encontrado" }, { status: 404 });
  }
}
