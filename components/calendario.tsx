"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Plus,
  RotateCcw,
  Trash2,
  User,
  X,
} from "lucide-react";
import type { AtividadeCalendario } from "@/lib/calendario";
import {
  chaveDia,
  dataHora,
  hora,
  juntarDataHora,
  rotuloTipo,
  situacao,
  TIPOS_ATIVIDADE,
  type TipoAtividade,
} from "@/lib/atividades";
import { DealPanel } from "@/components/kanban/deal-panel";
import { cn } from "@/lib/utils";

/**
 * Calendário no molde do Google Agenda: barra lateral com "Criar", mini
 * calendário e filtros por tipo; visões Dia, Semana (grade de horas), Mês e
 * Programação. Clicar num horário vazio cria ali; clicar numa atividade abre
 * o cartão de detalhes.
 *
 * Cada TIPO de atividade tem uma cor fixa, como as "agendas" do Google: bate
 * o olho e sabe o que é follow-up e o que é reunião.
 */

export type Visao = "dia" | "semana" | "mes" | "agenda";

const HORA_PX = 48;
/** Atividade não tem duração; na grade ela ocupa um bloco de 1 hora. */
const DURACAO_MIN = 60;

const COR_TIPO: Record<TipoAtividade, string> = {
  FOLLOW_UP: "#2fe38c",
  MEETING: "#5eb8ff",
  CALL: "#a78bfa",
  PROPOSAL: "#f2d417",
  OTHER: "#94a3b8",
};
const corDo = (tipo: string) => COR_TIPO[tipo as TipoAtividade] ?? COR_TIPO.OTHER;

const NOMES_VISAO: Record<Visao, string> = { dia: "Dia", semana: "Semana", mes: "Mês", agenda: "Programação" };
const DIAS_CURTOS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

// ── Datas ────────────────────────────────────────────────────────────────────

const deChave = (k: string) => {
  const [a, m, d] = k.split("-").map(Number);
  return new Date(a, m - 1, d);
};
const somarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Segunda-feira da semana de `d`. */
const inicioSemana = (d: Date) => somarDias(d, -((d.getDay() + 6) % 7));
const instanteDa = (a: AtividadeCalendario) => a.dueAt ?? a.doneAt ?? a.createdAt;
const diaDa = (a: AtividadeCalendario) => chaveDia(instanteDa(a));

