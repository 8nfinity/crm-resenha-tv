import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  showOnCard: z.boolean().optional(),
});

/**
 * Renomeia o campo ou ajusta suas opções.
 *
 * O tipo não muda depois de criado: trocar TEXT por NUMBER transformaria em
 * lixo todo valor já preenchido, sem forma de recuperar.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const campo = await prisma.customField.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(campo);
}

/**
 * Apaga o campo.
 *
 * Os valores já preenchidos continuam no JSON de cada lead, mas param de
 * aparecer — `lerValores` descarta o que não corresponde a campo vivo. Isso é
 * proposital: se você recriar o campo por engano, os dados antigos não voltam
 * bagunçados, e uma limpeza pesada em todos os leads seria cara e irreversível.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await prisma.customField.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
