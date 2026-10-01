import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { gerarHash, senhaFraca } from "@/lib/auth/senha";
import { esquecerUsuario, exigirAdmin } from "@/lib/auth/usuario";
import { papeisQuePodeAtribuir, podeAlterar } from "@/lib/auth/papeis";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(["MASTER", "ADMIN", "VENDEDOR"]).optional(),
  active: z.boolean().optional(),
  /** Nova senha definida por quem está acima (ex.: a pessoa esqueceu a dela). */
  senha: z.string().max(200).optional(),
});

/**
 * Altera um usuário: nome, papel, ativo/inativo ou senha.
 *
 * Só quem está acima do alvo altera (ver lib/auth/papeis.ts): administrador
 * mexe em vendedor; só o master mexe em administradores e em masters.
 * Desativar e trocar a senha derrubam as sessões abertas daquele acesso.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ator = await exigirAdmin();
  if (ator instanceof Response) return ator;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { name, role, active, senha } = parsed.data;

  const alvo = await prisma.user.findUnique({ where: { id } });
  if (!alvo) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  if (!podeAlterar({ id: ator.id, papel: ator.role }, { id: alvo.id, papel: alvo.role })) {
    return NextResponse.json(
      {
        error:
          ator.id === alvo.id
            ? "Para trocar a sua senha, use “Minha conta”."
            : "Você não tem permissão para alterar este acesso.",
      },
      { status: 403 },
    );
  }
  if (role !== undefined && !papeisQuePodeAtribuir(ator.role).includes(role)) {
    return NextResponse.json({ error: "Você não pode dar esse papel." }, { status: 403 });
  }

  // O CRM nunca fica sem nenhum master ativo: ninguém mais conseguiria
  // gerenciar os administradores.
  const perdeMaster = alvo.role === "MASTER" && alvo.active && ((role && role !== "MASTER") || active === false);
  if (perdeMaster) {
    const outros = await prisma.user.count({ where: { role: "MASTER", active: true, id: { not: id } } });
    if (outros === 0) {
      return NextResponse.json({ error: "Este é o único master ativo." }, { status: 409 });
    }
  }

  if (senha !== undefined) {
    const fraca = senhaFraca(senha);
    if (fraca) return NextResponse.json({ error: fraca }, { status: 400 });
  }

  const derrubaSessao = senha !== undefined || active === false || role !== undefined;
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
