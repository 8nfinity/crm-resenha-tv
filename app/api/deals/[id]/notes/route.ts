import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const bodySchema = z.object({ body: z.string().trim().min(1).max(5000) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Anotação vazia" }, { status: 400 });
  }

  const note = await prisma.note.create({
    data: { dealId: id, body: parsed.data.body },
  });

  return NextResponse.json(note, { status: 201 });
}
