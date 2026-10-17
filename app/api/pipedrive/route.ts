import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ErroPipedrive, conferirToken, esquecerConfigGuardada, lerConfig } from "@/lib/pipedrive";

export const runtime = "nodejs";

/**
 * Configuração do Pipedrive (só administradores — ver proxy.ts).
 * O token entra por aqui e nunca sai: a tela recebe só se está conectado.
 */
export async function GET() {
  const cfg = await lerConfig();
  if (!cfg) return NextResponse.json({ conectado: false });

  // "Quem sou eu" de novo: mostra a empresa e confirma que o token segue valendo.
  let empresa: string | null = null;
  let usuario: string | null = null;
  let erro: string | null = null;
  try {
    const eu = await conferirToken(cfg.token);
    empresa = eu.empresa;
    usuario = eu.nome;
  } catch (e) {
    erro = e instanceof ErroPipedrive ? e.message : "Não deu para conferir o token agora.";
  }

  return NextResponse.json({
    conectado: true,
    empresa,
    usuario,
    dominio: cfg.dominio,
    erro,
    pipelineId: cfg.pipelineId,
    stageId: cfg.stageId,
    autoStageId: cfg.autoStageId,
  });
}

const conectarSchema = z.object({ token: z.string().trim().min(10).max(200) });

/** Conecta (ou troca) o token. Confere com o Pipedrive antes de guardar. */
export async function PUT(request: Request) {
  const parsed = conectarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Cole o token de API do Pipedrive." }, { status: 400 });

  try {
    const eu = await conferirToken(parsed.data.token);
    const dados = {
      pipedriveToken: parsed.data.token,
      pipedriveDomain: eu.dominio,
      // Trocou de empresa: o funil e a etapa escolhidos eram da outra.
      pipedrivePipelineId: null,
      pipedriveStageId: null,
    };
    await prisma.systemState.upsert({
      where: { id: "singleton" },
      update: dados,
      create: { id: "singleton", ...dados },
    });
    esquecerConfigGuardada();
    return NextResponse.json({ ok: true, empresa: eu.empresa, usuario: eu.nome });
  } catch (e) {
    const msg = e instanceof ErroPipedrive ? e.message : "Não deu para conferir o token.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

const destinoSchema = z.object({
  pipelineId: z.number().int().positive().nullable(),
  stageId: z.number().int().positive().nullable(),
  /** Coluna do CRM que envia sozinha; nula desliga o envio automático. */
  autoStageId: z.string().min(1).nullable(),
});

/** Para onde vão os negócios e qual coluna do CRM envia sozinha. */
export async function PATCH(request: Request) {
  const parsed = destinoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  if (parsed.data.autoStageId) {
    const existe = await prisma.stage.findUnique({ where: { id: parsed.data.autoStageId }, select: { id: true } });
    if (!existe) return NextResponse.json({ error: "Coluna não encontrada" }, { status: 400 });
  }

  await prisma.systemState.update({
    where: { id: "singleton" },
    data: {
      pipedrivePipelineId: parsed.data.pipelineId,
      pipedriveStageId: parsed.data.stageId,
      pipedriveAutoStageId: parsed.data.autoStageId,
    },
  });
  esquecerConfigGuardada();
  return NextResponse.json({ ok: true });
}

/** Desconecta: apaga o token. Os leads já enviados guardam o id do negócio. */
export async function DELETE() {
  await prisma.systemState.updateMany({
    where: { id: "singleton" },
    data: {
      pipedriveToken: null,
      pipedriveDomain: null,
      pipedrivePipelineId: null,
      pipedriveStageId: null,
      pipedriveAutoStageId: null,
    },
  });
  esquecerConfigGuardada();
  return NextResponse.json({ ok: true });
}
