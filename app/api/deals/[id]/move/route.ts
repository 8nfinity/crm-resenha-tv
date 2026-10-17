import { NextResponse } from "next/server";
import { z } from "zod";
import { moveDealToStage, recalculateScore } from "@/lib/deals";
import { avisarMudanca } from "@/lib/eventos";

const bodySchema = z.object({ stageId: z.string().min(1) });

/** Move um card de coluna. O histórico da passagem é gravado por moveDealToStage. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "stageId é obrigatório" }, { status: 400 });
  }

  try {
    await moveDealToStage(id, parsed.data.stageId);
    // Mudar de estágio altera o avanço no funil e zera o tempo parado,
    // então o score muda junto.
    const score = await recalculateScore(id);
    // Outras telas abertas (e o quadro, quando a mudança veio do painel do
    // lead — inclusive para outro funil) se atualizam.
    avisarMudanca({ dealIds: [id], motivo: "funil" });
    return NextResponse.json({ ok: true, score: score?.score ?? null });
  } catch (error) {
    console.error("Falha ao mover deal", error);
    return NextResponse.json({ error: "Não foi possível mover" }, { status: 500 });
  }
}
