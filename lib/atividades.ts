/**
 * Utilidades de atividades usadas pelo painel do lead e pelo calendário.
 *
 * Sem banco aqui: roda no navegador. As datas são formatadas no fuso de quem
 * está vendo — um follow-up "às 9h" é 9h no relógio de quem vai ligar.
 */

export const TIPOS_ATIVIDADE = {
  FOLLOW_UP: "Follow-up",
  MEETING: "Reunião",
  CALL: "Ligação",
  PROPOSAL: "Proposta",
  OTHER: "Outro",
} as const;

export type TipoAtividade = keyof typeof TIPOS_ATIVIDADE;

export function rotuloTipo(tipo: string): string {
  return TIPOS_ATIVIDADE[tipo as TipoAtividade] ?? tipo;
}

/** "29/09/2026 às 14:32" */
export function dataHora(iso: string | Date): string {
  const d = new Date(iso);
  const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${data} às ${hora(d)}`;
}

/** "qua., 01/10 às 09:00" — para compromissos, onde o dia da semana ajuda. */
export function diaSemanaHora(iso: string | Date): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  return `${dia} às ${hora(d)}`;
}

/** "09:00" */
export function hora(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Chave do dia no fuso local: "2026-09-29". Serve para agrupar no calendário. */
export function chaveDia(iso: string | Date): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

export type SituacaoAtividade = "feita" | "atrasada" | "hoje" | "agendada" | "sem-data";

export function situacao(
  a: { dueAt: string | null; doneAt: string | null },
  agora = new Date(),
): SituacaoAtividade {
  if (a.doneAt) return "feita";
  if (!a.dueAt) return "sem-data";
  const prazo = new Date(a.dueAt);
  if (prazo < agora) return "atrasada";
  if (chaveDia(prazo) === chaveDia(agora)) return "hoje";
  return "agendada";
}

/** Valor inicial do campo de data: amanhã, 09:00 — o follow-up mais comum. */
export function sugestaoDePrazo(): { data: string; hora: string } {
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  return { data: chaveDia(amanha), hora: "09:00" };
}

/**
 * Junta os campos de data e hora do formulário num instante ISO.
 * `new Date("2026-10-01T09:00")` é interpretado no fuso LOCAL — exatamente o
 * que quem digitou quis dizer.
 */
export function juntarDataHora(data: string, horaStr: string): string | null {
  if (!data) return null;
  const d = new Date(`${data}T${horaStr || "09:00"}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Número de cada follow-up do lead: 1º, 2º, 3º…
 *
 * A ordem é a do momento do follow-up — o prazo; sem prazo, quando foi feito;
 * sem nenhum dos dois, quando foi criado. Assim um follow-up agendado para
 * antes de outro já marcado entra na frente dele, como na vida real.
 * Recebe as atividades de UM lead; as que não são follow-up ficam de fora.
 */
export function numerarFollowUps(
  atividades: {
    id: string;
    type: string;
    dueAt: string | Date | null;
    doneAt: string | Date | null;
    createdAt: string | Date;
  }[],
): Map<string, number> {
  const momento = (a: (typeof atividades)[number]) => new Date(a.dueAt ?? a.doneAt ?? a.createdAt).getTime();
  const ordenados = atividades
    .filter((a) => a.type === "FOLLOW_UP")
    .sort((a, b) => momento(a) - momento(b) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return new Map(ordenados.map((a, i) => [a.id, i + 1]));
}

/** "3º follow-up" */
export function ordinalFollowUp(n: number): string {
  return `${n}º follow-up`;
}

/** Tipo da atividade, com o número quando é follow-up: "2º follow-up", "Reunião". */
export function rotuloTipoNumerado(tipo: string, numero?: number | null): string {
  return tipo === "FOLLOW_UP" && numero ? ordinalFollowUp(numero) : rotuloTipo(tipo);
}

/** Nome da atividade para listas: o título, ou o tipo numerado. */
export function nomeDaAtividade(a: { title: string | null; type: string; numero?: number | null }): string {
  return a.title?.trim() || rotuloTipoNumerado(a.type, a.numero);
}
