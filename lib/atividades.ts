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
