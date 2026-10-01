import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { gerarHash, senhaFraca } from "@/lib/auth/senha";
import { esquecerUsuario, exigirAdmin } from "@/lib/auth/usuario";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(["ADMIN", "VENDEDOR"]).optional(),
  active: z.boolean().optional(),
  /** Nova senha definida pelo administrador (ex.: a pessoa esqueceu a dela). */
  senha: z.string().max(200).optional(),
});

/**
 * Altera um usuário: nome, papel, ativo/inativo ou senha.
 *
 * Desativar e trocar a senha sobem a versão de sessão: quem estava logado com
 * aquele acesso cai em no máximo 30 s (o tempo do cache de conferência).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await exigirAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { name, role, active, senha } = parsed.data;

  const alvo = await prisma.user.findUnique({ where: { id } });
  if (!alvo) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Nunca deixar o CRM sem nenhum administrador ativo — ninguém mais
  // conseguiria criar acessos.
  const perdeAdmin = alvo.role === "ADMIN" && alvo.active && (role === "VENDEDOR" || active === false);
  if (perdeAdmin) {
    const outrosAdmins = await prisma.user.count({ where: { role: "ADMIN", active: true, id: { not: id } } });
    if (outrosAdmins === 0) {
      return NextResponse.json(
        { error: "Este é o único administrador ativo. Promova outra pessoa antes." },
        { status: 409 },
      );
    }
  }

  if (senha !== undefined) {
    const fraca = senhaFraca(senha);
    if (fraca) return NextResponse.json({ error: fraca }, { status: 400 });
  }

  const derrubaSessao = senha !== undefined || active === false;
  const usuario = await prisma.user.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(senha !== undefined ? { passwordHash: await gerarHash(senha) } : {}),
      ...(derrubaSessao ? { sessionVersion: { increment: 1 } } : {}),
    },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  esquecerUsuario(id);
  return NextResponse.json(usuario);
}
