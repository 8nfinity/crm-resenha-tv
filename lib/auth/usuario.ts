import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { COOKIE_SESSAO, lerToken } from "@/lib/auth/sessao";
import { ehAdministrador, type Papel } from "@/lib/auth/papeis";

export type Usuario = {
  id: string;
  name: string;
  email: string;
  role: Papel;
};

/**
 * Usuários conferidos recentemente, por 30 s.
 *
 * Toda requisição precisa saber se a sessão ainda vale (usuário ativo, senha
 * não trocada). Ir ao banco a cada clique custaria uma ida a mais por tela;
 * com o cache, desativar alguém ou trocar a senha derruba a sessão em no
 * máximo 30 s.
 */
type Guardado = { usuario: Usuario | null; versao: number; ate: number };
// No globalThis: o proxy e as páginas são empacotados separadamente, e cada
// pacote teria o próprio Map — desativar alguém limparia só um deles.
const global_ = globalThis as unknown as { crmUsuarios?: Map<string, Guardado> };
const cache = (global_.crmUsuarios ??= new Map<string, Guardado>());

export function esquecerUsuario(id: string) {
  cache.delete(id);
}

/** Confere o token contra o banco. Usado pelo proxy e pelas páginas. */
export async function usuarioDoToken(token: string | undefined | null): Promise<Usuario | null> {
  const dados = lerToken(token);
  if (!dados) return null;

  const guardado = cache.get(dados.u);
  if (guardado && guardado.ate > Date.now()) {
    return guardado.usuario && guardado.versao === dados.v ? guardado.usuario : null;
  }

  const u = await prisma.user.findUnique({
    where: { id: dados.u },
    select: { id: true, name: true, email: true, role: true, active: true, sessionVersion: true },
  });
  const usuario = u && u.active ? { id: u.id, name: u.name, email: u.email, role: u.role } : null;
  cache.set(dados.u, { usuario, versao: u?.sessionVersion ?? -1, ate: Date.now() + 30_000 });

  return usuario && u!.sessionVersion === dados.v ? usuario : null;
}

/** Usuário logado na requisição atual (páginas, rotas da API), ou null. */
export async function usuarioAtual(): Promise<Usuario | null> {
  const jar = await cookies();
  return usuarioDoToken(jar.get(COOKIE_SESSAO)?.value);
}

/** Para rotas da API de configuração: master e administradores. */
export async function exigirAdmin(): Promise<Usuario | Response> {
  const usuario = await usuarioAtual();
  if (!usuario) return Response.json({ error: "Faça login." }, { status: 401 });
  if (!ehAdministrador(usuario.role)) {
    return Response.json({ error: "Só administradores podem fazer isso." }, { status: 403 });
  }
  return usuario;
}
