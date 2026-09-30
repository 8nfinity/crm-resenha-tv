/**
 * Temperatura do lead (0–100).
 *
 * O score é deliberadamente simples e auditável: cada fator devolve seus pontos
 * junto com uma frase em português explicando o porquê. Essas frases vão para o
 * banco (`Deal.scoreFactors`) e chegam ao Claude junto com o número — assim ele
 * responde "o João está em 82 porque respondeu ontem e já está em proposta",
 * em vez de citar um número que ninguém consegue conferir.
 *
 * Nada de caixa-preta aqui. Se um score parecer errado, dá para apontar o fator.
 */

export type ScoreFactor = {
  key: string;
  label: string;
  points: number;
  detail: string;
};

export type ScoreResult = {
  score: number;
  factors: ScoreFactor[];
  summary: string;
};

export type ScoreInput = {
  /** Última mensagem recebida do lead. */
  lastInboundAt: Date | null;
  /** Última mensagem em qualquer direção. */
  lastInteractionAt: Date | null;
  /** Quando o deal entrou no estágio atual. */
  enteredStageAt: Date;
  /** Posição do estágio no funil (0 = primeiro). */
  stageOrder: number;
  /** Quantos estágios existem no total (fora ganho/perdido). */
  totalStages: number;
  /** O estágio atual é de ganho ou perda? Esses não recebem score. */
  isWon: boolean;
  isLost: boolean;
  /** Contagem de mensagens dele e suas. */
  inboundCount: number;
  outboundCount: number;
  /** Tempo médio de resposta dele, em horas. Nulo se nunca respondeu. */
  avgResponseHours: number | null;
  /** Valor da oportunidade, se preenchido. */
  value: number | null;
  /** Referência de "agora" — injetável para os testes. */
  now?: Date;
};

const HOUR = 1000 * 60 * 60;
const DAY = HOUR * 24;

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? `1 ${singular}` : `${n} ${pluralForm}`;
}

/** Descreve uma quantidade de dias do jeito que uma pessoa falaria. */
function humanDays(days: number): string {
  const d = Math.floor(days);
  if (d <= 0) return "hoje";
  if (d === 1) return "ontem";
  return `há ${plural(d, "dia", "dias")}`;
}

