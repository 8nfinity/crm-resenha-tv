import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { exigirAdmin } from "@/lib/auth/usuario";
import { formatPhone } from "@/lib/evolution/parse";
import { mesclarContatos } from "@/lib/mesclar-contatos";
import { contactName } from "@/lib/queries";
import { qualFica } from "@/lib/juntar-leads";

export const runtime = "nodejs";

/**
 * Juntar dois cards que são a mesma pessoa, à mão.
 *
 * O CRM junta sozinho quando descobre que um LID e um telefone são da mesma
 * pessoa (mensagem nova, foto de perfil). Quando nada revela isso — pessoa sem
 * foto, conversa antiga só pelo telefone e etiqueta pelo LID —, sobra o card
 * duplicado. Aqui você diz que são a mesma pessoa: conversas, notas,
 * atividades e o histórico de etiquetas vão para um card só (ver
 * mesclarContatos). Não dá para desfazer: só administradores.
 */

/** GET ?busca= — leads deste número que podem ser a mesma pessoa. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await exigirAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const deal = await prisma.deal.findUnique({
    where: { id },
    select: { contact: { select: { accountId: true, waJid: true, phone: true, lid: true } } },
  });
  if (!deal) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  const busca = (new URL(request.url).searchParams.get("busca") ?? "").trim().slice(0, 60);
  const digitos = busca.replace(/\D/g, "");
  const { accountId, waJid, phone, lid } = deal.contact;

  // Sem busca, as sugestões vêm do lado oposto: o card só com o código interno
  // (LID) costuma ser a cópia de um lead do telefone que ainda não sabe o LID,
  // e vice-versa.
  const soLid = waJid.endsWith("@lid") && !phone;
  const foneSemLid = waJid.endsWith("@s.whatsapp.net") && !lid;
  const ladoOposto = soLid
    ? { waJid: { endsWith: "@s.whatsapp.net" }, lid: null }
    : foneSemLid
      ? { waJid: { endsWith: "@lid" } }
      : {};

  const candidatos = await prisma.deal.findMany({
    where: {
      id: { not: id },
      archivedAt: null,
      contact: {
        accountId,
        ...(busca
          ? {
              OR: [
                { pushName: { contains: busca, mode: "insensitive" as const } },
                { savedName: { contains: busca, mode: "insensitive" as const } },
                ...(digitos.length >= 3 ? [{ phone: { contains: digitos } }, { waJid: { contains: digitos } }] : []),
              ],
            }
          : ladoOposto),
      },
    },
    orderBy: [{ lastInteractionAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 15,
    select: {
      id: true,
      stage: { select: { name: true, color: true } },
      contact: { select: { savedName: true, pushName: true, phone: true, waJid: true } },
    },
  });

  return NextResponse.json({
    sugestoes: !busca,
    leads: candidatos.map((d) => ({
      id: d.id,
      nome: contactName(d.contact),
      telefone: formatPhone(d.contact.phone),
      estagio: d.stage,
    })),
  });
}

const corpo = z.object({ comDealId: z.string().min(1) });

/** POST { comDealId } — junta os dois leads num só. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await exigirAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const parsed = corpo.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.comDealId === id) {
    return NextResponse.json({ error: "Escolha outro lead para juntar" }, { status: 400 });
  }

  const deals = await prisma.deal.findMany({
    where: { id: { in: [id, parsed.data.comDealId] } },
    select: {
      id: true,
      contact: { select: { id: true, accountId: true, waJid: true, _count: { select: { messages: true } } } },
    },
  });
  const aberto = deals.find((d) => d.id === id);
  const outro = deals.find((d) => d.id === parsed.data.comDealId);
  if (!aberto || !outro) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  if (aberto.contact.accountId !== outro.contact.accountId) {
    return NextResponse.json(
      { error: "Os dois leads são de números de WhatsApp diferentes — cada número seu tem o próprio card." },
      { status: 400 },
    );
  }

  const fica = qualFica(
    { dealId: aberto.id, waJid: aberto.contact.waJid, mensagens: aberto.contact._count.messages },
    { dealId: outro.id, waJid: outro.contact.waJid, mensagens: outro.contact._count.messages },
  );
  const [manter, remover] = fica === aberto.id ? [aberto, outro] : [outro, aberto];
  await mesclarContatos(manter.contact.id, remover.contact.id);

  return NextResponse.json({ ficou: manter.id, saiu: remover.id });
}
