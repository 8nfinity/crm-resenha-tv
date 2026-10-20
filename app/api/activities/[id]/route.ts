import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { avisarMudanca } from "@/lib/eventos";
import { responsavelValido } from "@/lib/equipe";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    /** true marca como feita AGORA; false reabre (apaga a data de conclusão). */
    feita: z.boolean().optional(),
    title: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    /** Trocar o tipo: um fixo, ou OTHER + kindId (tipo criado por você). */
    type: z.enum(["FOLLOW_UP", "MEETING", "CALL", "PROPOSAL", "OTHER"]).optional(),
    kindId: z.string().min(1).nullable().optional(),
    /** Quem vai fazer. Nulo: vale quem criou. */
    assignedToId: z.string().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "nada para alterar");

/**
 * Altera uma atividade: concluir, reabrir, remarcar, renomear, trocar o tipo
 * ou as anotações.
 *
 * A hora da conclusão é a do SERVIDOR, não a que o navegador mandaria: é o
 * registro de quando foi feito, e não deve depender do relógio de quem clicou.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", detail: parsed.error.issues }, { status: 400 });
  }

  const { feita, title, notes, dueAt, type, kindId } = parsed.data;
  const assignedToId = await responsavelValido(parsed.data.assignedToId);
  if (assignedToId === false) return NextResponse.json({ error: "Essa pessoa não está mais no CRM." }, { status: 400 });

  try {
    const atividade = await prisma.activity.update({
      where: { id },
      data: {
        ...(feita !== undefined ? { doneAt: feita ? new Date() : null } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(assignedToId !== undefined ? { assignedToId } : {}),
        // Tipo próprio só existe com type OTHER; tipo fixo apaga o próprio.
        ...(type !== undefined ? { type, kindId: type === "OTHER" ? (kindId ?? null) : null } : {}),
        // Remarcou: o lembrete por e-mail vale de novo para o horário novo.
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null, reminderSentAt: null } : {}),
      },
    });
    avisarMudanca({ dealIds: [atividade.dealId], motivo: "atividade" });
    return NextResponse.json(atividade);
  } catch {
    return NextResponse.json({ error: "Atividade não encontrada" }, { status: 404 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const atividade = await prisma.activity.delete({ where: { id } });
    avisarMudanca({ dealIds: [atividade.dealId], motivo: "atividade" });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Atividade não encontrada" }, { status: 404 });
  }
}