export function calculateScore(input: ScoreInput): ScoreResult {
  const now = input.now ?? new Date();
  const factors: ScoreFactor[] = [];

  // Estágios terminais não competem por atenção: o lead já foi ganho ou perdido.
  if (input.isWon || input.isLost) {
    return {
      score: 0,
      factors: [
        {
          key: "terminal",
          label: "Estágio final",
          points: 0,
          detail: input.isWon
            ? "Negócio já ganho — não entra na fila de abordagem."
            : "Negócio já perdido — não entra na fila de abordagem.",
        },
      ],
      summary: input.isWon ? "Ganho" : "Perdido",
    };
  }

  // ── 1. Recência da resposta DELE (0–35) ────────────────────────────────────
  // O sinal mais forte que existe. Quem te respondeu ontem está muito mais
  // quente do que quem sumiu há três semanas, independente de tudo o mais.
  if (input.lastInboundAt) {
    const days = daysBetween(input.lastInboundAt, now);
    let points: number;
    if (days <= 1) points = 35;
    else if (days <= 3) points = 30;
    else if (days <= 7) points = 22;
    else if (days <= 14) points = 14;
    else if (days <= 30) points = 7;
    else points = 2;

    factors.push({
      key: "inbound_recency",
      label: "Última resposta dele",
      points,
      detail: `Respondeu ${humanDays(days)}.`,
    });
  } else {
    factors.push({
      key: "inbound_recency",
      label: "Última resposta dele",
      points: 0,
      detail: "Nunca respondeu — é um contato frio, não um lead engajado.",
    });
  }

  // ── 2. Reciprocidade (0–20) ────────────────────────────────────────────────
  // Conversa de mão dupla vale mais que monólogo. Dez mensagens suas sem
  // resposta é sinal de desinteresse, não de engajamento.
  const total = input.inboundCount + input.outboundCount;
  if (total > 0) {
    const ratio = input.inboundCount / total;
    const points = Math.round(Math.min(ratio / 0.5, 1) * 20);
    factors.push({
      key: "reciprocity",
      label: "Reciprocidade",
      points,
      detail:
        input.inboundCount === 0
          ? `${plural(input.outboundCount, "mensagem sua", "mensagens suas")} sem nenhuma resposta.`
          : `${input.inboundCount} de ${total} mensagens são dele (${Math.round(ratio * 100)}%).`,
    });
  } else {
    factors.push({
      key: "reciprocity",
      label: "Reciprocidade",
      points: 0,
      detail: "Nenhuma conversa registrada.",
    });
  }

  // ── 3. Velocidade de resposta (0–10) ───────────────────────────────────────
  // Quem responde em minutos está prestando atenção em você.
  if (input.avgResponseHours !== null) {
    const h = input.avgResponseHours;
    let points: number;
    if (h <= 1) points = 10;
    else if (h <= 6) points = 8;
    else if (h <= 24) points = 5;
    else if (h <= 72) points = 2;
    else points = 0;

    const tempo =
      h < 1
        ? `${Math.round(h * 60)} min`
        : h < 48
          ? `${Math.round(h)} h`
          : `${Math.round(h / 24)} dias`;

    factors.push({
      key: "response_speed",
      label: "Velocidade de resposta",
      points,
      detail: `Costuma responder em ${tempo}.`,
    });
  }

  // ── 4. Avanço no funil (0–20) ──────────────────────────────────────────────
  // Quem já está em proposta vale mais atenção que quem acabou de entrar.
  const denom = Math.max(input.totalStages - 1, 1);
  const progress = Math.min(input.stageOrder / denom, 1);
  const stagePoints = Math.round(progress * 20);
  factors.push({
    key: "funnel_progress",
    label: "Avanço no funil",
    points: stagePoints,
    detail: `Está no estágio ${input.stageOrder + 1} de ${input.totalStages}.`,
  });

  // ── 5. Dias parado no estágio (−15 a 0) ────────────────────────────────────
  // O único fator negativo. Um lead esquecido não fica quente sozinho, mas
  // também não deve desaparecer da lista: a penalidade tem piso.
  const stagnantDays = daysBetween(input.enteredStageAt, now);
  let stagnationPoints = 0;
  if (stagnantDays > 30) stagnationPoints = -15;
  else if (stagnantDays > 14) stagnationPoints = -10;
  else if (stagnantDays > 7) stagnationPoints = -5;

  if (stagnationPoints < 0) {
    factors.push({
      key: "stagnation",
      label: "Parado no estágio",
      points: stagnationPoints,
      detail: `Sem avançar ${humanDays(stagnantDays)} — está travando.`,
    });
  }

  // ── 6. Valor da oportunidade (0–15) ────────────────────────────────────────
  // Só pontua quando você preencheu o valor. Sem valor, sem palpite.
  if (input.value !== null && input.value > 0) {
    // Escala logarítmica: a diferença entre R$ 1k e R$ 10k importa mais que
    // entre R$ 100k e R$ 110k.
    const points = Math.round(
      Math.min(Math.log10(input.value + 1) / Math.log10(100_000), 1) * 15,
    );
    factors.push({
      key: "deal_value",
      label: "Valor da oportunidade",
      points,
      detail: `Vale ${input.value.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })}.`,
    });
  }

  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, raw));

  return { score, factors, summary: describeScore(score) };
}

export function describeScore(score: number): string {
  if (score >= 70) return "Quente";
  if (score >= 45) return "Morno";
  if (score >= 20) return "Frio";
  return "Gelado";
}

/**
 * Tempo médio, em horas, que o lead leva para responder uma mensagem sua.
 * Considera apenas pares diretos (mensagem sua -> resposta dele). Devolve nulo
 * se ele nunca respondeu a nada.
 */
export function averageResponseHours(
  messages: { fromMe: boolean; timestamp: Date }[],
): number | null {
  const ordered = [...messages].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  const gaps: number[] = [];
  let pendingOutbound: Date | null = null;

  for (const msg of ordered) {
    if (msg.fromMe) {
      // Só a primeira de uma sequência sua conta: se você mandou cinco seguidas,
      // o relógio começa na primeira.
      if (pendingOutbound === null) pendingOutbound = msg.timestamp;
    } else if (pendingOutbound !== null) {
      gaps.push((msg.timestamp.getTime() - pendingOutbound.getTime()) / HOUR);
      pendingOutbound = null;
    }
  }

  if (gaps.length === 0) return null;
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}
