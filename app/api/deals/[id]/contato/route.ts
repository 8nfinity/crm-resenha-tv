import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { usuarioAtual } from "@/lib/auth/usuario";
import { ehAdministrador } from "@/lib/auth/papeis";
import { formaConhecidaDoTelefone } from "@/lib/identidade-contato";
import { upsertContact } from "@/lib/ingest";
import { avisarMudanca } from "@/lib/eventos";
import { telefoneDigitado } from "@/lib/perfil-contato";

export const runtime = "nodejs";

const corpo = z.object({
  /** Nome para mostrar no card. Vazio volta a usar o nome do WhatsApp. */
  nome: z.string().max(120).nullable().optional(),
  /** Número do lead que o WhatsApp escondeu (só lead sem número). */
  telefone: z.string().max(40).optional(),
});

/**
 * PATCH — você diz quem é o lead.
 *
 * Nome: qualquer um que trabalha o lead pode dar.
 *
 * Número: só para o lead que chegou SEM número (o WhatsApp escondeu atrás do
 * código interno). Não é só um texto: o lead passa a ser desse telefone — as
 * mensagens e etiquetas que chegarem por ele caem neste card, e se já existir
 * um card desse número, os dois viram um só (como o "Juntar"). Por isso é de
 * administrador.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await usuarioAtual();
  if (!usuario) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const parsed = corpo.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { nome, telefone } = parsed.data;

  const { id } = await params;
  const deal = await prisma.deal.findUnique({
    where: { id },
    select: { contact: { select: { id: true, accountId: true, waJid: true, lid: true } } },
  });
  if (!deal) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  const contato = deal.contact;

  if (nome !== undefined) {
    await prisma.contact.update({ where: { id: contato.id }, data: { savedName: nome?.trim() || null } });
  }

  let dealId = id;
  if (telefone !== undefined) {
    if (!ehAdministrador(usuario.role)) {
      return NextResponse.json({ error: "Só administradores podem informar o número." }, { status: 403 });
    }
    if (!contato.waJid.endsWith("@lid")) {
      return NextResponse.json({ error: "Este lead já tem número." }, { status: 400 });
    }
    const jid = telefoneDigitado(telefone);
    if (!jid) return NextResponse.json({ error: "Número inválido. Use DDD + número, ex.: (51) 98540-9366." }, { status: 400 });

    // Com o telefone e o código interno juntos, o contato vira o do telefone
    // — ou se junta ao card que esse número já tinha.
    const final = await upsertContact({
      accountId: contato.accountId,
      waJid: await formaConhecidaDoTelefone(contato.accountId, jid),
      alt: contato.lid ?? contato.waJid,
    });
    dealId = (await prisma.deal.findUnique({ where: { contactId: final.id }, select: { id: true } }))?.id ?? id;
  }

  avisarMudanca({ dealIds: [dealId], motivo: "funil" });
  return NextResponse.json({ ok: true, dealId });
}
