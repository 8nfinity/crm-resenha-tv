import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { iaConfigurada, lerConfigIA, pensarResposta } from "@/lib/ia/agente";
import { contextoDoLead, historicoParaClaude } from "@/lib/ia/prompt";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  conversa: z
    .array(z.object({ de: z.enum(["contato", "ia"]), texto: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(40),
});

/**
 * Simulador da tela da IA: responde uma conversa de teste com as instruções
 * atuais, sem WhatsApp e sem mexer no CRM — as ações (qualificar, agendar,
 * passar para humano) só são descritas.
 */
export async function POST(request: Request) {
  if (!iaConfigurada()) {
    return NextResponse.json({ error: "Falta a chave da Anthropic (ANTHROPIC_API_KEY) no servidor." }, { status: 400 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });

  const cfg = await lerConfigIA();
  const historico = historicoParaClaude(
    parsed.data.conversa.map((m) => ({ fromMe: m.de === "ia", porIA: m.de === "ia", type: "TEXT", body: m.texto })),
  );
  if (historico.length === 0 || historico.at(-1)!.role !== "user") {
    return NextResponse.json({ error: "A última mensagem precisa ser do contato." }, { status: 400 });
  }

  try {
    const r = await pensarResposta({
      cfg,
      historico,
      contexto: contextoDoLead({
        agora: new Date(),
        nome: "Contato de teste",
        telefone: null,
        coluna: "Novo lead",
        qualificado: false,
        reunioes: [],
      }),
      executar: async (acao) =>
        acao.tipo === "reuniao" && Number.isNaN(new Date(acao.inicio).getTime())
          ? Promise.reject(new Error("Data inválida."))
          : "Feito (simulação: nada foi gravado no CRM).",
    });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "A chave da Anthropic foi recusada. Confira ANTHROPIC_API_KEY." }, { status: 400 });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Limite de uso da Anthropic atingido. Tente em instantes." }, { status: 429 });
    }
    if (e instanceof Anthropic.BadRequestError && e.message.includes("anthropic-workspace-id")) {
      return NextResponse.json(
        {
          error:
            "A chave da Anthropic foi criada fora de um workspace. Crie a chave dentro de um workspace " +
            "(console.anthropic.com → Workspaces → Default → API keys) ou adicione na Railway a variável " +
            "ANTHROPIC_WORKSPACE_ID com o id do workspace.",
        },
        { status: 400 },
      );
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `A Anthropic respondeu com erro ${e.status}: ${e.message}` }, { status: 502 });
    }
    throw e;
  }
}
