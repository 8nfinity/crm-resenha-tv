import { prisma } from "@/lib/db";
import {
  distribuir,
  resumir,
  SILENCIO_QUE_ABRE_CONVERSA_H,
  type ResumoResposta,
  type VezDoLead,
} from "@/lib/tempo-resposta";

/**
 * Cálculo das métricas do funil.
 *
 * Devolve dados estruturados; quem formata é quem chama — a página de métricas
 * desenha tabelas, a ferramenta do MCP escreve texto. O cálculo fica num lugar
 * só justamente para o Claude e a tela nunca discordarem sobre um número.
 *
 * Tudo sai de `StageTransition`, não do estágio atual dos deals: a pergunta
 * "quantos leads chegaram a reunião este mês" inclui quem já avançou ou foi
 * perdido depois, e olhar só o estado atual esconderia todos eles.
 */

export type StageMetric = {
  id: string;
  nome: string;
  cor: string;
  isWon: boolean;
  isLost: boolean;
  /** Deals distintos que passaram por este estágio no período. */
  chegaram: number;
  /** Deals parados aqui agora. */
  agora: number;
  /** Horas médias que os deals ficaram aqui antes de sair. */
  horasMedias: number | null;
  /** Conversão a partir do estágio anterior, 0–1. Nulo no primeiro estágio. */
  conversao: number | null;
};

export type FunnelMetrics = {
  dias: number;
  estagios: StageMetric[];
  novos: number;
  ganhos: number;
  perdidos: number;
  conversaoGeral: number | null;
  gargalo: { nome: string; horas: number } | null;
};

/**
 * Início do período. "1 dia" é HOJE, desde a meia-noite — é o que se espera
 * de "métricas do dia"; as últimas 24 h misturariam o fim de ontem.
 */
function diasAtras(dias: number): Date {
  if (dias === 1) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return hoje;
  }
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

