import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { exigirAdmin } from "@/lib/auth/usuario";
import { voltarAMostrar } from "@/lib/ignorar";
import { contactName } from "@/lib/queries";
import { formatPhone } from "@/lib/evolution/parse";

export const runtime = "nodejs";

/** Lista os contatos ignorados (para poder trazer algum de volta). */
export async function GET() {
  const admin = await exigirAdmin();
  if (admin instanceof Response) return admin;

  const contatos = await prisma.contact.findMany({
    where: { ignoredAt: { not: null } },
    orderBy: { ignoredAt: "desc" },
    select: {
      id: true, waJid: true, savedName: true, pushName: true, phone: true, ignoredAt: true,
      account: { select: { label: true, instanceName: true } },
    },
  });

  return NextResponse.json(
    contatos.map((c) => ({
      id: c.id,
      nome: contactName(c),
      telefone: formatPhone(c.phone),
      conta: c.account.label ?? c.account.instanceName,
      ignoradoEm: c.ignoredAt,
    })),
  );
}

const schema = z.object({ contactId: z.string().min(1) });

/**
 * Volta a mostrar um contato. Útil quando a etiqueta foi tirada no celular
 * com o CRM fora do ar, ou quando o contato foi ignorado à mão.
 * Se ele ainda estiver com a etiqueta de ignorar, a próxima etiquetagem
 * esconde de novo — tire a etiqueta no celular também.
 */
export async function POST(request: Request) {
  const admin = await exigirAdmin();
  if (admin instanceof Response) return admin;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const ok = await voltarAMostrar(parsed.data.contactId);
  return NextResponse.json({ ok });
}
