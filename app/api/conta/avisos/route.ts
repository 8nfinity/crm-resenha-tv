import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { usuarioAtual } from "@/lib/auth/usuario";
import { emailConfigurado } from "@/lib/email";

export const runtime = "nodejs";

/** A própria preferência de avisos por e-mail — cada pessoa decide a sua. */
export async function GET() {
  const usuario = await usuarioAtual();
  if (!usuario) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const registro = await prisma.user.findUnique({
    where: { id: usuario.id },
    select: { emailNotifications: true },
  });
  return NextResponse.json({
    emailNotifications: registro?.emailNotifications ?? false,
    configurado: emailConfigurado(),
  });
}

const schema = z.object({ emailNotifications: z.boolean() });

export async function PATCH(request: Request) {
  const usuario = await usuarioAtual();
  if (!usuario) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  await prisma.user.update({
    where: { id: usuario.id },
    data: { emailNotifications: parsed.data.emailNotifications },
  });
  return NextResponse.json({ ok: true, emailNotifications: parsed.data.emailNotifications });
}
