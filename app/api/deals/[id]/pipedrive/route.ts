import { NextResponse } from "next/server";
import { ErroPipedrive, enviarParaPipedrive } from "@/lib/pipedrive";
import { avisarMudanca } from "@/lib/eventos";

export const runtime = "nodejs";

/**
 * Envia o lead para o Pipedrive (ou atualiza o negócio, se já foi).
 * Qualquer usuário pode: é trabalho com o lead, como mover ou anotar. Quem
 * conecta e escolhe o funil do Pipedrive é o administrador.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const r = await enviarParaPipedrive(id);
    avisarMudanca({ dealIds: [id], motivo: "funil" });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ErroPipedrive) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("Falha ao enviar para o Pipedrive", e);
    return NextResponse.json({ error: "Não deu para enviar ao Pipedrive. Tente de novo." }, { status: 500 });
  }
}
