import { z } from "zod";
import { prisma } from "@/lib/db";
import { contactName, daysSince } from "@/lib/queries";
import { formatPhone } from "@/lib/evolution/parse";
import type { StoredScoreFactors } from "@/lib/types";

/**
 * Ferramentas de leitura sobre leads.
 *
 * Elas devolvem texto em português, não JSON cru. A razão é prática: o Claude
 * responde melhor a dados já interpretados, e você vê a mesma linguagem que a
 * interface usa. Um JSON com `lastInboundAt: "2026-09-02T..."` obriga o modelo
 * a calcular datas de cabeça, e é aí que ele erra.
 */

function scoreFactorsOf(raw: unknown): StoredScoreFactors {
  if (raw && typeof raw === "object" && "factors" in raw) {
    const s = raw as StoredScoreFactors;
    if (Array.isArray(s.factors)) return s;
  }
  return { summary: "", factors: [] };
}

function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────

export const listarLeads = {
  name: "listar_leads",
  description:
    "Lista os leads do funil com filtros opcionais por estágio, score mínimo e " +
    "dias parados. Use para responder perguntas gerais sobre quem está no funil.",
  schema: z.object({
    estagio: z
      .string()
      .optional()
      .describe("Nome do estágio, ex: 'Proposta enviada'. Omita para todos."),
    score_minimo: z.number().min(0).max(100).optional(),
    parado_ha_pelo_menos: z
      .number()
      .optional()
      .describe("Só leads parados no estágio há pelo menos N dias."),
    limite: z.number().min(1).max(100).default(25),
  }),
  async handler(args: {
    estagio?: string;
    score_minimo?: number;
    parado_ha_pelo_menos?: number;
    limite?: number;
  }) {
    const limite = args.limite ?? 25;

    const deals = await prisma.deal.findMany({
      where: {
        archivedAt: null,
        ...(args.score_minimo !== undefined ? { score: { gte: args.score_minimo } } : {}),
        ...(args.estagio
          ? { stage: { name: { equals: args.estagio, mode: "insensitive" } } }
          : {}),
        ...(args.parado_ha_pelo_menos !== undefined
          ? { enteredStageAt: { lte: diasAtras(args.parado_ha_pelo_menos) } }
          : {}),
      },
      include: { contact: true, stage: true },
      orderBy: [{ score: "desc" }],
      take: limite,
    });

    if (deals.length === 0) {
      return "Nenhum lead encontrado com esses filtros.";
    }

    const linhas = deals.map((d) => {
      const nome = d.title ?? contactName(d.contact);
      const parado = daysSince(d.enteredStageAt);
      const resposta = d.lastInboundAt
        ? `respondeu há ${daysSince(d.lastInboundAt)}d`
        : "nunca respondeu";
      const valor = d.value
        ? ` · ${Number(d.value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
        : "";
      return `- ${nome} (score ${d.score}) · ${d.stage.name} · parado ${parado}d · ${resposta}${valor}`;
    });

    return `${deals.length} leads:\n${linhas.join("\n")}`;
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const leadsMaisQuentes = {
  name: "leads_mais_quentes",
  description:
    "Os leads mais quentes do funil, em ordem de prioridade de abordagem, COM a " +
    "justificativa de cada score. Use quando perguntarem quem abordar primeiro.",
  schema: z.object({
    limite: z.number().min(1).max(30).default(10),
  }),
  async handler(args: { limite?: number }) {
    const deals = await prisma.deal.findMany({
      where: {
        archivedAt: null,
        stage: { isWon: false, isLost: false },
      },
      include: { contact: true, stage: true },
      orderBy: { score: "desc" },
      take: args.limite ?? 10,
    });

    if (deals.length === 0) {
      return "Não há leads ativos no funil.";
    }

    const blocos = deals.map((d, i) => {
      const nome = d.title ?? contactName(d.contact);
      const { summary, factors } = scoreFactorsOf(d.scoreFactors);
      const porques = factors
        .filter((f) => f.points !== 0)
        .map((f) => `    ${f.points > 0 ? "+" : ""}${f.points} ${f.detail}`)
        .join("\n");

      return (
        `${i + 1}. ${nome} — score ${d.score} (${summary})\n` +
        `    Estágio: ${d.stage.name} · Telefone: ${formatPhone(d.contact.phone) ?? "—"}\n` +
        (porques || "    (score ainda não calculado)")
      );
    });

    return (
      "Leads em ordem de prioridade, com os fatores que produziram cada score:\n\n" +
      blocos.join("\n\n")
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const leadsEsquecidos = {
  name: "leads_esquecidos",
  description:
    "Leads sem nenhuma interação há mais de N dias. Use para encontrar quem caiu " +
    "no esquecimento e precisa de follow-up.",
  schema: z.object({
    dias: z.number().min(1).default(14).describe("Sem interação há pelo menos N dias."),
    limite: z.number().min(1).max(100).default(30),
  }),
  async handler(args: { dias?: number; limite?: number }) {
    const dias = args.dias ?? 14;
    const corte = diasAtras(dias);

    const deals = await prisma.deal.findMany({
      where: {
        archivedAt: null,
        stage: { isWon: false, isLost: false },
        OR: [{ lastInteractionAt: { lt: corte } }, { lastInteractionAt: null }],
      },
      include: { contact: true, stage: true },
      orderBy: [{ lastInteractionAt: "asc" }],
      take: args.limite ?? 30,
    });

    if (deals.length === 0) {
      return `Nenhum lead está sem interação há mais de ${dias} dias. Funil em dia.`;
    }

    const linhas = deals.map((d) => {
      const nome = d.title ?? contactName(d.contact);
      const quando = d.lastInteractionAt
        ? `última conversa há ${daysSince(d.lastInteractionAt)}d`
        : "nunca houve conversa registrada";
      return `- ${nome} · ${d.stage.name} · ${quando} · score ${d.score}`;
    });

    return `${deals.length} leads parados há mais de ${dias} dias:\n${linhas.join("\n")}`;
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const historicoContato = {
  name: "historico_contato",
  description:
    "Histórico completo de um lead: dados, estágio, conversas, notas e atividades. " +
    "Busque pelo nome ou telefone. Use antes de aconselhar sobre uma abordagem específica.",
  schema: z.object({
    busca: z.string().min(1).describe("Nome ou telefone do contato."),
    limite_mensagens: z.number().min(1).max(200).default(40),
  }),
  async handler(args: { busca: string; limite_mensagens?: number }) {
    const termo = args.busca.trim();
    const somenteDigitos = termo.replace(/\D/g, "");

    const deal = await prisma.deal.findFirst({
      where: {
        archivedAt: null,
        contact: {
          OR: [
            { savedName: { contains: termo, mode: "insensitive" } },
            { pushName: { contains: termo, mode: "insensitive" } },
            ...(somenteDigitos.length >= 4
              ? [{ phone: { contains: somenteDigitos } }]
              : []),
          ],
        },
      },
      include: {
        contact: {
          include: {
            messages: {
              orderBy: { timestamp: "desc" },
              take: args.limite_mensagens ?? 40,
            },
          },
        },
        stage: true,
        notes: { orderBy: { createdAt: "desc" } },
        activities: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!deal) {
      return `Nenhum lead encontrado para "${termo}".`;
    }

    const nome = deal.title ?? contactName(deal.contact);
    const { summary, factors } = scoreFactorsOf(deal.scoreFactors);

    const partes: string[] = [
      `# ${nome}`,
      `Telefone: ${formatPhone(deal.contact.phone) ?? "—"}`,
      `Estágio: ${deal.stage.name} (há ${daysSince(deal.enteredStageAt)} dias)`,
      `Score: ${deal.score} (${summary})`,
      factors.length > 0
        ? factors.map((f) => `  ${f.points > 0 ? "+" : ""}${f.points} ${f.detail}`).join("\n")
        : "",
    ];

    if (deal.activities.length > 0) {
      partes.push(
        "\n## Atividades",
        deal.activities
          .map(
            (a) =>
              `- ${a.type}${a.title ? `: ${a.title}` : ""} — ${
                a.doneAt ? `feito há ${daysSince(a.doneAt)}d` : "em aberto"
              }`,
          )
          .join("\n"),
      );
    }

    if (deal.notes.length > 0) {
      partes.push(
        "\n## Notas",
        deal.notes
          .map((n) => `- (há ${daysSince(n.createdAt)}d) ${n.body}`)
          .join("\n"),
      );
    }

    const mensagens = [...deal.contact.messages].reverse();
    if (mensagens.length > 0) {
      partes.push(
        `\n## Conversa (${mensagens.length} mensagens mais recentes)`,
        mensagens
          .map((m) => {
            const quem = m.fromMe ? "Você" : nome;
            const data = m.timestamp.toLocaleDateString("pt-BR");
            const texto = m.body ?? `[${m.type.toLowerCase()}]`;
            return `[${data}] ${quem}: ${texto}`;
          })
          .join("\n"),
      );
    } else {
      partes.push("\n## Conversa\nNenhuma mensagem importada para este contato.");
    }

    return partes.filter(Boolean).join("\n");
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const buscarConversas = {
  name: "buscar_conversas",
  description:
    "Busca um termo dentro do conteúdo das mensagens e mostra quem falou nisso. " +
    "Use para perguntas como 'quem perguntou sobre preço' ou 'quem mencionou orçamento'.",
  schema: z.object({
    termo: z.string().min(2).describe("Texto a procurar nas mensagens."),
    limite: z.number().min(1).max(50).default(20),
  }),
  async handler(args: { termo: string; limite?: number }) {
    const mensagens = await prisma.message.findMany({
      where: { body: { contains: args.termo, mode: "insensitive" } },
      include: { contact: { include: { deals: { include: { stage: true } } } } },
      orderBy: { timestamp: "desc" },
      take: args.limite ?? 20,
    });

    if (mensagens.length === 0) {
      return `Nenhuma mensagem menciona "${args.termo}".`;
    }

    const linhas = mensagens.map((m) => {
      const nome = contactName(m.contact);
      const estagio = m.contact.deals[0]?.stage.name ?? "sem funil";
      const quem = m.fromMe ? "Você" : nome;
      const data = m.timestamp.toLocaleDateString("pt-BR");
      const trecho = (m.body ?? "").slice(0, 200);
      return `- [${data}] ${quem} (lead: ${nome} · ${estagio}):\n  "${trecho}"`;
    });

    return `${mensagens.length} mensagens mencionam "${args.termo}":\n\n${linhas.join("\n")}`;
  },
};
