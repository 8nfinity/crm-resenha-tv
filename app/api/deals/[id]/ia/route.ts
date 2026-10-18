import { NextResponse } from "next/server";
import { z } from "zod";
import { pausar, retomar } from "@/lib/ia/agente";

export const runtime = "nodejs";

const schema = z.object({ acao: z.enum(["pausar", "retomar"]) });

/** Pausa ou retoma a IA neste lead (botão do painel). Qualquer usuário pode. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  if (parsed.data.acao === "pausar") await pausar(id, "Pausada à mão no painel do lead.");
  else await retomar(id);
  return NextResponse.json({ ok: true });
}