export async function funnelMetrics(dias: number): Promise<FunnelMetrics> {
  const desde = diasAtras(dias);

  // As quatro consultas são independentes entre si. Sequenciais, cada uma paga
  // os ~200ms de rede até o banco (que fica em outra região) — quatro idas
  // viram uma. É a diferença entre a tela de métricas responder em 800ms ou
  // em 200ms.
  //
  // O COUNT(DISTINCT) da segunda é essencial: um lead que volta de estágio e
  // avança de novo geraria duas passagens pelo mesmo ponto, inflando a
  // conversão. O `groupBy` do Prisma conta linhas, não valores distintos.
  const [estagios, chegadas, permanencia, atuais] = await Promise.all([
    prisma.stage.findMany({ orderBy: { order: "asc" } }),

    prisma.$queryRaw<{ toStageId: string; total: bigint }[]>`
      SELECT "toStageId", COUNT(DISTINCT "dealId") AS total
      FROM "StageTransition" t
      WHERE t."at" >= ${desde}
        AND NOT EXISTS (
          SELECT 1 FROM "Deal" d JOIN "Contact" c ON c."id" = d."contactId"
          WHERE d."id" = t."dealId" AND c."ignoredAt" IS NOT NULL
        )
      GROUP BY "toStageId"
    `,

    prisma.stageTransition.groupBy({
      by: ["fromStageId"],
      where: { at: { gte: desde }, hoursInFrom: { not: null }, deal: { contact: { ignoredAt: null } } },
      _avg: { hoursInFrom: true },
    }),

    prisma.deal.groupBy({
      by: ["stageId"],
      where: { archivedAt: null },
      _count: { _all: true },
    }),
  ]);

  if (estagios.length === 0) {
    return {
      dias,
      estagios: [],
      novos: 0,
      ganhos: 0,
      perdidos: 0,
      conversaoGeral: null,
      gargalo: null,
    };
  }

  const chegadaPorEstagio = new Map(
    chegadas.map((c) => [c.toStageId, Number(c.total)]),
  );

  const mediaPorEstagio = new Map(
    permanencia
      .filter((p) => p.fromStageId !== null)
      .map((p) => [p.fromStageId as string, p._avg.hoursInFrom ?? 0]),
  );

  const atualPorEstagio = new Map(atuais.map((a) => [a.stageId, a._count._all]));

  const metrics: StageMetric[] = estagios.map((e, i) => {
    const chegaram = chegadaPorEstagio.get(e.id) ?? 0;
    const anterior = i > 0 ? (chegadaPorEstagio.get(estagios[i - 1].id) ?? 0) : 0;

    return {
      id: e.id,
      nome: e.name,
      cor: e.color,
      isWon: e.isWon,
      isLost: e.isLost,
      chegaram,
      agora: atualPorEstagio.get(e.id) ?? 0,
      horasMedias: mediaPorEstagio.get(e.id) ?? null,
      conversao: i > 0 && anterior > 0 ? chegaram / anterior : null,
    };
  });

  // Gargalo: onde os leads mais demoram para sair, ignorando estágios finais
  // (ficar muito tempo em "Ganho" não é problema de ninguém).
  let gargalo: { nome: string; horas: number } | null = null;
  for (const m of metrics) {
    if (m.isWon || m.isLost || m.horasMedias === null) continue;
    if (!gargalo || m.horasMedias > gargalo.horas) {
      gargalo = { nome: m.nome, horas: m.horasMedias };
    }
  }

  const novos = metrics[0]?.chegaram ?? 0;
  const ganhos = metrics.filter((m) => m.isWon).reduce((s, m) => s + m.chegaram, 0);
  const perdidos = metrics
    .filter((m) => m.isLost)
    .reduce((s, m) => s + m.chegaram, 0);

  return {
    dias,
    estagios: metrics,
    novos,
    ganhos,
    perdidos,
    conversaoGeral: novos > 0 ? ganhos / novos : null,
    gargalo,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export type ActivityReport = {
  dias: number;
  porTipo: { tipo: string; label: string; feitas: number; abertas: number }[];
  totalFeitas: number;
  atrasadas: number;
  leadsComReuniao: number;
  temRegistro: boolean;
};

export const ACTIVITY_LABELS: Record<string, string> = {
  FOLLOW_UP: "Follow-ups",
  MEETING: "Reuniões",
  CALL: "Ligações",
  PROPOSAL: "Propostas",
  OTHER: "Outras",
};

/** Atividades de contatos ignorados ficam de fora de todas as contas. */
const visivel = { deal: { contact: { ignoredAt: null } } };

export async function activityReport(dias: number): Promise<ActivityReport> {
  const desde = diasAtras(dias);
  const agora = new Date();

  const [feitas, abertas, atrasadas, total, reunioes] = await Promise.all([
    prisma.activity.groupBy({
      by: ["type"],
      where: { doneAt: { gte: desde }, ...visivel },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["type"],
      where: { doneAt: null, ...visivel },
      _count: { _all: true },
    }),
    prisma.activity.count({ where: { doneAt: null, dueAt: { lt: agora }, ...visivel } }),
    prisma.activity.count({ where: { createdAt: { gte: desde }, ...visivel } }),
    prisma.activity.findMany({
      where: { type: "MEETING", doneAt: { gte: desde }, ...visivel },
      select: { dealId: true },
      distinct: ["dealId"],
    }),
  ]);

  const feitasMap = new Map(feitas.map((f) => [String(f.type), f._count._all]));
  const abertasMap = new Map(abertas.map((a) => [String(a.type), a._count._all]));

  const porTipo = Object.entries(ACTIVITY_LABELS).map(([tipo, label]) => ({
    tipo,
    label,
    feitas: feitasMap.get(tipo) ?? 0,
    abertas: abertasMap.get(tipo) ?? 0,
  }));

  return {
    dias,
    porTipo,
    totalFeitas: porTipo.reduce((s, t) => s + t.feitas, 0),
    atrasadas,
    leadsComReuniao: reunioes.length,
    temRegistro: total > 0 || abertas.length > 0,
  };
}

// ─── Tempo de resposta do vendedor ───────────────────────────────────────────

export type TempoRespostaVendedor = {
  id: string;
  nome: string;
  cor: string;
  primeira: ResumoResposta;
  duranteConversa: ResumoResposta;
};

export type RelatorioTempoResposta = {
  dias: number;
  /** Lead chegou (ou voltou depois de horas): o número que mais pesa em venda. */
  primeira: ResumoResposta;
  faixasPrimeira: { rotulo: string; quantidade: number }[];
  /** Ida e volta de um papo já em andamento. */
  duranteConversa: ResumoResposta;
  /** Um por número conectado — cada número é um vendedor. */
  porVendedor: TempoRespostaVendedor[];
};

/**
 * Quanto tempo cada vendedor leva para responder um lead.
 *
 * O SQL acha as "vezes do lead": mensagem dele cuja anterior na conversa foi
 * sua (ou que abre a conversa). Para cada uma, a primeira mensagem sua depois
 * dela é a resposta. Grupos ficam de fora — não são lead.
 *
 * O LAG roda sobre o histórico inteiro, não só o período: filtrar antes faria
 * a primeira mensagem do período parecer o começo de uma conversa nova e
 * inventaria esperas que não existiram.
 */
export async function tempoDeResposta(dias: number): Promise<RelatorioTempoResposta> {
  const desde = diasAtras(dias);

  const [linhas, contas] = await Promise.all([
    prisma.$queryRaw<VezDoLead[]>`
      WITH msgs AS (
        SELECT m."contactId", c."accountId", m."fromMe", m."timestamp",
               LAG(m."fromMe") OVER janela AS anterior_minha,
               LAG(m."timestamp") OVER janela AS anterior_em
        FROM "Message" m
        JOIN "Contact" c ON c."id" = m."contactId"
        WHERE c."isGroup" = false AND c."ignoredAt" IS NULL
        WINDOW janela AS (PARTITION BY m."contactId" ORDER BY m."timestamp", m."id")
      )
      SELECT v."accountId", v."timestamp" AS perguntou,
             (SELECT MIN(r."timestamp") FROM "Message" r
               WHERE r."contactId" = v."contactId"
                 AND r."fromMe" = true
                 AND r."timestamp" > v."timestamp") AS respondeu,
             (v.anterior_em IS NULL
               OR v."timestamp" - v.anterior_em > make_interval(hours => ${SILENCIO_QUE_ABRE_CONVERSA_H}::int)
             ) AS inicio
      FROM msgs v
      WHERE v."fromMe" = false
        AND (v.anterior_minha IS NULL OR v.anterior_minha = true)
        AND v."timestamp" >= ${desde}
    `,
    prisma.whatsAppAccount.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, instanceName: true, color: true },
    }),
  ]);

  const agora = new Date();
  const porConta = new Map<string, VezDoLead[]>();
  for (const l of linhas) {
    const lista = porConta.get(l.accountId) ?? [];
    lista.push(l);
    porConta.set(l.accountId, lista);
  }

  const iniciais = (vs: VezDoLead[]) => vs.filter((v) => v.inicio);
  const meio = (vs: VezDoLead[]) => vs.filter((v) => !v.inicio);

  return {
    dias,
    primeira: resumir(iniciais(linhas), agora),
    faixasPrimeira: distribuir(iniciais(linhas)),
    duranteConversa: resumir(meio(linhas), agora),
    porVendedor: contas
      .filter((c) => porConta.has(c.id))
      .map((c) => {
        const vezes = porConta.get(c.id)!;
        return {
          id: c.id,
          nome: c.label ?? c.instanceName,
          cor: c.color,
          primeira: resumir(iniciais(vezes), agora),
          duranteConversa: resumir(meio(vezes), agora),
        };
      }),
  };
}

