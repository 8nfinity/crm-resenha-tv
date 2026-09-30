import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { listarCampos } from "@/lib/custom-fields";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listarCampos());
}

const criarSchema = z.object({
  name: z.string().trim().min(1).max(40),
  type: z.enum(["TEXT", "SELECT", "NUMBER", "DATE"]).default("TEXT"),
  options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  showOnCard: z.boolean().default(false),
});

export async function POST(request: Request) {
  const parsed = criarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const { name, type, options, showOnCard } = parsed.data;

  if (type === "SELECT" && options.length === 0) {
    return NextResponse.json(
      { error: "Um campo de seleção precisa de pelo menos uma opção." },
      { status: 400 },
    );
  }

  const ultimo = await prisma.customField.findFirst({ orderBy: { order: "desc" } });

  const campo = await prisma.customField.create({
    data: {
      name,
      type,
      options: type === "SELECT" ? options : undefined,
      showOnCard,
      order: (ultimo?.order ?? -1) + 1,
    },
  });

  return NextResponse.json(campo, { status: 201 });
}
