import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ActivityType } from "@/lib/generated/prisma/client";
import { avisarMudanca } from "@/lib/eventos";
import { usuarioAtual } from "@/lib/auth/usuario";

const bodySchema = z.object({
  type: z.enum(["FOLLOW_UP", "MEETING", "CALL", "PROPOSAL", "OTHER"]),
  title: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(5000).optional(),
  dueAt: z.iso.datetime().optional(),
  doneAt: z.iso.datetime().optional(),
});

/**
 * Registra uma atividade. É daqui que saem os relatórios de follow-up e de
 * reuniões que o Claude responde — sem registro, não há métrica.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const { type, title, notes, dueAt, doneAt } = parsed.data;
  // Quem marcou recebe o lembrete por e-mail quando o lead não tem vendedor.
  const autor = await usuarioAtual();

  const activity = await prisma.activity.create({
    data: {
      dealId: id,
      type: type as ActivityType,
      title,
      notes,
      dueAt: dueAt ? new Date(dueAt) : null,
      doneAt: doneAt ? new Date(doneAt) : null,
      createdById: autor?.id ?? null,
    },
  });

  // Calendário e agenda abertos em outra aba mostram a atividade nova na hora.
  avisarMudanca({ dealIds: [id], motivo: "atividade" });

  return NextResponse.json(activity, { status: 201 });
}
