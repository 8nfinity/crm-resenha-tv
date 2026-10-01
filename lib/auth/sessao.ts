import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sessão de login: um cookie assinado, sem tabela de sessões.
 *
 * Conteúdo: id do usuário, a "versão de sessão" dele e o vencimento,
 * assinados com HMAC-SHA256 e o segredo AUTH_SECRET. Alterar qualquer byte
 * invalida a assinatura. A versão de sessão é o que permite derrubar quem já
 * está logado (troca de senha, desativação): o token antigo deixa de bater
 * com a versão guardada no banco.
 */

export const COOKIE_SESSAO = "crm_sessao";
export const DURACAO_SESSAO_S = 7 * 24 * 60 * 60;

export type DadosSessao = { u: string; v: number; exp: number };

function segredo(): string | null {
  const s = process.env.AUTH_SECRET?.trim();
  // Curto demais é quase o mesmo que nenhum: recusa em vez de assinar fraco.
  return s && s.length >= 32 ? s : null;
}

export function authConfigurado(): boolean {
  return segredo() !== null;
}

function assinar(conteudo: string, chave: string): string {
  return createHmac("sha256", chave).update(conteudo).digest("base64url");
}

export function criarToken(usuarioId: string, versao: number): string {
  const chave = segredo();
  if (!chave) throw new Error("AUTH_SECRET não configurada (mínimo de 32 caracteres).");
  const dados: DadosSessao = {
    u: usuarioId,
    v: versao,
    exp: Math.floor(Date.now() / 1000) + DURACAO_SESSAO_S,
  };
  const conteudo = Buffer.from(JSON.stringify(dados)).toString("base64url");
  return `${conteudo}.${assinar(conteudo, chave)}`;
}

/** Devolve os dados se o token é autêntico e está no prazo; senão, null. */
export function lerToken(token: string | undefined | null): DadosSessao | null {
  const chave = segredo();
  if (!chave || !token) return null;
  const [conteudo, assinatura] = token.split(".");
  if (!conteudo || !assinatura) return null;

  const esperada = Buffer.from(assinar(conteudo, chave));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

  try {
    const dados = JSON.parse(Buffer.from(conteudo, "base64url").toString()) as DadosSessao;
    if (typeof dados.u !== "string" || typeof dados.v !== "number") return null;
    if (dados.exp < Math.floor(Date.now() / 1000)) return null;
    return dados;
  } catch {
    return null;
  }
}

/** Opções do cookie: inacessível ao JavaScript da página e só em HTTPS quando hospedado. */
export function opcoesCookie(https: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: https,
    path: "/",
    maxAge: DURACAO_SESSAO_S,
  };
}
