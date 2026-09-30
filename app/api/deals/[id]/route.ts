import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDealDetail } from "@/lib/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deal = await getDealDetail(id);

  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  return NextResponse.json(deal);
}

/**
 * Remove um lead do funil.
 *
 * Dois modos, e a diferença importa:
 *
 *   arquivar (padrão) — some do funil mas o histórico fica. As métricas de
 *     conversão continuam corretas, porque quem passou por "Reunião" mês
 *     passado continua tendo passado.
 *
 *   ?permanente=true — apaga contato, conversas e histórico. As métricas
 *     passadas mudam, já que as passagens dele pelo funil deixam de existir.
 *
 * O padrão é arquivar justamente porque apagar reescreve o passado, e isso
 * costuma ser pior do que o incômodo de um card a mais.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const permanente = new URL(request.url).searchParams.get("permanente") === "true";

  const deal = await prisma.deal.findUnique({
    where: { id },
    select: { id: true, contactId: true },
  });

  if (!deal) {
    return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  }

  if (permanente) {
    // O cascade do schema leva junto deal, mensagens, notas, atividades e
    // transições — não sobra órfão.
    await prisma.contact.delete({ where: { id: deal.contactId } });
    return NextResponse.json({ ok: true, modo: "permanente" });
  }

  await prisma.deal.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return NextResponse.json({ ok: true, modo: "arquivado" });
}
