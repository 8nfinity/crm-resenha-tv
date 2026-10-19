import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { upsertContact } from "@/lib/ingest";
import { createDealForContact, moveDealToStage, recalculateScore } from "@/lib/deals";
import { avisarMudanca } from "@/lib/eventos";
import { usuarioAtual } from "@/lib/auth/usuario";
import { emailValido, normalizarTelefone } from "@/lib/cadastro-lead";

export const runtime = "nodejs";

const schema = z.object({
  nome: z.string().trim().min(1).max(120),
  telefone: z.string().trim().min(1).max(40),
  email: z.string().trim().max(160).optional().default(""),
  empresa: z.string().trim().max(120).optional().default(""),
  valor: z.number().min(0).max(1_000_000_000).nullable().optional(),
  origem: z.string().trim().max(60).optional().default(""),
  observacao: z.string().trim().max(5000).optional().default(""),
  /** Coluna onde o lead entra (define o funil). */
  stageId: z.string().min(1),
  /** Número de WhatsApp do CRM a que o contato pertence; sem ele, o primeiro. */
  accountId: z.string().min(1).optional(),
});

/**
 * Cadastra um lead à mão (botão "Novo lead" do funil).
 *
 * O contato fica ligado a um número de WhatsApp do CRM, como os que chegam
 * sozinhos: quando a pessoa mandar mensagem, a conversa cai neste mesmo card.
 * Telefone que já é lead não vira outro card — a resposta aponta o existente.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Preencha nome, telefone e a coluna." }, { status: 400 });
  const d = parsed.data;

  const telefone = normalizarTelefone(d.telefone);
  if (!telefone) {
    return NextResponse.json({ error: "Telefone inválido. Use DDD + número, ex.: (51) 98540-9366. De outro país, com +." }, { status: 400 });
  }
  if (d.email && !emailValido(d.email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });

  const [coluna, conta, usuario] = await Promise.all([
    prisma.stage.findUnique({ where: { id: d.stageId }, select: { id: true } }),
    d.accountId
      ? prisma.whatsAppAccount.findUnique({ where: { id: d.accountId }, select: { id: true } })
      : prisma.whatsAppAccount.findFirst({ orderBy: [{ status: "desc" }, { createdAt: "asc" }], select: { id: true } }),
    usuarioAtual(),
  ]);
  if (!coluna) return NextResponse.json({ error: "Coluna não encontrada." }, { status: 400 });
  if (!conta) return NextResponse.json({ error: "Conecte um número de WhatsApp antes de cadastrar leads." }, { status: 400 });

  const contato = await upsertContact({ accountId: conta.id, waJid: `${telefone}@s.whatsapp.net` });
  if (contato.ignoredAt) {
    return NextResponse.json(
      { error: "Esse contato está na lista de ignorados (Configurações → Etiquetas). Tire de lá antes de cadastrar." },
      { status: 409 },
    );
  }

  const existente = await prisma.deal.findUnique({ where: { contactId: contato.id }, select: { id: true, archivedAt: true } });
  if (existente && !existente.archivedAt) {
    return NextResponse.json({ error: "Esse telefone já é um lead no CRM.", dealId: existente.id }, { status: 409 });
  }

  await prisma.contact.update({
    where: { id: contato.id },
    data: {
      savedName: d.nome,
      ...(d.email ? { email: d.email } : {}),
      ...(d.empresa ? { empresa: d.empresa } : {}),
    },
  });

  // Arquivado volta para o funil, na coluna escolhida; senão, lead novo nela.
  let dealId: string;
  if (existente) {
    await prisma.deal.update({ where: { id: existente.id }, data: { archivedAt: null } });
    await moveDealToStage(existente.id, coluna.id);
    dealId = existente.id;
  } else {
    dealId = (await createDealForContact(contato.id, coluna.id)).id;
  }

  await prisma.deal.update({
    where: { id: dealId },
    data: {
      ...(d.valor !== undefined && d.valor !== null ? { value: d.valor } : {}),
      ...(d.origem ? { origem: d.origem } : {}),
    },
  });
  await prisma.note.create({
    data: {
      dealId,
      body: [
        `Lead cadastrado à mão${usuario ? ` por ${usuario.name}` : ""}${existente ? " (estava arquivado e voltou ao funil)" : ""}.`,
        d.observacao,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  });

  await recalculateScore(dealId);
  avisarMudanca({ dealIds: [dealId], motivo: "funil" });
  return NextResponse.json({ dealId }, { status: 201 });
}
