import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { usuarioAtual } from "@/lib/auth/usuario";
import { chavesVapid, descreverAparelho, endpointPermitido } from "@/lib/push";

export const runtime = "nodejs";

/**
 * Notificações no aparelho de quem está logado.
 *
 * GET    a chave pública (o navegador precisa dela para se inscrever) e os
 *        aparelhos já ativados
 * POST   ativa este aparelho (ou reassocia, se outra pessoa usava o mesmo
 *        navegador)
 * DELETE desativa este aparelho
 */
export async function GET() {
  const usuario = await usuarioAtual();
  if (!usuario) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const [chaves, aparelhos] = await Promise.all([
    chavesVapid(),
    prisma.pushSubscription.findMany({
      where: { userId: usuario.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, device: true, createdAt: true, lastUsedAt: true },
    }),
  ]);
  return NextResponse.json({ chavePublica: chaves.publica, aparelhos });
}

const inscricaoSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(8).max(200) }),
});

export async function POST(request: Request) {
  const usuario = await usuarioAtual();
  if (!usuario) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const parsed = inscricaoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Inscrição inválida" }, { status: 400 });
  const { endpoint, keys } = parsed.data;

  if (!endpointPermitido(endpoint)) {
    return NextResponse.json({ error: "Serviço de notificação desconhecido." }, { status: 400 });
  }

  const device = descreverAparelho(request.headers.get("user-agent"));
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userId: usuario.id, device },
    update: { p256dh: keys.p256dh, auth: keys.auth, userId: usuario.id, device },
  });
  return NextResponse.json({ ok: true, device });
}

const remocaoSchema = z.object({ endpoint: z.string().max(2000) });

export async function DELETE(request: Request) {
  const usuario = await usuarioAtual();
  if (!usuario) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const parsed = remocaoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  // Só apaga aparelho da própria pessoa.
  await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId: usuario.id } });
  return NextResponse.json({ ok: true });
}
