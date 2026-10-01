import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { avisarMudanca } from "@/lib/eventos";
import { usuarioAtual } from "@/lib/auth/usuario";
import { LIMITE_PDF, ehPdf, extrairTexto, nomeDoArquivo } from "@/lib/playbook-pdf";

export const runtime = "nodejs";

/** Lista os PDFs do playbook (sem o arquivo em si). */
export async function GET() {
  const arquivos = await prisma.playbookFile.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, size: true, createdAt: true, uploadedBy: { select: { name: true } } },
  });
  return NextResponse.json(arquivos);
}

/**
 * Envia um PDF para o playbook (só administradores — o proxy barra o resto).
 * Formulário multipart com o campo "arquivo".
 */
export async function POST(request: Request) {
  // Confere o tamanho declarado antes de ler o corpo inteiro na memória.
  const declarado = Number(request.headers.get("content-length") ?? 0);
  if (declarado > LIMITE_PDF + 64 * 1024) {
    return NextResponse.json({ error: "O PDF passa de 25 MB. Comprima o arquivo e tente de novo." }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!arquivo || typeof arquivo === "string") {
    return NextResponse.json({ error: "Escolha um arquivo PDF." }, { status: 400 });
  }
  if (arquivo.size === 0) return NextResponse.json({ error: "O arquivo está vazio." }, { status: 400 });
  if (arquivo.size > LIMITE_PDF) {
    return NextResponse.json({ error: "O PDF passa de 25 MB. Comprima o arquivo e tente de novo." }, { status: 413 });
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (!ehPdf(bytes)) {
    return NextResponse.json({ error: "Esse arquivo não é um PDF." }, { status: 400 });
  }

  const autor = await usuarioAtual();
  const texto = await extrairTexto(bytes);

  const criado = await prisma.playbookFile.create({
    data: {
      name: nomeDoArquivo(arquivo.name),
      size: bytes.byteLength,
      data: Buffer.from(bytes),
      text: texto,
      uploadedById: autor?.id ?? null,
    },
    select: { id: true, name: true, size: true, createdAt: true },
  });

  avisarMudanca({ dealIds: [], motivo: "playbook" });
  return NextResponse.json({ ...criado, temTexto: Boolean(texto) }, { status: 201 });
}
