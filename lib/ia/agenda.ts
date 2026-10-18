/**
 * Horários livres para reunião: o horário de atendimento da empresa menos o
 * que já está marcado no calendário do CRM. Puro (sem banco) — testado em
 * tests/ia-agenda.test.ts.
 *
 * Tudo no horário de Brasília. O Brasil não tem horário de verão desde 2019,
 * então Brasília é UTC−3 o ano todo.
 */

const BRASILIA_MIN = -3 * 60;
const MIN = 60_000;
const DIA = 24 * 60 * MIN;

export type RegraAgenda = {
  /** Dias da semana com atendimento: 0 = domingo … 6 = sábado. */
  dias: number[];
  /** Faixas do dia, em minutos desde a meia-noite: 9h–12h = { ini: 540, fim: 720 }. */
  janelas: { ini: number; fim: number }[];
  duracaoMin: number;
  /** Não marca com menos que isso de antecedência. */
  antecedenciaMin: number;
};

export type Intervalo = { inicio: Date; fim: Date };

const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "09:00" → 540. Inválido → null. */
function minutos(hhmm: string): number | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59) return null;
  return h * 60 + mm;
}

/** A regra a partir do que está salvo ("1,2,3,4,5" e "09:00-12:00,14:00-18:00"). */
export function lerRegra(cfg: {
  agendaDias: string;
  agendaJanelas: string;
  duracaoMin: number;
  antecedenciaMin: number;
}): RegraAgenda {
  const dias = [...new Set(cfg.agendaDias.split(",").map((d) => Number(d.trim())))].filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6,
  );
  const janelas = cfg.agendaJanelas
    .split(",")
    .map((j) => {
      const [a, b] = j.split("-");
      const ini = a ? minutos(a) : null;
      const fim = b ? minutos(b) : null;
      return ini !== null && fim !== null && fim > ini ? { ini, fim } : null;
    })
    .filter((j): j is { ini: number; fim: number } => j !== null)
    .sort((x, y) => x.ini - y.ini);
  return {
    dias: dias.sort(),
    janelas,
    duracaoMin: Math.min(Math.max(cfg.duracaoMin, 10), 240),
    antecedenciaMin: Math.max(cfg.antecedenciaMin, 0),
  };
}

/** Ano, mês, dia e dia da semana em Brasília. */
function emBrasilia(d: Date) {
  const b = new Date(d.getTime() + BRASILIA_MIN * MIN);
  return { ano: b.getUTCFullYear(), mes: b.getUTCMonth(), dia: b.getUTCDate(), semana: b.getUTCDay(), min: b.getUTCHours() * 60 + b.getUTCMinutes() };
}

/** O instante de "dia X às N minutos" em Brasília. */
function instante(ano: number, mes: number, dia: number, min: number): Date {
  return new Date(Date.UTC(ano, mes, dia) + (min - BRASILIA_MIN) * MIN);
}

const sobrepoe = (a: Intervalo, b: Intervalo) => a.inicio < b.fim && b.inicio < a.fim;

/**
 * Horários livres a partir do dia de `de` (em Brasília), por `quantosDias`
 * dias. Cada reunião ocupa `duracaoMin`; os horários andam de duração em
 * duração dentro de cada faixa.
 */
export function horariosLivres(
  regra: RegraAgenda,
  p: { agora: Date; de: Date; quantosDias: number; ocupados: Intervalo[] },
): Date[] {
  const minimo = p.agora.getTime() + regra.antecedenciaMin * MIN;
  const base = emBrasilia(p.de);
  const livres: Date[] = [];
  for (let i = 0; i < Math.min(Math.max(p.quantosDias, 1), 31); i++) {
    const d = emBrasilia(instante(base.ano, base.mes, base.dia + i, 12 * 60));
    if (!regra.dias.includes(d.semana)) continue;
    for (const j of regra.janelas) {
      for (let t = j.ini; t + regra.duracaoMin <= j.fim; t += regra.duracaoMin) {
        const inicio = instante(d.ano, d.mes, d.dia, t);
        if (inicio.getTime() < minimo) continue;
        const slot = { inicio, fim: new Date(inicio.getTime() + regra.duracaoMin * MIN) };
        if (p.ocupados.some((o) => sobrepoe(slot, o))) continue;
        livres.push(inicio);
      }
    }
  }
  return livres;
}

