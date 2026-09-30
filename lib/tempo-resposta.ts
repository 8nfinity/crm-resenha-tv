/**
 * Cálculo do tempo de resposta do vendedor — a parte pura, sem banco.
 *
 * A consulta (em lib/metrics.ts) devolve uma linha por "vez do lead": o
 * momento em que ele mandou mensagem depois de você ter falado por último (ou
 * a primeira mensagem da conversa), e quando veio a sua primeira resposta.
 * Três mensagens seguidas do lead contam como UMA vez: a espera começa na
 * primeira delas, que é quando ele começou a esperar.
 *
 * O número principal é a MEDIANA. Uma resposta dada três dias depois puxaria
 * a média para cima e esconderia que, no dia a dia, você responde em minutos.
 */

export type VezDoLead = {
  accountId: string;
  perguntou: Date;
  /** Primeira mensagem sua depois dele. Nulo: ainda sem resposta. */
  respondeu: Date | null;
  /**
   * Abre a conversa: primeira mensagem do contato, ou volta dele depois de
   * horas de silêncio (ver SILENCIO_QUE_ABRE_CONVERSA_H).
   *
   * A separação existe porque as duas esperas medem coisas diferentes. No
   * meio de um papo, "Sim"/"Beleza" saem em segundos e dominariam a mediana;
   * o número que vende ou perde lead é quanto ele espera quando CHEGA.
   */
  inicio: boolean;
};

/** Silêncio a partir do qual a próxima mensagem do lead abre uma conversa nova. */
export const SILENCIO_QUE_ABRE_CONVERSA_H = 6;

export type ResumoResposta = {
  /** Vezes em que o lead falou e ficou esperando. */
  conversas: number;
  respondidas: number;
  semResposta: number;
  /** Minutos. Nulo quando não houve nenhuma resposta no período. */
  medianaMin: number | null;
  mediaMin: number | null;
  /** 90% das respostas saíram em até este tempo. */
  p90Min: number | null;
  /** Fração das respondidas em até 5 minutos e em até 1 hora. */
  ate5Min: number | null;
  ate1h: number | null;
  /** Há quanto tempo, em minutos, espera o lead mais antigo sem resposta. */
  maiorEsperaMin: number | null;
};

export const FAIXAS = [
  { rotulo: "até 5 min", ateMin: 5 },
  { rotulo: "5–30 min", ateMin: 30 },
  { rotulo: "30 min–2 h", ateMin: 120 },
  { rotulo: "2–8 h", ateMin: 480 },
  { rotulo: "8–24 h", ateMin: 1440 },
  { rotulo: "mais de 24 h", ateMin: Infinity },
] as const;

function percentil(ordenados: number[], p: number): number {
  // Interpolação linear entre as duas posições vizinhas, o mesmo método do
  // percentile_cont do Postgres — assim o número bate se alguém conferir lá.
  const pos = (ordenados.length - 1) * p;
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  return ordenados[baixo] + (ordenados[alto] - ordenados[baixo]) * (pos - baixo);
}

export function minutosDeEspera(v: VezDoLead): number | null {
  if (!v.respondeu) return null;
  return Math.max(0, (v.respondeu.getTime() - v.perguntou.getTime()) / 60_000);
}

export function resumir(vezes: VezDoLead[], agora = new Date()): ResumoResposta {
  const tempos = vezes
    .map(minutosDeEspera)
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);

  const pendentes = vezes.filter((v) => !v.respondeu);
  const maisAntiga = pendentes.reduce<Date | null>(
    (min, v) => (!min || v.perguntou < min ? v.perguntou : min),
    null,
  );

  const n = tempos.length;
  return {
    conversas: vezes.length,
    respondidas: n,
    semResposta: pendentes.length,
    medianaMin: n ? percentil(tempos, 0.5) : null,
    mediaMin: n ? tempos.reduce((s, t) => s + t, 0) / n : null,
    p90Min: n ? percentil(tempos, 0.9) : null,
    ate5Min: n ? tempos.filter((t) => t <= 5).length / n : null,
    ate1h: n ? tempos.filter((t) => t <= 60).length / n : null,
    maiorEsperaMin: maisAntiga ? (agora.getTime() - maisAntiga.getTime()) / 60_000 : null,
  };
}

/** Quantas respostas caíram em cada faixa de tempo. */
export function distribuir(vezes: VezDoLead[]): { rotulo: string; quantidade: number }[] {
  const contagem = FAIXAS.map((f) => ({ rotulo: f.rotulo, quantidade: 0 }));
  for (const v of vezes) {
    const m = minutosDeEspera(v);
    if (m === null) continue;
    const i = FAIXAS.findIndex((f) => m <= f.ateMin);
    contagem[i].quantidade++;
  }
  return contagem;
}

/** "3 min", "1 h 20", "2,5 d" — curto o bastante para caber num card. */
export function formatarMinutos(min: number | null): string {
  if (min === null) return "—";
  if (min < 1) return "< 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const resto = Math.round(min % 60);
    return resto ? `${h} h ${String(resto).padStart(2, "0")}` : `${h} h`;
  }
  return `${(min / 1440).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`;
}
