import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { conferirSenha } from "@/lib/auth/senha";
import { authConfigurado, COOKIE_SESSAO, criarToken, opcoesCookie } from "@/lib/auth/sessao";

export const runtime = "nodejs";

const corpoSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  senha: z.string().min(1).max(200),
});

/**
 * Trava de tentativas: 5 erros seguidos para o mesmo e-mail bloqueiam por
 * 10 minutos. Sem isso, a tela de login viraria um alvo para testar senhas
 * em sequência. Fica na memória: reiniciar o servidor zera, o que é aceitável
 * para um CRM de um time pequeno.
 */
const MAX_ERROS = 5;
const BLOQUEIO_MS = 10 * 60 * 1000;
const tentativas = new Map<string, { erros: number; ate: number }>();

// Hash de uma senha qualquer: quando o e-mail não existe, a conferência roda
// do mesmo jeito, para o tempo de resposta não revelar quais e-mails existem.
const HASH_FALSO = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const RECUSA = "E-mail ou senha incorretos.";

export async function POST(request: Request) {
  if (!authConfigurado()) {
    return NextResponse.json(
      { error: "Login desativado: falta a variável AUTH_SECRET no servidor (mínimo de 32 caracteres)." },
      { status: 503 },
    );
  }

  const parsed = corpoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: RECUSA }, { status: 400 });
  const { email, senha } = parsed.data;

  const registro = tentativas.get(email);
  if (registro && registro.erros >= MAX_ERROS && registro.ate > Date.now()) {
    const minutos = Math.ceil((registro.ate - Date.now()) / 60_000);
    return NextResponse.json(
      { error: `Muitas tentativas erradas. Tente de novo em ${minutos} min.` },
      { status: 429 },
    );
  }

  const usuario = await prisma.user.findUnique({ where: { email } });
  const confere = await conferirSenha(senha, usuario?.passwordHash ?? HASH_FALSO);

  if (!usuario || !confere || !usuario.active) {
    const erros = (registro && registro.ate > Date.now() ? registro.erros : 0) + 1;
    tentativas.set(email, { erros, ate: Date.now() + BLOQUEIO_MS });
    return NextResponse.json({ error: RECUSA }, { status: 401 });
  }

  tentativas.delete(email);
  await prisma.user.update({ where: { id: usuario.id }, data: { lastLoginAt: new Date() } });

  const https = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const res = NextResponse.json({ ok: true, nome: usuario.name });
  res.cookies.set(COOKIE_SESSAO, criarToken(usuario.id, usuario.sessionVersion), opcoesCookie(https));
  return res;
}