/**
 * O horário pedido serve? Dentro do atendimento, com a antecedência mínima e
 * sem bater com nada marcado. Devolve o motivo quando não serve.
 */
export function conferirHorario(
  regra: RegraAgenda,
  p: { agora: Date; inicio: Date; ocupados: Intervalo[] },
): { ok: true } | { ok: false; motivo: string } {
  const b = emBrasilia(p.inicio);
  if (p.inicio.getTime() < p.agora.getTime() + regra.antecedenciaMin * MIN) {
    return { ok: false, motivo: `Precisa de pelo menos ${Math.round(regra.antecedenciaMin / 60)} h de antecedência.` };
  }
  if (!regra.dias.includes(b.semana)) return { ok: false, motivo: `Não há atendimento de ${NOMES_DIA[b.semana]}.` };
  const dentro = regra.janelas.some((j) => b.min >= j.ini && b.min + regra.duracaoMin <= j.fim);
  if (!dentro) return { ok: false, motivo: "Fora do horário de atendimento." };
  const slot = { inicio: p.inicio, fim: new Date(p.inicio.getTime() + regra.duracaoMin * MIN) };
  if (p.ocupados.some((o) => sobrepoe(slot, o))) return { ok: false, motivo: "Esse horário já está ocupado no calendário." };
  return { ok: true };
}

/** "09:00" */
function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** "segunda 20/10" */
function nomeDoDia(d: Date): string {
  const b = emBrasilia(d);
  return `${NOMES_DIA[b.semana]} ${String(b.dia).padStart(2, "0")}/${String(b.mes + 1).padStart(2, "0")}`;
}

/**
 * Os horários para a IA ler, agrupados por dia, com o ISO de cada um (é o
 * que ela manda em agendar_reuniao):
 *   segunda 20/10: 09:00 (2026-10-20T09:00:00-03:00), 09:30 (…)
 */
export function descreverHorarios(livres: Date[], limite = 40): string {
  if (livres.length === 0) return "Nenhum horário livre nesse período.";
  const porDia = new Map<string, string[]>();
  for (const d of livres.slice(0, limite)) {
    const b = emBrasilia(d);
    const iso = `${b.ano}-${String(b.mes + 1).padStart(2, "0")}-${String(b.dia).padStart(2, "0")}T${hhmm(b.min)}:00-03:00`;
    const chave = nomeDoDia(d);
    porDia.set(chave, [...(porDia.get(chave) ?? []), `${hhmm(b.min)} (${iso})`]);
  }
  const linhas = [...porDia].map(([dia, hs]) => `${dia}: ${hs.join(", ")}`);
  if (livres.length > limite) linhas.push(`(e mais ${livres.length - limite} horários depois desses)`);
  return linhas.join("\n");
}

/** A regra em uma frase, para as instruções da IA: "segunda a sexta, 09:00–12:00 e 14:00–18:00; reuniões de 30 min". */
export function descreverRegra(regra: RegraAgenda): string {
  const dias = regra.dias.map((d) => NOMES_DIA[d]).join(", ") || "nenhum dia";
  const janelas = regra.janelas.map((j) => `${hhmm(j.ini)}–${hhmm(j.fim)}`).join(" e ") || "sem horário definido";
  return `Atendimento para reuniões: ${dias}, ${janelas} (horário de Brasília). Cada reunião dura ${regra.duracaoMin} min. Antecedência mínima: ${Math.round(regra.antecedenciaMin / 60)} h.`;
}

/** Início do dia (em Brasília) de uma data "AAAA-MM-DD"; inválida ou vazia → hoje. */
export function inicioDoDia(data: string, agora: Date): Date {
  const m = data.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return instante(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0);
  const b = emBrasilia(agora);
  return instante(b.ano, b.mes, b.dia, 0);
}

export const UM_DIA_MS = DIA;
