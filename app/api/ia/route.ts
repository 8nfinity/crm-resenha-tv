import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { MODELOS_IA, iaConfigurada, lerConfigIA } from "@/lib/ia/agente";

export const runtime = "nodejs";

/** Configuração da IA de atendimento (só administradores — ver proxy.ts). */
export async function GET() {
  const cfg = await lerConfigIA();
  return NextResponse.json({ ...cfg, chaveConfigurada: iaConfigurada(), modelos: MODELOS_IA });
}

const schema = z.object({
  ativo: z.boolean(),
  pipelineId: z.string().min(1).nullable(),
  nome: z.string().trim().min(1).max(40),
  modelo: z.enum(MODELOS_IA.map((m) => m.id) as [string, ...string[]]),
  empresa: z.string().max(8000),
  qualificacao: z.string().max(4000),
  agenda: z.string().max(4000),
  regras: z.string().max(4000),
  colunaQualificadoId: z.string().min(1).nullable(),
  colunaAgendadoId: z.string().min(1).nullable(),
});

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const d = parsed.data;

  if (d.ativo && !d.pipelineId) {
    return NextResponse.json({ error: "Escolha o funil que a IA vai atender antes de ligar." }, { status: 400 });
  }
  if (d.ativo && !iaConfigurada()) {
    return NextResponse.json(
      { error: "Falta a chave da Anthropic (variável ANTHROPIC_API_KEY) no servidor do CRM." },
      { status: 400 },
    );
  }
  // As colunas de destino precisam ser do funil da IA.
  for (const colunaId of [d.colunaQualificadoId, d.colunaAgendadoId]) {
    if (!colunaId) continue;
    const coluna = await prisma.stage.findUnique({ where: { id: colunaId }, select: { pipelineId: true } });
    if (!coluna || coluna.pipelineId !== d.pipelineId) {
      return NextResponse.json({ error: "As colunas de destino precisam ser do funil da IA." }, { status: 400 });
    }
  }

  const cfg = await prisma.agenteIA.upsert({
    where: { id: "singleton" },
    update: d,
    create: { id: "singleton", ...d },
  });
  return NextResponse.json(cfg);
}
