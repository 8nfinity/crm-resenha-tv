import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { conferirSenha } from "@/lib/auth/senha";
import { authConfigurado, COOKIE_SESSAO, criarToken, opcoesCookie } from "@/lib/auth/sessao";
import { estaHospedado } from "@/lib/url-publica";

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

/**
 * Segunda trava, por IP: 20 erros em 15 minutos. A do e-mail sozinha deixaria
 * alguém testar uma senha comum em centenas de e-mails diferentes.
 */
const MAX_ERROS_IP = 20;
const JANELA_IP_MS = 15 * 60 * 1000;
const errosPorIp = new Map<string, { erros: number; ate: number }>();

function ipDe(request: Request): string {
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "desconhecido"
  );
}

function registrarErro(mapa: Map<string, { erros: number; ate: number }>, chave: string, janela: number) {
  const atual = mapa.get(chave);
  const erros = (atual && atual.ate > Date.now() ? atual.erros : 0) + 1;
  mapa.set(chave, { erros, ate: Date.now() + janela });
  // Limpeza simples para o mapa não crescer sem fim.
  if (mapa.size > 5000) for (const [k, v] of mapa) if (v.ate < Date.now()) mapa.delete(k);
}

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

  const ip = ipDe(request);
  const doIp = errosPorIp.get(ip);
  if (doIp && doIp.erros >= MAX_ERROS_IP && doIp.ate > Date.now()) {
    return NextResponse.json(
      { error: "Muitas tentativas erradas deste local. Aguarde alguns minutos." },
      { status: 429 },
    );
  }

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
    registrarErro(tentativas, email, BLOQUEIO_MS);
    registrarErro(errosPorIp, ip, JANELA_IP_MS);
    return NextResponse.json({ error: RECUSA }, { status: 401 });
  }

  tentativas.delete(email);
  await prisma.user.update({ where: { id: usuario.id }, data: { lastLoginAt: new Date() } });

  // Hospedado, o cookie só trafega em HTTPS — mesmo que o proxy da hospedagem
  // entregue a requisição ao Next como http interno.
  const https =
    estaHospedado() ||
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";
  const res = NextResponse.json({ ok: true, nome: usuario.name });
  res.cookies.set(COOKIE_SESSAO, criarToken(usuario.id, usuario.sessionVersion), opcoesCookie(https));
  return res;
}
