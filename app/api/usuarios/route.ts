import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { gerarHash, senhaFraca } from "@/lib/auth/senha";
import { exigirAdmin } from "@/lib/auth/usuario";

export const runtime = "nodejs";

/** Lista de usuários — só o administrador vê. */
export async function GET() {
  const admin = await exigirAdmin();
  if (admin instanceof Response) return admin;

  const usuarios = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true },
  });
  return NextResponse.json(usuarios);
}

const criarSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  senha: z.string().max(200),
  role: z.enum(["ADMIN", "VENDEDOR"]).default("VENDEDOR"),
});

/** Cria um acesso. A senha inicial é passada por quem criou; a pessoa troca depois. */
export async function POST(request: Request) {
  const admin = await exigirAdmin();
  if (admin instanceof Response) return admin;

  const parsed = criarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Preencha nome, um e-mail válido e a senha." }, { status: 400 });
  }
  const { name, email, senha, role } = parsed.data;

  const fraca = senhaFraca(senha);
  if (fraca) return NextResponse.json({ error: fraca }, { status: 400 });

  if (await prisma.user.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "Já existe um usuário com esse e-mail." }, { status: 409 });
  }

  const usuario = await prisma.user.create({
    data: { name, email, role, passwordHash: await gerarHash(senha) },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  return NextResponse.json(usuario, { status: 201 });
}