function gradeDoMes(ref: Date): Date[] {
  const inicio = inicioSemana(new Date(ref.getFullYear(), ref.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => somarDias(inicio, i));
}

function tituloPeriodo(visao: Visao, ref: Date): string {
  const mesAno = (d: Date) => d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  if (visao === "mes") return mesAno(ref);
  if (visao === "dia") return ref.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (visao === "agenda") return `A partir de ${ref.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}`;
  const ini = inicioSemana(ref);
  const fim = somarDias(ini, 6);
  if (ini.getMonth() === fim.getMonth()) return mesAno(ini);
  const curto = (d: Date) => d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return `${curto(ini)} – ${curto(fim)} de ${fim.getFullYear()}`;
}

function passo(visao: Visao, ref: Date, sentido: 1 | -1): Date {
  if (visao === "mes") return new Date(ref.getFullYear(), ref.getMonth() + sentido, 1);
  if (visao === "semana") return somarDias(ref, 7 * sentido);
  if (visao === "agenda") return somarDias(ref, 14 * sentido);
  return somarDias(ref, sentido);
}

// ── Componente principal ─────────────────────────────────────────────────────

export function Calendario({
  visao,
  dataIso,
  atividades: iniciais,
  atrasadasTotal,
  leads,
}: {
  visao: Visao;
  dataIso: string;
  atividades: AtividadeCalendario[];
  atrasadasTotal: number;
  leads: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const ref = deChave(dataIso);

  const [atividades, setAtividades] = useState(iniciais);
  useEffect(() => setAtividades(iniciais), [iniciais]);

  const [tipos, setTipos] = useState<Set<string>>(new Set(Object.keys(TIPOS_ATIVIDADE)));
  const [mostrarFeitas, setMostrarFeitas] = useState(true);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [criar, setCriar] = useState<{ data: string; hora: string } | null>(null);
  const [leadAberto, setLeadAberto] = useState<string | null>(null);

  // "Agora" só depois de montar: no servidor a hora é outra e o React
  // reclamaria da diferença. Atualiza a cada minuto (a linha vermelha anda).
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  function ir(v: Visao, d: Date) {
    router.push(`/calendario?visao=${v}&data=${chaveDia(d)}`, { scroll: false });
  }

  const visiveis = useMemo(
    () => atividades.filter((a) => tipos.has(a.type) && (mostrarFeitas || !a.doneAt)),
    [atividades, tipos, mostrarFeitas],
  );
  const porDia = useMemo(() => {
    const m = new Map<string, AtividadeCalendario[]>();
    for (const a of visiveis) m.set(diaDa(a), [...(m.get(diaDa(a)) ?? []), a]);
    for (const l of m.values()) l.sort((x, y) => instanteDa(x).localeCompare(instanteDa(y)));
    return m;
  }, [visiveis]);

  async function alternar(a: AtividadeCalendario) {
    const feita = !a.doneAt;
    setAtividades((l) => l.map((x) => (x.id === a.id ? { ...x, doneAt: feita ? new Date().toISOString() : null } : x)));
    const res = await fetch(`/api/activities/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feita }),
    }).catch(() => null);
    if (!res?.ok) setAtividades((l) => l.map((x) => (x.id === a.id ? a : x)));
  }

  async function apagar(a: AtividadeCalendario) {
    setDetalheId(null);
    setAtividades((l) => l.filter((x) => x.id !== a.id));
    const res = await fetch(`/api/activities/${a.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) router.refresh();
  }

  const detalhe = atividades.find((a) => a.id === detalheId) ?? null;
  const hojeChave = agora ? chaveDia(agora) : null;
  const aFazerHoje = hojeChave ? (porDia.get(hojeChave) ?? []).filter((a) => !a.doneAt).length : 0;

  return (
    <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4 pt-4 sm:px-8">
      {/* ── Barra lateral ── */}
      <aside className="scroll-thin hidden w-64 shrink-0 flex-col gap-5 overflow-y-auto lg:flex">
        <button
          onClick={() => setCriar({ data: chaveDia(ref), hora: "09:00" })}
          className="inline-flex w-fit items-center gap-3 rounded-2xl bg-[var(--color-surface)] py-3.5 pl-4 pr-6 text-sm font-semibold shadow-[var(--shadow-card)] backdrop-blur-2xl transition-colors hover:bg-[var(--color-surface-2)]"
        >
          <Plus className="size-6 text-[var(--color-accent)]" strokeWidth={2.5} />
          Criar
        </button>

        <MiniMes ref_={ref} hojeChave={hojeChave} porDia={porDia} onEscolher={(d) => ir(visao === "mes" ? "dia" : visao, d)} />

        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[var(--color-muted)]">Tipos</p>
          <ul className="flex flex-col gap-1">
            {(Object.keys(TIPOS_ATIVIDADE) as TipoAtividade[]).map((t) => (
              <li key={t}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm hover:bg-[var(--color-surface-2)]">
                  <input
                    type="checkbox"
                    checked={tipos.has(t)}
                    onChange={() =>
                      setTipos((s) => {
                        const n = new Set(s);
                        if (n.has(t)) n.delete(t);
                        else n.add(t);
                        return n;
                      })
                    }
                    className="size-4 rounded"
                    style={{ accentColor: COR_TIPO[t] }}
                  />
                  {TIPOS_ATIVIDADE[t]}
                </label>
              </li>
            ))}
            <li className="mt-1 border-t pt-2">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm hover:bg-[var(--color-surface-2)]">
                <input
                  type="checkbox"
                  checked={mostrarFeitas}
                  onChange={() => setMostrarFeitas((v) => !v)}
                  className="size-4 rounded accent-[var(--color-muted)]"
                />
                Mostrar concluídas
              </label>
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] p-3 text-xs">
          <p className="flex justify-between">
            <span className="text-[var(--color-muted)]">A fazer hoje</span>
            <strong className="tabular-nums">{aFazerHoje}</strong>
          </p>
          <p className="mt-1.5 flex justify-between">
            <span className="text-[var(--color-muted)]">Atrasadas</span>
            <strong className={cn("tabular-nums", atrasadasTotal > 0 && "text-[var(--color-hot)]")}>{atrasadasTotal}</strong>
          </p>
        </div>
      </aside>

      {/* ── Área principal ── */}
      <section className="glass relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[28px]">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <button
            onClick={() => ir(visao, agora ?? new Date())}
            className="rounded-full border px-4 py-1.5 text-sm font-semibold hover:bg-[var(--color-surface-2)]"
          >
            Hoje
          </button>
          <button onClick={() => ir(visao, passo(visao, ref, -1))} aria-label="Anterior" className="grid size-8 place-items-center rounded-full hover:bg-[var(--color-surface-2)]">
            <ChevronLeft className="size-5" />
          </button>
          <button onClick={() => ir(visao, passo(visao, ref, 1))} aria-label="Próximo" className="grid size-8 place-items-center rounded-full hover:bg-[var(--color-surface-2)]">
            <ChevronRight className="size-5" />
          </button>
          <h1 className="ml-1 text-lg font-bold first-letter:uppercase sm:text-xl">{tituloPeriodo(visao, ref)}</h1>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setCriar({ data: chaveDia(ref), hora: "09:00" })}
              className="grid size-9 place-items-center rounded-full bg-[var(--color-ink)] text-[var(--color-on-ink)] lg:hidden"
              aria-label="Criar atividade"
            >
              <Plus className="size-5" />
            </button>
            <div className="flex rounded-full border p-0.5">
              {(Object.keys(NOMES_VISAO) as Visao[]).map((v) => (
                <button
                  key={v}
                  onClick={() => ir(v, ref)}
                  className={cn(
                    "rounded-full px-3 py-1 text-sm transition-colors",
                    v === visao ? "bolha font-semibold text-white" : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
                  )}
                >
                  {NOMES_VISAO[v]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {visao === "mes" && (
          <VisaoMes
            ref_={ref}
            hojeChave={hojeChave}
            porDia={porDia}
            onDia={(d) => ir("dia", d)}
            onVazio={(d) => setCriar({ data: chaveDia(d), hora: "09:00" })}
            onAbrir={setDetalheId}
          />
        )}
        {(visao === "semana" || visao === "dia") && (
          <VisaoGrade
            dias={visao === "dia" ? [ref] : Array.from({ length: 7 }, (_, i) => somarDias(inicioSemana(ref), i))}
            agora={agora}
            porDia={porDia}
            onDia={(d) => ir("dia", d)}
            onVazio={(d, h) => setCriar({ data: chaveDia(d), hora: h })}
            onAbrir={setDetalheId}
          />
        )}
        {visao === "agenda" && (
          <VisaoAgenda ref_={ref} hojeChave={hojeChave} porDia={porDia} onAbrir={setDetalheId} onAlternar={(a) => void alternar(a)} />
        )}
      </section>

      {detalhe && (
        <Detalhe
          a={detalhe}
          onFechar={() => setDetalheId(null)}
          onAlternar={() => void alternar(detalhe)}
          onApagar={() => void apagar(detalhe)}
          onAbrirLead={() => {
            setDetalheId(null);
            setLeadAberto(detalhe.deal.id);
          }}
        />
      )}
      {criar && (
        <CriarAtividade
          inicial={criar}
          leads={leads}
          onFechar={() => setCriar(null)}
          onCriado={() => {
            setCriar(null);
            router.refresh();
          }}
        />
      )}
      {leadAberto && <DealPanel dealId={leadAberto} onClose={() => setLeadAberto(null)} />}
    </div>
  );
}

// ── Mini calendário da barra lateral ─────────────────────────────────────────

function MiniMes({
  ref_,
  hojeChave,
  porDia,
  onEscolher,
}: {
  ref_: Date;
  hojeChave: string | null;
  porDia: Map<string, AtividadeCalendario[]>;
  onEscolher: (d: Date) => void;
}) {
  // O mini calendário navega sozinho, sem trocar a visão principal.
  const [mes, setMes] = useState(new Date(ref_.getFullYear(), ref_.getMonth(), 1));
  useEffect(() => setMes(new Date(ref_.getFullYear(), ref_.getMonth(), 1)), [ref_.getFullYear(), ref_.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps
  const selecionado = chaveDia(ref_);

  return (
    <div className="px-1">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold first-letter:uppercase">
          {mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </span>
        <span className="flex">
          <button onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} aria-label="Mês anterior" className="grid size-7 place-items-center rounded-full hover:bg-[var(--color-surface-2)]">
            <ChevronLeft className="size-4" />
          </button>
          <button onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} aria-label="Próximo mês" className="grid size-7 place-items-center rounded-full hover:bg-[var(--color-surface-2)]">
            <ChevronRight className="size-4" />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center">
        {DIAS_CURTOS.map((d) => (
          <span key={d} className="py-1 text-[10px] font-semibold text-[var(--color-muted)]">{d[0]}</span>
        ))}
        {gradeDoMes(mes).map((d) => {
          const k = chaveDia(d);
          const temAlgo = (porDia.get(k)?.length ?? 0) > 0;
          return (
            <button
              key={k}
              onClick={() => onEscolher(d)}
              className={cn(
                "relative mx-auto grid size-7 place-items-center rounded-full text-[11px] tabular-nums transition-colors",
                d.getMonth() !== mes.getMonth() && "text-[var(--color-muted)] opacity-50",
                k === hojeChave
                  ? "bg-[var(--color-ink)] font-bold text-[var(--color-on-ink)]"
                  : k === selecionado
                    ? "bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] font-semibold"
                    : "hover:bg-[var(--color-surface-2)]",
              )}
            >
              {d.getDate()}
              {temAlgo && k !== hojeChave && (
                <span className="absolute bottom-0.5 size-1 rounded-full bg-[var(--color-accent)]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Visão Mês ────────────────────────────────────────────────────────────────

function VisaoMes({
  ref_,
  hojeChave,
  porDia,
  onDia,
  onVazio,
  onAbrir,
}: {
  ref_: Date;
  hojeChave: string | null;
  porDia: Map<string, AtividadeCalendario[]>;
  onDia: (d: Date) => void;
  onVazio: (d: Date) => void;
  onAbrir: (id: string) => void;
}) {
  const grade = gradeDoMes(ref_);
  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="grid grid-cols-7 border-b">
        {DIAS_CURTOS.map((d) => (
          <div key={d} className="py-2 text-center text-[11px] font-semibold text-[var(--color-muted)]">{d}</div>
        ))}
      </div>
      <div className="grid min-h-[36rem] flex-1 grid-cols-7 grid-rows-6">
        {grade.map((d, i) => {
          const k = chaveDia(d);
          const itens = porDia.get(k) ?? [];
          const foraDoMes = d.getMonth() !== ref_.getMonth();
          return (
            <div
              key={k}
              onClick={() => onVazio(d)}
              className={cn(
                "flex min-h-24 min-w-0 cursor-pointer flex-col gap-0.5 border-b border-r p-1 transition-colors hover:bg-[var(--color-surface-2)]/40",
                i % 7 === 6 && "border-r-0",
                foraDoMes && "bg-[var(--color-bg)]/40",
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDia(d);
                }}
                className={cn(
                  // min-w em vez de largura fixa: o dia 1 leva o mês junto ("1 out").
                  "mx-auto grid h-7 min-w-7 place-items-center whitespace-nowrap rounded-full px-1.5 text-xs tabular-nums hover:bg-[var(--color-surface-2)]",
                  foraDoMes && "text-[var(--color-muted)]",
                  k === hojeChave && "bg-[var(--color-ink)] font-bold text-[var(--color-on-ink)] hover:bg-[var(--color-ink)]",
                )}
              >
                {d.getDate() === 1 ? `${d.getDate()} ${d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}` : d.getDate()}
              </button>
              {itens.slice(0, 3).map((a) => (
                <Chip key={a.id} a={a} onAbrir={onAbrir} />
              ))}
              {itens.length > 3 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDia(d);
                  }}
                  className="rounded px-1.5 text-left text-[11px] font-semibold text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
                >
                  +{itens.length - 3} mais
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Evento no mês: ponto colorido + hora + título, como no Google. */
function Chip({ a, onAbrir }: { a: AtividadeCalendario; onAbrir: (id: string) => void }) {
  const s = situacao(a);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onAbrir(a.id);
      }}
      title={`${a.title || rotuloTipo(a.type)} · ${a.deal.nome}`}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] leading-tight hover:bg-[var(--color-surface-2)]",
        a.doneAt && "opacity-55",
      )}
    >
      <span
        className={cn("size-2 shrink-0 rounded-full", s === "atrasada" && "ring-2 ring-[var(--color-hot)]")}
        style={{ backgroundColor: corDo(a.type) }}
      />
      {horarioNaGrade(a) && (
        <span className="shrink-0 tabular-nums text-[var(--color-muted)]">{hora(horarioNaGrade(a)!)}</span>
      )}
      <span className={cn("truncate font-medium", a.doneAt && "line-through")}>{a.title || a.deal.nome}</span>
    </button>
  );
}

// ── Visões Semana e Dia (grade de horas) ─────────────────────────────────────

/**
 * Horário em que a atividade aparece na grade: o marcado ou, para o que foi
 * registrado como "já fiz agora" (sem prazo), a hora em que foi feito.
 */
const horarioNaGrade = (a: AtividadeCalendario) => a.dueAt ?? a.doneAt;

/** Distribui atividades sobrepostas lado a lado, como o Google faz. */
function emColunas(itens: AtividadeCalendario[]) {
  const comHora = itens
    .filter((a) => horarioNaGrade(a))
    .map((a) => {
      const d = new Date(horarioNaGrade(a)!);
      const inicio = d.getHours() * 60 + d.getMinutes();
      return { a, inicio, fim: inicio + DURACAO_MIN, coluna: 0, colunas: 1 };
    })
    .sort((x, y) => x.inicio - y.inicio);

  let grupo: typeof comHora = [];
  let fimGrupo = -1;
  const fechar = () => {
    const n = Math.max(1, ...grupo.map((g) => g.coluna + 1));
    grupo.forEach((g) => (g.colunas = n));
  };
  for (const item of comHora) {
    if (item.inicio >= fimGrupo && grupo.length) {
      fechar();
      grupo = [];
    }
    const ocupadas = new Set(grupo.filter((g) => g.fim > item.inicio).map((g) => g.coluna));
    let c = 0;
    while (ocupadas.has(c)) c++;
    item.coluna = c;
    grupo.push(item);
    fimGrupo = Math.max(fimGrupo, item.fim);
  }
  if (grupo.length) fechar();
  return comHora;
}

function VisaoGrade({
  dias,
  agora,
  porDia,
  onDia,
  onVazio,
  onAbrir,
}: {
  dias: Date[];
  agora: Date | null;
  porDia: Map<string, AtividadeCalendario[]>;
  onDia: (d: Date) => void;
  onVazio: (d: Date, hora: string) => void;
  onAbrir: (id: string) => void;
}) {
  const rolagem = useRef<HTMLDivElement>(null);
  // Abre no horário comercial (7h), como o Google abre perto da hora atual.
  useEffect(() => {
    if (rolagem.current) rolagem.current.scrollTop = HORA_PX * 7;
  }, []);

  const hojeChave = agora ? chaveDia(agora) : null;
  const colunasCss = `3.5rem repeat(${dias.length}, minmax(0, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Cabeçalho dos dias + atividades sem hora ("dia inteiro") */}
      <div className="grid border-b" style={{ gridTemplateColumns: colunasCss }}>
        <div />
        {dias.map((d) => {
          const k = chaveDia(d);
          const semHora = (porDia.get(k) ?? []).filter((a) => !horarioNaGrade(a));
          return (
            <div key={k} className="min-w-0 border-l px-1 pb-2 pt-2 text-center">
              <p className={cn("text-[11px] font-semibold", k === hojeChave ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]")}>
                {DIAS_CURTOS[(d.getDay() + 6) % 7]}
              </p>
              <button
                onClick={() => onDia(d)}
                className={cn(
                  "mx-auto mt-0.5 grid size-10 place-items-center rounded-full text-xl tabular-nums hover:bg-[var(--color-surface-2)]",
                  k === hojeChave && "bg-[var(--color-ink)] font-bold text-[var(--color-on-ink)] hover:bg-[var(--color-ink)]",
                )}
              >
                {d.getDate()}
              </button>
              {semHora.map((a) => (
                <Chip key={a.id} a={a} onAbrir={onAbrir} />
              ))}
            </div>
          );
        })}
      </div>

      <div ref={rolagem} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: colunasCss, height: HORA_PX * 24 }}>
          {/* Régua de horas */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-[var(--color-muted)]"
                style={{ top: h * HORA_PX }}
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>

          {dias.map((d) => {
            const k = chaveDia(d);
            const blocos = emColunas(porDia.get(k) ?? []);
            const linhaAgora = agora && k === hojeChave ? ((agora.getHours() * 60 + agora.getMinutes()) / 60) * HORA_PX : null;
            return (
              <div key={k} className="relative border-l">
                {/* Faixas de hora: clicar cria naquele horário */}
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    onClick={() => onVazio(d, `${String(h).padStart(2, "0")}:00`)}
                    aria-label={`Criar às ${h}h`}
                    className="absolute inset-x-0 border-t border-[var(--color-border)]/60 transition-colors hover:bg-[var(--color-surface-2)]/50"
                    style={{ top: h * HORA_PX, height: HORA_PX }}
                  />
                ))}

                {blocos.map(({ a, inicio, colunas, coluna }) => {
                  const cor = corDo(a.type);
                  const s = situacao(a);
                  return (
                    <button
                      key={a.id}
                      onClick={() => onAbrir(a.id)}
                      className={cn(
                        "absolute overflow-hidden rounded-lg border-l-4 px-1.5 py-1 text-left text-[11px] leading-tight shadow-md transition-[filter] hover:brightness-110",
                        a.doneAt && "opacity-55",
                        s === "atrasada" && "ring-1 ring-[var(--color-hot)]",
                      )}
                      style={{
                        top: (inicio / 60) * HORA_PX + 1,
                        height: (DURACAO_MIN / 60) * HORA_PX - 3,
                        left: `calc(${(coluna / colunas) * 100}% + 2px)`,
                        width: `calc(${100 / colunas}% - 4px)`,
                        borderLeftColor: cor,
                        backgroundColor: `color-mix(in srgb, ${cor} 24%, var(--color-surface))`,
                      }}
                    >
                      <span className={cn("block truncate font-semibold", a.doneAt && "line-through")}>
                        {a.title || rotuloTipo(a.type)}
                      </span>
                      <span className="block truncate text-[var(--color-muted)]">
                        {hora(horarioNaGrade(a)!)} · {a.deal.nome}
                      </span>
                    </button>
                  );
                })}

                {linhaAgora !== null && (
                  <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: linhaAgora }}>
                    <div className="relative h-0.5 bg-[var(--color-hot)]">
                      <span className="absolute -left-1.5 -top-[5px] size-3 rounded-full bg-[var(--color-hot)]" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Visão Programação (lista) ────────────────────────────────────────────────

function VisaoAgenda({
  ref_,
  hojeChave,
  porDia,
  onAbrir,
  onAlternar,
}: {
  ref_: Date;
  hojeChave: string | null;
  porDia: Map<string, AtividadeCalendario[]>;
  onAbrir: (id: string) => void;
  onAlternar: (a: AtividadeCalendario) => void;
}) {
  const inicio = chaveDia(ref_);
  const dias = [...porDia.keys()].filter((k) => k >= inicio).sort();

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-4">
      {dias.length === 0 && (
        <p className="p-8 text-center text-sm text-[var(--color-muted)]">Nada programado a partir desta data.</p>
      )}
      {dias.map((k) => {
        const d = deChave(k);
        return (
          <div key={k} className="flex gap-4 border-b py-3 last:border-0">
            <div className="w-20 shrink-0 pt-1 sm:w-28">
              <span className={cn("text-2xl font-bold tabular-nums", k === hojeChave && "text-[var(--color-accent)]")}>
                {d.getDate()}
              </span>
              <span className="ml-1.5 text-xs uppercase text-[var(--color-muted)]">
                {d.toLocaleDateString("pt-BR", { month: "short", weekday: "short" }).replace(/\./g, "")}
              </span>
            </div>
            <ul className="flex min-w-0 flex-1 flex-col gap-1">
              {(porDia.get(k) ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                  <button
                    onClick={() => onAlternar(a)}
                    aria-label={a.doneAt ? "Reabrir" : "Marcar como feita"}
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-md border",
                      a.doneAt && "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-ink)]",
                    )}
                  >
                    {a.doneAt && <Check className="size-3.5" strokeWidth={3} />}
                  </button>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: corDo(a.type) }} />
                  <span className="w-14 shrink-0 text-sm tabular-nums text-[var(--color-muted)]">
                    {a.dueAt ? hora(a.dueAt) : "—"}
                  </span>
                  <button onClick={() => onAbrir(a.id)} className="min-w-0 flex-1 truncate text-left text-sm">
                    <span className={cn("font-semibold", a.doneAt && "text-[var(--color-muted)] line-through")}>
                      {a.title || rotuloTipo(a.type)}
                    </span>
                    <span className="text-[var(--color-muted)]"> · {a.deal.nome}</span>
                  </button>
                  {situacao(a) === "atrasada" && (
                    <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--color-hot)_18%,transparent)] px-2 text-[10px] font-semibold text-[var(--color-hot)]">
                      Atrasada
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ── Cartão de detalhes ───────────────────────────────────────────────────────

function Modal({ onFechar, children }: { onFechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 p-4 backdrop-blur-sm" onClick={onFechar}>
      <div
        className="glass-forte w-full max-w-md rounded-[28px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function Detalhe({
  a,
  onFechar,
  onAlternar,
  onApagar,
  onAbrirLead,
}: {
  a: AtividadeCalendario;
  onFechar: () => void;
  onAlternar: () => void;
  onApagar: () => void;
  onAbrirLead: () => void;
}) {
  const s = situacao(a);
  return (
    <Modal onFechar={onFechar}>
      <div className="flex justify-end gap-1">
        <button onClick={onApagar} aria-label="Excluir" title="Excluir" className="grid size-8 place-items-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-hot)]">
          <Trash2 className="size-4" />
        </button>
        <button onClick={onFechar} aria-label="Fechar" className="grid size-8 place-items-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex gap-3">
        <span className="mt-1.5 size-3.5 shrink-0 rounded" style={{ backgroundColor: corDo(a.type) }} />
        <div className="min-w-0">
          <h2 className={cn("text-xl font-bold", a.doneAt && "line-through opacity-70")}>{a.title || rotuloTipo(a.type)}</h2>
          <p className="mt-0.5 text-sm text-[var(--color-muted)]">
            {rotuloTipo(a.type)}
            {s === "atrasada" && <span className="font-semibold text-[var(--color-hot)]"> · Atrasada</span>}
            {s === "hoje" && <span className="font-semibold text-[var(--color-yellow)]"> · Hoje</span>}
            {s === "feita" && <span className="font-semibold text-[var(--color-accent)]"> · Feita</span>}
          </p>
        </div>
      </div>

      <dl className="mt-5 space-y-3 text-sm">
        {a.dueAt && (
          <Linha icone={Clock} titulo="Para">
            {new Date(a.dueAt).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })} às {hora(a.dueAt)}
          </Linha>
        )}
        <Linha icone={User} titulo="Lead">
          <button onClick={onAbrirLead} className="inline-flex items-center gap-1.5 font-semibold hover:underline">
            <span className="size-2 rounded-full" style={{ backgroundColor: a.deal.estagioCor }} />
            {a.deal.nome}
            <ExternalLink className="size-3.5 text-[var(--color-muted)]" />
          </button>
          <span className="block text-xs text-[var(--color-muted)]">{a.deal.estagio}</span>
        </Linha>
        {a.doneAt && (
          <Linha icone={Check} titulo="Feita em">
            <span className="text-[var(--color-accent)]">{dataHora(a.doneAt)}</span>
          </Linha>
        )}
        <Linha icone={CalendarDays} titulo="Criada em">
          {dataHora(a.createdAt)}
        </Linha>
      </dl>

      <button
        onClick={onAlternar}
        className={cn(
          "mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold",
          a.doneAt ? "border text-[var(--color-muted)] hover:text-[var(--color-text)]" : "bg-[var(--color-ink)] text-[var(--color-on-ink)]",
        )}
      >
        {a.doneAt ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
        {a.doneAt ? "Reabrir (desfazer conclusão)" : "Marcar como feita agora"}
      </button>
    </Modal>
  );
}

function Linha({ icone: Icone, titulo, children }: { icone: typeof Clock; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icone className="mt-0.5 size-4 shrink-0 text-[var(--color-muted)]" />
      <div className="min-w-0">
        <dt className="sr-only">{titulo}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

// ── Criar atividade ──────────────────────────────────────────────────────────

function CriarAtividade({
  inicial,
  leads,
  onFechar,
  onCriado,
}: {
  inicial: { data: string; hora: string };
  leads: { id: string; nome: string }[];
  onFechar: () => void;
  onCriado: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<TipoAtividade>("FOLLOW_UP");
  const [data, setData] = useState(inicial.data);
  const [horaStr, setHoraStr] = useState(inicial.hora);
  const [busca, setBusca] = useState("");
  const [lead, setLead] = useState<{ id: string; nome: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const termo = busca.trim().toLowerCase();
  const sugestoes = termo ? leads.filter((l) => l.nome.toLowerCase().includes(termo)).slice(0, 6) : [];

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return setErro("Escolha o lead.");
    const dueAt = juntarDataHora(data, horaStr);
    if (!dueAt) return setErro("Escolha a data.");
    setSalvando(true);
    setErro(null);
    const res = await fetch(`/api/deals/${lead.id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: tipo, title: titulo.trim() || undefined, dueAt }),
    }).catch(() => null);
    setSalvando(false);
    if (!res?.ok) return setErro("Não deu para salvar. Tente de novo.");
    onCriado();
  }

  const campo =
    "w-full rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]";

  return (
    <Modal onFechar={onFechar}>
      <form onSubmit={salvar}>
        <div className="flex justify-end">
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid size-8 place-items-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">
            <X className="size-4" />
          </button>
        </div>
        <input
          autoFocus
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Adicionar título (ex.: ligar para confirmar a avaliação)"
          className="w-full border-b-2 border-[var(--color-border)] bg-transparent pb-2 text-lg outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
        />

        <div className="mt-4 flex flex-wrap gap-1.5">
          {(Object.keys(TIPOS_ATIVIDADE) as TipoAtividade[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
                tipo === t ? "font-semibold text-[var(--color-on-ink)]" : "border text-[var(--color-muted)] hover:text-[var(--color-text)]",
              )}
              style={tipo === t ? { backgroundColor: COR_TIPO[t] } : undefined}
            >
              {tipo !== t && <span className="size-2 rounded-full" style={{ backgroundColor: COR_TIPO[t] }} />}
              {TIPOS_ATIVIDADE[t]}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <Clock className="mt-2.5 size-4 shrink-0 text-[var(--color-muted)]" />
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} />
          <input type="time" value={horaStr} onChange={(e) => setHoraStr(e.target.value)} className={cn(campo, "w-28")} />
        </div>

        <div className="mt-3 flex gap-2">
          <User className="mt-2.5 size-4 shrink-0 text-[var(--color-muted)]" />
          {lead ? (
            <div className="flex w-full items-center justify-between rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm">
              <span className="truncate font-semibold">{lead.nome}</span>
              <button type="button" onClick={() => setLead(null)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">
                trocar
              </button>
            </div>
          ) : (
            <div className="relative w-full">
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar lead pelo nome…" className={campo} />
              {sugestoes.length > 0 && (
                <ul className="glass-forte absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-2xl">
                  {sugestoes.map((l) => (
                    <li key={l.id}>
                      <button type="button" onClick={() => setLead(l)} className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-2)]">
                        {l.nome}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {termo && sugestoes.length === 0 && <p className="mt-1 text-xs text-[var(--color-muted)]">Nenhum lead com esse nome.</p>}
            </div>
          )}
        </div>

        {erro && <p className="mt-3 text-xs text-[var(--color-hot)]">{erro}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onFechar} className="rounded-full px-4 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">
            Cancelar
          </button>
          <button disabled={salvando} className="rounded-full bg-[var(--color-ink)] px-6 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50">
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
