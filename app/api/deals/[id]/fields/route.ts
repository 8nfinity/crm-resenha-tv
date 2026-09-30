import { NextResponse } from "next/server";
import { z } from "zod";
import { definirValor } from "@/lib/custom-fields";

export const runtime = "nodejs";

const bodySchema = z.object({
  campoId: z.string().min(1),
  valor: z.union([z.string(), z.number(), z.null()]),
});

/** Grava o valor de um campo próprio num lead. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const r = await definirValor(id, parsed.data.campoId, parsed.data.valor);
  if ("erro" in r) {
    return NextResponse.json({ error: r.erro }, { status: 400 });
  }

  return NextResponse.json(r);
}
