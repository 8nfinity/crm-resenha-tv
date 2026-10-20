import { NextResponse } from "next/server";
import { z } from "zod";
import { avisarMudanca } from "@/lib/eventos";
import { responsavelValido } from "@/lib/equipe";
import { prisma } from "@/lib/db";
import { getDealDetail } from "@/lib/queries";
import { exigirAdmin } from "@/lib/auth/usuario";
import { lerConfig, urlDoNegocio } from "@/lib/pipedrive";
import { lerConfigIA } from "@/lib/ia/agente";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [deal, pipedrive, ia] = await Promise.all([getDealDetail(id), lerConfig(), lerConfigIA()]);

  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  // O painel mostra "Enviar para o Pipedrive" (ou o link do negócio lá).
  // O token não sai daqui: só se está conectado e o endereço do negócio.
  return NextResponse.json({
    ...deal,
    // A IA de atendimento cuida deste lead? (ligada e no funil dela)
    ia: { atende: ia.ativo && ia.pipelineId === deal.stage.pipelineId, nome: ia.nome },
    pipedrive: {
      conectado: pipedrive !== null,
      url: pipedrive && deal.pipedriveDealId ? urlDoNegocio(pipedrive.dominio, deal.pipedriveDealId) : null,
    },
  });
}

/** Troca o responsável pelo lead (`ownerId` nulo: ninguém). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = z.object({ ownerId: z.string().nullable() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const ownerId = await responsavelValido(parsed.data.ownerId);
  if (ownerId === false) return NextResponse.json({ error: "Essa pessoa não está mais no CRM." }, { status: 400 });

  const deal = await prisma.deal.update({ where: { id }, data: { ownerId }, select: { id: true } }).catch(() => null);
  if (!deal) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  avisarMudanca({ dealIds: [id], motivo: "funil" });
  return NextResponse.json({ ok: true });
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
    // Segunda barreira (a primeira é o proxy): apagar de vez é irreversível
    // e reescreve as métricas — só master e administradores.
    const admin = await exigirAdmin();
    if (admin instanceof Response) return admin;

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
