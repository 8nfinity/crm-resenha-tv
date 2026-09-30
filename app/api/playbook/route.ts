import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { avisarMudanca } from "@/lib/eventos";

export const runtime = "nodejs";

const criarSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(100_000).default(""),
});

/** Cria uma seção no fim do playbook. Aceita uma ou várias (modelo inicial). */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const lista = z.array(criarSchema).max(30).safeParse(Array.isArray(json) ? json : [json]);
  if (!lista.success || lista.data.length === 0) {
    return NextResponse.json({ error: "Dê um título à seção." }, { status: 400 });
  }

  const ultima = await prisma.playbookSection.findFirst({ orderBy: { order: "desc" } });
  let ordem = (ultima?.order ?? -1) + 1;

  const criadas = await prisma.$transaction(
    lista.data.map((s) => prisma.playbookSection.create({ data: { ...s, order: ordem++ } })),
  );

  avisarMudanca({ dealIds: [], motivo: "playbook" });
  return NextResponse.json(criadas, { status: 201 });
}
