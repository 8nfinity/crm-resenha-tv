import { chaveDia } from "@/lib/atividades";

/**
 * Filtros da vista Lista do calendário, no molde do Pipedrive. Puros (sem
 * banco, sem tela): rodam no navegador e nos testes.
 *
 * Os períodos olham o PRAZO da atividade; "Concluídas" olha quando foi feita.
 */

export type Periodo =
  | "para-fazer"
  | "vencido"
  | "hoje"
  | "amanha"
  | "esta-semana"
  | "proxima-semana"
  | "concluidas"
  | "periodo";

export const PERIODOS_LISTA: { valor: Periodo; rotulo: string }[] = [
  { valor: "para-fazer", rotulo: "Para fazer" },
  { valor: "vencido", rotulo: "Vencido" },
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "amanha", rotulo: "Amanhã" },
  { valor: "esta-semana", rotulo: "Esta semana" },
  { valor: "proxima-semana", rotulo: "Próxima semana" },
  { valor: "concluidas", rotulo: "Concluídas" },
  { valor: "periodo", rotulo: "Período…" },
];

export type FiltrosLista = {
  periodo: Periodo;
  /** Intervalo do "Período…", em "AAAA-MM-DD" (inclusive). */
  de: string;
  ate: string;
  /** Tipos escolhidos ("FOLLOW_UP", "k:<id>"). Vazio: todos. */
  tipos: string[];
  /** Id do usuário que marcou; "" todos; "-" sem responsável. */
  responsavel: string;
  /** Id do funil do lead; "" todos. */
  funil: string;
  busca: string;
};

export const FILTROS_LISTA_PADRAO: FiltrosLista = {
  periodo: "para-fazer",
  de: "",
  ate: "",
  tipos: [],
  responsavel: "",
  funil: "",
  busca: "",
};

/** O mínimo de uma atividade que os filtros precisam. */
export type ItemDaLista = {
  tipo: string;
  title: string | null;
  dueAt: string | null;
  doneAt: string | null;
  deal: { nome: string; telefone: string | null; funilId: string };
  responsavel: { id: string } | null;
};

const somarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Segunda-feira da semana de `d`, à meia-noite. */
const segunda = (d: Date) => somarDias(d, -((d.getDay() + 6) % 7));

function noPeriodo(a: ItemDaLista, f: FiltrosLista, agora: Date): boolean {
  if (f.periodo === "concluidas") return a.doneAt !== null;
  if (f.periodo === "periodo") {
    const instante = a.dueAt ?? a.doneAt;
    if (!instante) return false;
    const dia = chaveDia(instante);
    return (!f.de || dia >= f.de) && (!f.ate || dia <= f.ate);
  }

  // Os demais são do que ainda está por fazer.
  if (a.doneAt) return false;
  if (f.periodo === "para-fazer") return true;
  if (!a.dueAt) return false;

  const prazo = new Date(a.dueAt);
  const dia = chaveDia(prazo);
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

  switch (f.periodo) {
    case "vencido":
      return prazo < agora;
    case "hoje":
      return dia === chaveDia(hoje);
    case "amanha":
      return dia === chaveDia(somarDias(hoje, 1));
    case "esta-semana": {
      const ini = segunda(hoje);
      return prazo >= ini && prazo < somarDias(ini, 7);
    }
    case "proxima-semana": {
      const ini = somarDias(segunda(hoje), 7);
      return prazo >= ini && prazo < somarDias(ini, 7);
    }
  }
  return true;
}

export function filtrarLista<T extends ItemDaLista>(itens: T[], f: FiltrosLista, agora: Date): T[] {
  const termo = f.busca.trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");

  const filtrados = itens.filter((a) => {
    if (!noPeriodo(a, f, agora)) return false;
    if (f.tipos.length > 0 && !f.tipos.includes(a.tipo)) return false;
    if (f.responsavel === "-" ? a.responsavel !== null : f.responsavel && a.responsavel?.id !== f.responsavel) {
      return false;
    }
    if (f.funil && a.deal.funilId !== f.funil) return false;
    if (termo) {
      const texto = `${a.title ?? ""} ${a.deal.nome}`.toLowerCase();
      const fone = digitos.length >= 3 && (a.deal.telefone ?? "").replace(/\D/g, "").includes(digitos);
      if (!texto.includes(termo) && !fone) return false;
    }
    return true;
  });

  // Concluídas: a mais recente primeiro. O resto: pelo prazo, a mais antiga
  // (a mais atrasada) no topo e as sem data no fim — a ordem do que fazer.
  return filtrados.sort((x, y) => {
    if (f.periodo === "concluidas") return (y.doneAt ?? "").localeCompare(x.doneAt ?? "");
    if (!x.dueAt || !y.dueAt) return x.dueAt ? -1 : y.dueAt ? 1 : 0;
    return x.dueAt.localeCompare(y.dueAt);
  });
}

/** Quantos filtros além do período estão ligados (para o "Limpar"). */
export function filtrosExtrasAtivos(f: FiltrosLista): number {
  return (f.tipos.length > 0 ? 1 : 0) + (f.responsavel ? 1 : 0) + (f.funil ? 1 : 0) + (f.busca.trim() ? 1 : 0);
}
