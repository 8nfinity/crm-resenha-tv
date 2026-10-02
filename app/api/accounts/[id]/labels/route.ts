import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { EvolutionError } from "@/lib/evolution/client";
import {
  aplicarEtiquetasMapeadas,
  moverQuemJaTemAEtiqueta,
  registrarAtendenteDeQuemJaTemAEtiqueta,
  sincronizarEtiquetas,
  tirarEtiquetaDoCrm,
  verificarChaveDasEtiquetas,
} from "@/lib/labels";
import { avisarMudanca } from "@/lib/eventos";
import { eventosRecentes } from "@/lib/eventos-conexao";
import { ignorarQuemJaTemAEtiqueta } from "@/lib/ignorar";

export const runtime = "nodejs";

/**
 * GET — etiquetas desta conta e para qual estágio cada uma aponta, mais a
 * saúde da chave das etiquetas e a linha do tempo da conexão.
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

  const existe = await prisma.whatsAppAccount.findUnique({ where: { id }, select: { id: true } });
  if (!existe) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  let erroSync: string | null = null;
  let movidos = 0;

  if (sincronizar) {
    // Primeiro obriga a Evolution a reler as etiquetas do celular (sem
    // desconectar) — o que também confere se a chave delas está lá; depois
    // copia a lista para o CRM.
    const leitura = await verificarChaveDasEtiquetas(id);
    // Falha com estado já foi gravada na saúde da conta, que a tela mostra no
    // quadro próprio — repetir aqui mostrava a mesma mensagem duas vezes.
    if (!leitura.ok) erroSync = leitura.estado ? null : leitura.erro;
    else await new Promise((r) => setTimeout(r, 4000)); // a Evolution grava em seguida
    try {
      await sincronizarEtiquetas(id);
    } catch (error) {
      // Falhar a sincronização não pode esconder o que já está mapeado.
      erroSync ??=
        error instanceof EvolutionError && error.status >= 500
          ? "A Evolution não conseguiu listar as etiquetas agora — acontece enquanto ela reinicia ou o número " +
            "reconecta. As etiquetas já configuradas continuam valendo; tente “Buscar do aparelho” de novo em alguns minutos."
          : error instanceof Error
            ? error.message
            : "Não consegui ler as etiquetas do aparelho";
    }
    // Quem já está com uma etiqueta de estágio e não andou (evento perdido,
    // etiqueta ligada ao estágio depois) anda agora.
    try {
      movidos = await aplicarEtiquetasMapeadas(id);
      if (movidos) avisarMudanca({ dealIds: [], motivo: "etiqueta" });
    } catch (error) {
      console.warn("Aplicar etiquetas de quem já está com elas falhou:", (error as Error).message);
    }
  }

  const [conta, etiquetas, eventos] = await Promise.all([
    prisma.whatsAppAccount.findUniqueOrThrow({ where: { id } }),
    prisma.whatsAppLabel.findMany({
      where: { accountId: id, removedAt: null },
      include: { stage: { select: { id: true, name: true, color: true } } },
      orderBy: { name: "asc" },
    }),
    eventosRecentes(id),
  ]);

  return NextResponse.json({
    conta: { id: conta.id, label: conta.label, status: conta.status },
    etiquetas,
    erroSync,
    movidos,
    saude: {
      estado: conta.labelKeyStatus,
      detalhe: conta.labelKeyDetail,
      verificadoEm: conta.labelKeyCheckedAt,
    },
    eventos,
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
  /** true: etiqueta de ATENDENTE — registra no histórico quem atendeu. */
  vendedor: z.boolean().optional(),
});

/**
 * PATCH — define o que a etiqueta faz: mover para um estágio, nada, ignorar o
 * contato ou registrar quem atendeu. Já aplica em quem está com ela no
 * celular: some do CRM (ignorar), ganha o registro de quem atendeu ou anda
 * para o estágio (só para a frente — ver moverQuemJaTemAEtiqueta).
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
  // Uma etiqueta faz uma coisa só: ignorar, atendente ou estágio.
  const stageId = ignorar || vendedor ? null : parsed.data.stageId;

  if (stageId) {
    const existe = await prisma.stage.findUnique({ where: { id: stageId } });
    if (!existe) {
      return NextResponse.json({ error: "Estágio não existe" }, { status: 400 });
    }
  }

  const antes = await prisma.whatsAppLabel.findUnique({
    where: { accountId_labelId: { accountId: id, labelId } },
    select: { stageId: true },
  });

  const etiqueta = await prisma.whatsAppLabel.update({
    where: { accountId_labelId: { accountId: id, labelId } },
    data: { stageId, ignoreContact: ignorar, isSeller: vendedor },
    include: { stage: { select: { id: true, name: true, color: true } } },
  });

  const ignorados = ignorar ? await ignorarQuemJaTemAEtiqueta(id, labelId) : 0;
  const registrados = vendedor ? await registrarAtendenteDeQuemJaTemAEtiqueta(id, labelId) : 0;
  const movidos = stageId && stageId !== antes?.stageId ? await moverQuemJaTemAEtiqueta(id, labelId) : 0;
  if (ignorados || vendedor || movidos) avisarMudanca({ dealIds: [], motivo: "etiqueta" });

  return NextResponse.json({ ...etiqueta, ignorados, registrados, movidos });
}

/**
 * DELETE ?labelId= — "não existe mais no celular": tira a etiqueta da tela.
 * Para a etiqueta fantasma que a Evolution continua listando depois de
 * apagada. Se ela for usada de novo no celular, volta sozinha.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const labelId = new URL(request.url).searchParams.get("labelId");
  if (!labelId) {
    return NextResponse.json({ error: "Falta a etiqueta" }, { status: 400 });
  }
  const { count } = await tirarEtiquetaDoCrm(id, labelId);
  if (count === 0) {
    return NextResponse.json({ error: "Etiqueta não encontrada" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
