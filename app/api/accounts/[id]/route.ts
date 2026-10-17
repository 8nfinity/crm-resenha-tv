import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { desconectarConta } from "@/lib/accounts";

export const runtime = "nodejs";

const patchSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Funil onde caem os leads novos deste número (nulo: o primeiro funil). */
  entryPipelineId: z.string().min(1).nullable().optional(),
});

/** Renomeia, recolore ou troca o funil de entrada da conta. Não toca na instância da Evolution. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  // O apelido é só rótulo: renomear a instância na Evolution custaria a sessão,
  // e o celular teria que ser pareado de novo.
  const conta = await prisma.whatsAppAccount.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json(conta);
}

/**
 * Desconecta um número. Três comportamentos, pelos parâmetros de busca:
 *
 *   (nenhum)             desliga a linha, os leads ficam no funil
 *   ?apagarDados=true    desliga e apaga os leads e conversas desta conta
 *   ?remover=true        apaga a conta inteira do CRM e da Evolution
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sp = new URL(request.url).searchParams;

  const removerConta = sp.get("remover") === "true";
  const apagarDados = removerConta || sp.get("apagarDados") === "true";

  // A última conta não pode ser removida: o CRM ficaria sem nenhuma, e a tela
  // de conexão recriaria uma vazia na próxima abertura. Desconectar, sim.
  if (removerConta) {
    const total = await prisma.whatsAppAccount.count();
    if (total <= 1) {
      return NextResponse.json(
        {
          error:
            "Esta é a única conta. Você pode desconectá-la, mas não removê-la — " +
            "o CRM precisa de pelo menos uma.",
        },
        { status: 409 },
      );
    }
  }

  try {
    const resultado = await desconectarConta(id, { apagarDados, removerConta });
    if (!resultado) {
      return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao desconectar",
      },
      { status: 502 },
    );
  }
}
