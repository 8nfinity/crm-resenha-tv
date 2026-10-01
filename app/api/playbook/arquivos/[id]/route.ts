import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { avisarMudanca } from "@/lib/eventos";
import { disposicao } from "@/lib/playbook-pdf";

export const runtime = "nodejs";

/**
 * O PDF em si. Abre no visualizador do navegador (inline); com ?baixar=1,
 * vem como download.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const arquivo = await prisma.playbookFile.findUnique({
    where: { id },
    select: { name: true, data: true, size: true },
  });
  if (!arquivo) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  const baixar = new URL(request.url).searchParams.get("baixar") === "1";
  return new Response(new Uint8Array(arquivo.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(arquivo.data.byteLength),
      "Content-Disposition": disposicao(baixar ? "attachment" : "inline", arquivo.name),
      // O conteúdo de um id nunca muda (trocar = enviar outro). Privado: só
      // quem está logado chegou até aqui.
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/** Remove um PDF do playbook (só administradores — o proxy barra o resto). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.playbookFile.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  }
  avisarMudanca({ dealIds: [], motivo: "playbook" });
  return NextResponse.json({ ok: true });
}
