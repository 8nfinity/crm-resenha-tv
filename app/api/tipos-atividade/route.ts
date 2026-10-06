import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { exigirAdmin } from "@/lib/auth/usuario";
import { avisarMudanca } from "@/lib/eventos";
import { esquemaTipo } from "@/lib/tipos-atividade";

export const runtime = "nodejs";

/**
 * Tipos de atividade criados por você, além dos fixos (Follow-up, Reunião,
 * Ligação, Proposta, Outro). Listar é de todos; criar, renomear e apagar é
 * estrutura do CRM, como as colunas do funil: só administradores.
 */

export async function GET() {
  const tipos = await prisma.activityKind.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, color: true },
  });
  return NextResponse.json(tipos);
}

export async function POST(request: Request) {
  const admin = await exigirAdmin();
  if (admin instanceof Response) return admin;

  const parsed = esquemaTipo.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const { name, color } = parsed.data;
  const repetido = await prisma.activityKind.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (repetido) return NextResponse.json({ error: `Já existe o tipo "${repetido.name}".` }, { status: 400 });

  const ultimo = await prisma.activityKind.aggregate({ _max: { order: true } });
  const tipo = await prisma.activityKind.create({
    data: { name, ...(color ? { color } : {}), order: (ultimo._max.order ?? 0) + 1 },
    select: { id: true, name: true, color: true },
  });
  avisarMudanca({ dealIds: [], motivo: "atividade" });
  return NextResponse.json(tipo, { status: 201 });
}
