import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { atribuirVendedorQuemJaTemAEtiqueta, sincronizarEtiquetas } from "@/lib/labels";
import { avisarMudanca } from "@/lib/eventos";
import { ignorarQuemJaTemAEtiqueta } from "@/lib/ignorar";

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
    include: {
      stage: { select: { id: true, name: true, color: true } },
      sellerUser: { select: { id: true, name: true } },
    },
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
  /** true: etiqueta de "ignorar contato" (o stageId é descartado). */
  ignorar: z.boolean().optional(),
  /** true: etiqueta de VENDEDOR — quem recebe vira lead desse vendedor. */
  vendedor: z.boolean().optional(),
  /** Usuário do CRM que é o vendedor (opcional; para os avisos por e-mail). */
  sellerUserId: z.string().nullable().optional(),
});

/**
 * PATCH — define o que a etiqueta faz: mover para um estágio, nada, ignorar o
 * contato ou definir o vendedor do lead. Ao virar "ignorar" ou "vendedor", já
 * aplica em quem está com ela no celular.
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

  const { labelId, ignorar = false, vendedor = false } = parsed.data;
  // Uma etiqueta faz uma coisa só: ignorar, vendedor ou estágio.
  const stageId = ignorar || vendedor ? null : parsed.data.stageId;
  const sellerUserId = vendedor ? (parsed.data.sellerUserId ?? null) : null;

  if (sellerUserId && !(await prisma.user.findUnique({ where: { id: sellerUserId } }))) {
    return NextResponse.json({ error: "Usuário não existe" }, { status: 400 });
  }

  if (stageId) {
    const existe = await prisma.stage.findUnique({ where: { id: stageId } });
    if (!existe) {
      return NextResponse.json({ error: "Estágio não existe" }, { status: 400 });
    }
  }

  const etiqueta = await prisma.whatsAppLabel.update({
    where: { accountId_labelId: { accountId: id, labelId } },
    data: { stageId, ignoreContact: ignorar, isSeller: vendedor, sellerUserId },
    include: {
      stage: { select: { id: true, name: true, color: true } },
      sellerUser: { select: { id: true, name: true } },
    },
  });

  // Quem JÁ estava com a etiqueta no celular: some do CRM (ignorar) ou passa
  // a ser lead do vendedor.
  const ignorados = ignorar ? await ignorarQuemJaTemAEtiqueta(id, labelId) : 0;
  const atribuidos = vendedor ? await atribuirVendedorQuemJaTemAEtiqueta(id, labelId) : 0;
  if (ignorados || atribuidos) avisarMudanca({ dealIds: [], motivo: "etiqueta" });

  return NextResponse.json({ ...etiqueta, ignorados, atribuidos });
}
