import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { avisarMudanca } from "@/lib/eventos";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    /** true marca como feita AGORA; false reabre (apaga a data de conclusão). */
    feita: z.boolean().optional(),
    title: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    dueAt: z.iso.datetime().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "nada para alterar");

/**
 * Altera uma atividade: concluir, reabrir, remarcar ou renomear.
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

  const { feita, title, notes, dueAt } = parsed.data;

  try {
    const atividade = await prisma.activity.update({
      where: { id },
      data: {
        ...(feita !== undefined ? { doneAt: feita ? new Date() : null } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
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
