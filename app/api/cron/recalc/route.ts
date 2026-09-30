import { NextResponse } from "next/server";
import { recalculateAllScores } from "@/lib/deals";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Recálculo diário dos scores.
 *
 * O webhook já recalcula quando chega mensagem, mas a passagem do tempo sozinha
 * esfria um lead: quem respondeu "há 6 dias" hoje respondeu "há 7 dias" amanhã,
 * e cruza a faixa de pontuação sem que nada tenha acontecido. Sem este cron, um
 * lead que sumiu continuaria marcado como quente para sempre.
 *
 * A Vercel chama esta rota com o header `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  // Em produção, sem segredo configurado a rota fica fechada — ela é pública e
  // percorre o banco inteiro, então serviria de alavanca para sobrecarga.
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("CRON_SECRET não configurada — cron recusado");
    return NextResponse.json({ error: "não configurado" }, { status: 500 });
  }

  const total = await recalculateAllScores();
  return NextResponse.json({ ok: true, deals: total });
}
