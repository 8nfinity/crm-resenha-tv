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

/** Cor de cada tipo fixo — como as "agendas" do Google: bate o olho e sabe o que é. */
export const COR_TIPO: Record<TipoAtividade, string> = {
  FOLLOW_UP: "#46c22d",
  MEETING: "#5eb8ff",
  CALL: "#a78bfa",
  PROPOSAL: "#f2d417",
  OTHER: "#94a3b8",
};

/** Tipo criado por você ("Avaliação", "Retorno"). */
export type TipoProprio = { id: string; name: string; color: string };

/**
 * Uma chave só para os tipos fixos e os seus: "FOLLOW_UP" ou "k:<id>".
 * Na atividade, o tipo próprio fica em `kindId` (com `type` = OTHER).
 */
export function chaveDoTipo(a: { type: string; kindId?: string | null }): string {
  return a.kindId ? `k:${a.kindId}` : a.type;
}

/** O que gravar para uma chave: o tipo fixo, ou OTHER + o tipo próprio. */
export function tipoDaChave(chave: string): { type: TipoAtividade; kindId: string | null } {
  if (chave.startsWith("k:")) return { type: "OTHER", kindId: chave.slice(2) };
  return { type: (chave in TIPOS_ATIVIDADE ? chave : "OTHER") as TipoAtividade, kindId: null };
}

/** Todas as opções na ordem dos botões: os fixos (menos "Outro"), os seus, e "Outro" por último. */
export function opcoesDeTipo(proprios: TipoProprio[]): { chave: string; nome: string; cor: string; proprio: boolean }[] {
  const fixos = (Object.keys(TIPOS_ATIVIDADE) as TipoAtividade[]).map((t) => ({
    chave: t as string,
    nome: TIPOS_ATIVIDADE[t] as string,
    cor: COR_TIPO[t],
    proprio: false,
  }));
  return [
    ...fixos.filter((f) => f.chave !== "OTHER"),
    ...proprios.map((p) => ({ chave: `k:${p.id}`, nome: p.name, cor: p.color, proprio: true })),
    ...fixos.filter((f) => f.chave === "OTHER"),
  ];
}

/** Nome do tipo de uma chave; tipo próprio que foi apagado volta a ser "Outro". */
export function rotuloDaChave(chave: string, proprios: TipoProprio[]): string {
  if (chave.startsWith("k:")) return proprios.find((p) => `k:${p.id}` === chave)?.name ?? TIPOS_ATIVIDADE.OTHER;
  return rotuloTipo(chave);
}

export function corDaChave(chave: string, proprios: TipoProprio[]): string {
  if (chave.startsWith("k:")) return proprios.find((p) => `k:${p.id}` === chave)?.color ?? COR_TIPO.OTHER;
  return COR_TIPO[chave as TipoAtividade] ?? COR_TIPO.OTHER;
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

/**
 * O ícone de atividades no card do lead, como no Pipedrive:
 *   atrasada  vermelho — tem atividade em aberto com o prazo vencido
 *   hoje      verde    — a próxima é hoje (e nada atrasado)
 *   futura    cinza    — a próxima é num outro dia (ou não tem data)
 *   nenhuma   amarelo  — nada marcado para este lead
 *
 * `proxima` é a de prazo mais antigo: se alguma está atrasada, é ela.
 */
export type SinalAtividades = "atrasada" | "hoje" | "futura" | "nenhuma";

export function sinalDoLead(
  proxima: { dueAt: string | null } | null,
  agora = new Date(),
): SinalAtividades {
  if (!proxima) return "nenhuma";
  const s = situacao({ dueAt: proxima.dueAt, doneAt: null }, agora);
  if (s === "atrasada") return "atrasada";
  if (s === "hoje") return "hoje";
  return "futura";
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

/**
 * Tipo da atividade, com o número quando é follow-up: "2º follow-up", "Reunião".
 * `nomeProprio`: o nome do tipo criado por você, quando a atividade tem um.
 */
export function rotuloTipoNumerado(tipo: string, numero?: number | null, nomeProprio?: string | null): string {
  if (nomeProprio) return nomeProprio;
  return tipo === "FOLLOW_UP" && numero ? ordinalFollowUp(numero) : rotuloTipo(tipo);
}

/** Nome da atividade para listas: o título, ou o tipo numerado. */
export function nomeDaAtividade(a: {
  title: string | null;
  type: string;
  numero?: number | null;
  tipoNome?: string | null;
}): string {
  return a.title?.trim() || rotuloTipoNumerado(a.type, a.numero, a.tipoNome);
}
