import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Quantas atividades em aberto o dia tem — o número no ícone do Calendário.
 *
 * O "dia" vem do navegador (`de` e `ate`, meia-noite a meia-noite no fuso de
 * quem está vendo), como no resto do calendário. `atrasadas` são as de hoje
 * cujo horário já passou: deixam o número vermelho.
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const de = new Date(sp.get("de") ?? "");
  const ate = new Date(sp.get("ate") ?? "");
  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || ate <= de) {
    return NextResponse.json({ error: "Período inválido" }, { status: 400 });
  }

  const doDia = { doneAt: null, dueAt: { gte: de, lt: ate }, deal: { archivedAt: null } };
  const agora = new Date();
  const [pendentes, atrasadas] = await Promise.all([
    prisma.activity.count({ where: doDia }),
    prisma.activity.count({ where: { ...doDia, dueAt: { gte: de, lt: agora < ate ? agora : ate } } }),
  ]);
  return NextResponse.json({ pendentes, atrasadas });
}
