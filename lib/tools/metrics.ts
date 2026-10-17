import { z } from "zod";
import { activityReport, funnelMetrics } from "@/lib/metrics";
import { listarFunis } from "@/lib/funis";

/**
 * Ferramentas de métricas.
 *
 * O cálculo vive em lib/metrics.ts, compartilhado com a página de métricas.
 * Aqui só se formata para leitura. Se o Claude e a tela calculassem separado,
 * você receberia dois números diferentes para a mesma pergunta e não teria
 * como saber qual acreditar.
 */

function pct(valor: number | null): string {
  if (valor === null) return "—";
  return `${Math.round(valor * 100)}%`;
}

function horasLegiveis(horas: number | null): string {
  if (horas === null) return "—";
  if (horas < 24) return `${Math.round(horas)}h`;
  return `${(horas / 24).toFixed(1)} dias`;
}

// ─────────────────────────────────────────────────────────────────────────────

export const metricasFunil = {
  name: "metricas_funil",
  description:
    "Métricas do funil num período: quantos leads passaram por cada estágio, taxa " +
    "de conversão entre etapas, tempo médio por estágio e onde está o gargalo. " +
    "Use para relatórios e para perguntas sobre desempenho do funil. O CRM pode " +
    "ter vários funis (Captação, Relacionamento…); sem 'funil', usa o primeiro.",
  schema: z.object({
    dias: z.number().min(1).max(730).default(30).describe("Período em dias."),
    funil: z.string().optional().describe("Nome do funil, ex.: 'Captação'. Sem ele, o primeiro funil."),
  }),
  async handler(args: { dias?: number; funil?: string }) {
    const funis = await listarFunis();
    const pedido = args.funil?.trim().toLowerCase();
    const escolhido = pedido ? funis.find((f) => f.name.toLowerCase() === pedido) : funis[0];
    if (pedido && !escolhido) {
      return `Não existe funil chamado "${args.funil}". Funis: ${funis.map((f) => f.name).join(", ")}.`;
    }
    const m = await funnelMetrics(args.dias ?? 30, escolhido?.id);

    if (m.estagios.length === 0) {
      return "Nenhum estágio configurado no funil.";
    }

    const linhas = m.estagios.map(
      (e) =>
        `| ${e.nome} | ${e.chegaram} | ${pct(e.conversao)} | ${e.agora} | ` +
        `${horasLegiveis(e.horasMedias)} |`,
    );

    return [
      `# Funil ${m.funil?.name ?? ""} nos últimos ${m.dias} dias`,
      funis.length > 1 ? `(Outros funis: ${funis.filter((f) => f.id !== m.funil?.id).map((f) => f.name).join(", ")})` : "",
      "",
      "| Estágio | Passaram | Conversão da etapa anterior | Estão agora | Tempo médio no estágio |",
      "|---|---|---|---|---|",
      ...linhas,
      "",
      `Novos leads no período: ${m.novos}`,
      `Ganhos: ${m.ganhos} · Perdidos: ${m.perdidos}`,
      m.conversaoGeral !== null
        ? `Conversão geral (novo lead → ganho): ${pct(m.conversaoGeral)}`
        : "",
      m.gargalo
        ? `\nGargalo: "${m.gargalo.nome}" — em média ${horasLegiveis(m.gargalo.horas)} nesse estágio antes de avançar.`
        : "",
      "\nObservação importante: 'Passaram' conta leads distintos que cruzaram o " +
        "estágio no período, não quem está parado lá agora. Um lead que passou " +
        "por Reunião e já avançou continua contando na Reunião — é o número que " +
        "responde 'quantos leads foram para reunião'.",
    ]
      .filter(Boolean)
      .join("\n");
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const relatorioAtividades = {
  name: "relatorio_atividades",
  description:
    "Relatório de atividades num período: quantos follow-ups foram feitos, " +
    "quantas reuniões aconteceram, quantas ligações e propostas, o que está em " +
    "aberto e o que está atrasado. Use para perguntas sobre o que foi feito.",
  schema: z.object({
    dias: z.number().min(1).max(730).default(30).describe("Período em dias."),
  }),
  async handler(args: { dias?: number }) {
    const r = await activityReport(args.dias ?? 30);

    if (!r.temRegistro) {
      return (
        `Nenhuma atividade registrada nos últimos ${r.dias} dias.\n\n` +
        "As métricas de follow-up e reunião dependem do registro de atividades " +
        "nos cards do funil — sem esse registro, não há o que medir. Marque as " +
        "atividades na aba 'atividades' de cada card."
      );
    }

    const linhas = r.porTipo.map((t) => `| ${t.label} | ${t.feitas} | ${t.abertas} |`);

    return [
      `# Atividades nos últimos ${r.dias} dias`,
      "",
      "| Tipo | Feitas no período | Em aberto |",
      "|---|---|---|",
      ...linhas,
      "",
      `Total feito no período: ${r.totalFeitas}`,
      `Leads distintos que tiveram reunião: ${r.leadsComReuniao}`,
      r.atrasadas > 0
        ? `\n⚠ ${r.atrasadas} ${r.atrasadas === 1 ? "atividade está atrasada" : "atividades estão atrasadas"} (venceram e não foram concluídas).`
        : "\nNada atrasado.",
    ].join("\n");
  },
};
