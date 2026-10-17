import { NextResponse } from "next/server";
import { ErroPipedrive, funisDoPipedrive, lerConfig } from "@/lib/pipedrive";

export const runtime = "nodejs";

/** Funis e etapas que existem no Pipedrive, para escolher o destino dos negócios. */
export async function GET() {
  const cfg = await lerConfig();
  if (!cfg) return NextResponse.json({ error: "Conecte o Pipedrive primeiro." }, { status: 400 });
  try {
    return NextResponse.json(await funisDoPipedrive(cfg));
  } catch (e) {
    const msg = e instanceof ErroPipedrive ? e.message : "Não deu para ler os funis do Pipedrive.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
