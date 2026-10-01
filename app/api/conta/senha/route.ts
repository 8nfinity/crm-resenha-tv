import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { conferirSenha, gerarHash, senhaFraca } from "@/lib/auth/senha";
import { COOKIE_SESSAO, criarToken, opcoesCookie } from "@/lib/auth/sessao";
import { esquecerUsuario, usuarioAtual } from "@/lib/auth/usuario";
import { estaHospedado } from "@/lib/url-publica";

export const runtime = "nodejs";

const schema = z.object({ atual: z.string().max(200), nova: z.string().max(200) });

/**
 * Troca da própria senha. Exige a senha atual: quem pegasse um computador
 * com o CRM aberto não conseguiria trancar o dono para fora.
 *
 * As outras sessões abertas (outro computador, celular) caem; esta continua,
 * com um cookie novo.
 */
export async function PATCH(request: Request) {
  const usuario = await usuarioAtual();
  if (!usuario) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const fraca = senhaFraca(parsed.data.nova);
  if (fraca) return NextResponse.json({ error: fraca }, { status: 400 });

  const registro = await prisma.user.findUniqueOrThrow({ where: { id: usuario.id } });
  if (!(await conferirSenha(parsed.data.atual, registro.passwordHash))) {
    return NextResponse.json({ error: "A senha atual não confere." }, { status: 400 });
  }

  const atualizado = await prisma.user.update({
    where: { id: usuario.id },
    data: { passwordHash: await gerarHash(parsed.data.nova), sessionVersion: { increment: 1 } },
  });
  esquecerUsuario(usuario.id);

  const https =
    estaHospedado() ||
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESSAO, criarToken(atualizado.id, atualizado.sessionVersion), opcoesCookie(https));
  return res;
}