// ─── Follow-ups feitos ───────────────────────────────────────────────────────

/** As janelas fixas do quadro de follow-ups: hoje, 7, 15 e 30 dias. */
export const JANELAS_FOLLOW_UP = [1, 7, 15, 30] as const;

export type FollowUpsFeitos = {
  /** Quantidade feita em cada janela, na ordem de JANELAS_FOLLOW_UP. */
  janelas: { dias: number; feitos: number }[];
  /** Agendados e ainda em aberto, de qualquer data. */
  agendados: number;
  atrasados: number;
  /** Feitos em 30 dias por número (vendedor), pelo número do lead. */
  porVendedor: { id: string; nome: string; cor: string; feitos: number[] }[];
};

/**
 * Quantos follow-ups foram FEITOS (data de conclusão) em cada janela.
 *
 * Um SELECT só com FILTER por janela: as quatro contagens (e a quebra por
 * número) saem numa ida ao banco, em vez de quatro.
 */
export async function followUpsFeitos(): Promise<FollowUpsFeitos> {
  const inicios = JANELAS_FOLLOW_UP.map(diasAtras);
  const agora = new Date();

  const [linhas, agendados, atrasados, contas] = await Promise.all([
    prisma.$queryRaw<{ accountId: string; j1: number; j7: number; j15: number; j30: number }[]>`
      SELECT c."accountId",
             COUNT(*) FILTER (WHERE a."doneAt" >= ${inicios[0]})::int AS j1,
             COUNT(*) FILTER (WHERE a."doneAt" >= ${inicios[1]})::int AS j7,
             COUNT(*) FILTER (WHERE a."doneAt" >= ${inicios[2]})::int AS j15,
             COUNT(*) FILTER (WHERE a."doneAt" >= ${inicios[3]})::int AS j30
      FROM "Activity" a
      JOIN "Deal" d ON d."id" = a."dealId"
      JOIN "Contact" c ON c."id" = d."contactId"
      WHERE a."type" = 'FOLLOW_UP' AND a."doneAt" >= ${inicios[3]} AND c."ignoredAt" IS NULL
      GROUP BY c."accountId"
    `,
    prisma.activity.count({
      where: { type: "FOLLOW_UP", doneAt: null, dueAt: { not: null }, deal: { archivedAt: null } },
    }),
    prisma.activity.count({
      where: { type: "FOLLOW_UP", doneAt: null, dueAt: { lt: agora }, deal: { archivedAt: null } },
    }),
    prisma.whatsAppAccount.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, instanceName: true, color: true },
    }),
  ]);

  const soma = (k: "j1" | "j7" | "j15" | "j30") => linhas.reduce((s, l) => s + l[k], 0);
  const porConta = new Map(linhas.map((l) => [l.accountId, l]));

  return {
    janelas: [
      { dias: 1, feitos: soma("j1") },
      { dias: 7, feitos: soma("j7") },
      { dias: 15, feitos: soma("j15") },
      { dias: 30, feitos: soma("j30") },
    ],
    agendados,
    atrasados,
    porVendedor: contas
      .filter((c) => porConta.has(c.id))
      .map((c) => {
        const l = porConta.get(c.id)!;
        return { id: c.id, nome: c.label ?? c.instanceName, cor: c.color, feitos: [l.j1, l.j7, l.j15, l.j30] };
      }),
  };
}
