import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sincronizarEtiquetas } from "@/lib/labels";

export const runtime = "nodejs";

/**
 * GET — etiquetas desta conta e para qual estágio cada uma aponta.
 *
 * `?sincronizar=true` busca a lista fresca do aparelho antes de responder.
 * Sem o parâmetro devolve o que já está no banco, que é o caso comum e não
 * depende da Evolution estar respondendo.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sincronizar = new URL(request.url).searchParams.get("sincronizar") === "true";

  const conta = await prisma.whatsAppAccount.findUnique({ where: { id } });
  if (!conta) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  let erroSync: string | null = null;

  if (sincronizar) {
    try {
      await sincronizarEtiquetas(id);
    } catch (error) {
      // Falhar a sincronização não pode esconder o que já está mapeado.
      erroSync =
        error instanceof Error
          ? error.message
          : "Não consegui ler as etiquetas do aparelho";
    }
  }

  const etiquetas = await prisma.whatsAppLabel.findMany({
    where: { accountId: id },
    include: { stage: { select: { id: true, name: true, color: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    conta: { id: conta.id, label: conta.label, status: conta.status },
    etiquetas,
    erroSync,
    // Etiquetas só existem no WhatsApp Business. Sem nenhuma, a tela precisa
    // explicar isso em vez de mostrar uma lista vazia sem contexto.
    vazio: etiquetas.length === 0,
  });
}

const patchSchema = z.object({
  labelId: z.string().min(1),
  /** Null desfaz o mapeamento: a etiqueta continua existindo, sem efeito. */
  stageId: z.string().nullable(),
});

/** PATCH — liga (ou desliga) uma etiqueta a um estágio do funil. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const { labelId, stageId } = parsed.data;

  if (stageId) {
    const existe = await prisma.stage.findUnique({ where: { id: stageId } });
    if (!existe) {
      return NextResponse.json({ error: "Estágio não existe" }, { status: 400 });
    }
  }

  const etiqueta = await prisma.whatsAppLabel.update({
    where: { accountId_labelId: { accountId: id, labelId } },
    data: { stageId },
    include: { stage: { select: { id: true, name: true, color: true } } },
  });

  return NextResponse.json(etiqueta);
}
