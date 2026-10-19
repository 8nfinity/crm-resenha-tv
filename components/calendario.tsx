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
  List,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
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
  nomeDaAtividade,
  ordinalFollowUp,
  situacao,
  COR_TIPO,
  corDaChave,
  opcoesDeTipo,
  tipoDaChave,
  type TipoAtividade,
} from "@/lib/atividades";
import { SeletorDeTipo, useTiposProprios } from "@/components/tipos-atividade";
import { DealPanel } from "@/components/kanban/deal-panel";
import { EditarAtividade } from "@/components/editar-atividade";
import {
  FILTROS_LISTA_PADRAO,
  PERIODOS_LISTA,
  filtrarLeadsSemAtividade,
  filtrarLista,
  filtrosExtrasAtivos,
  type FiltrosLista,
  type LeadSemAtividade,
} from "@/lib/lista-atividades";
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

/** "lista" é a tabela de atividades; as outras, o calendário. */
export type Visao = "lista" | "dia" | "semana" | "mes" | "agenda";
type VisaoCalendario = Exclude<Visao, "lista">;

/** Onde os filtros e a última vista do calendário ficam guardados (só neste navegador). */
const GUARDA_FILTROS = "crm_calendario_filtros";
const GUARDA_VISAO = "crm_calendario_visao";

function lerGuardado<T>(chave: string, padrao: T): T {
  try {
    const bruto = window.localStorage.getItem(chave);
    return bruto ? { ...padrao, ...JSON.parse(bruto) } : padrao;
  } catch {
    return padrao;
  }
}
function guardar(chave: string, valor: unknown) {
  try {
    window.localStorage.setItem(chave, typeof valor === "string" ? valor : JSON.stringify(valor));
  } catch {
    // Navegador sem armazenamento (aba anônima): os filtros só não ficam lembrados.
  }
}

const HORA_PX = 48;
/** Atividade não tem duração; na grade ela ocupa um bloco de 1 hora. */
const DURACAO_MIN = 60;

/** Tipo para gravar, sem mandar kindId vazio nos tipos fixos. */
const semNulo = (t: { type: string; kindId: string | null }) => (t.kindId ? t : { type: t.type });

/** Cor da atividade: a do tipo criado por você, ou a fixa do tipo. */
const corDo = (a: { type: string; tipoCor?: string | null }) => a.tipoCor ?? COR_TIPO[a.type as TipoAtividade] ?? COR_TIPO.OTHER;

const NOMES_VISAO: Record<VisaoCalendario, string> = { dia: "Dia", semana: "Semana", mes: "Mês", agenda: "Programação" };
const DIAS_CURTOS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

// ── Datas ────────────────────────────────────────────────────────────────────

const deChave = (k: string) => {
  const [a, m, d] = k.split("-").map(Number);
  return new Date(a, m - 1, d);
};
const somarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Segunda-feira da semana de `d`. */
const inicioSemana = (d: Date) => somarDias(d, -((d.getDay() + 6) % 7));
/** Título curto na grade: o número do follow-up vem na frente ("2º · Ligar"). */
function tituloNaAgenda(a: AtividadeCalendario): string {
  if (a.numero && a.title?.trim()) return `${a.numero}º · ${a.title.trim()}`;
  return nomeDaAtividade(a);
}

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
  responsaveis,
  funis,
  leadsSemAtividade,
}: {
  visao: Visao;
  dataIso: string;
  atividades: AtividadeCalendario[];
  atrasadasTotal: number;
  leads: { id: string; nome: string }[];
  responsaveis: { id: string; nome: string }[];
  funis: { id: string; nome: string }[];
  /** Só na Lista: os leads sem nada marcado (o ⚠️ do funil). */
  leadsSemAtividade: LeadSemAtividade[];
}) {
  const router = useRouter();
  const ref = deChave(dataIso);

  const [atividades, setAtividades] = useState(iniciais);
  useEffect(() => setAtividades(iniciais), [iniciais]);

  const { proprios } = useTiposProprios();
  const [mostrarFeitas, setMostrarFeitas] = useState(true);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  // `lead`: já escolhido (o "Agendar" de um lead sem atividade).
  const [criar, setCriar] = useState<{ data: string; hora: string; lead?: { id: string; nome: string } } | null>(null);
  const [leadAberto, setLeadAberto] = useState<string | null>(null);

  // "Agora" só depois de montar: no servidor a hora é outra e o React
  // reclamaria da diferença. Atualiza a cada minuto (a linha vermelha anda).
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Filtros da Lista — tipo, responsável e funil valem no calendário também.
  // Guardados neste navegador; lidos só depois de montar, para o desenho do
  // servidor e o da tela baterem.
  const [filtros, setFiltrosEstado] = useState<FiltrosLista>(FILTROS_LISTA_PADRAO);
  const [ultimaVisaoCal, setUltimaVisaoCal] = useState<VisaoCalendario>("semana");
  useEffect(() => {
    setFiltrosEstado(lerGuardado(GUARDA_FILTROS, FILTROS_LISTA_PADRAO));
    try {
      const v = window.localStorage.getItem(GUARDA_VISAO) as VisaoCalendario | null;
      if (v && v in NOMES_VISAO) setUltimaVisaoCal(v);
    } catch {}
  }, []);
  const setFiltros = (f: FiltrosLista) => {
    setFiltrosEstado(f);
    guardar(GUARDA_FILTROS, f);
  };

  function ir(v: Visao, d: Date) {
    if (v !== "lista") {
      setUltimaVisaoCal(v);
      guardar(GUARDA_VISAO, v);
    }
    router.push(`/calendario?visao=${v}&data=${chaveDia(d)}`, { scroll: false });
  }

  const visiveis = useMemo(
    () =>
      atividades.filter(
        (a) =>
          (filtros.tipos.length === 0 || filtros.tipos.includes(a.tipo)) &&
          (mostrarFeitas || !a.doneAt) &&
          (filtros.responsavel === "-" ? a.responsavel === null : !filtros.responsavel || a.responsavel?.id === filtros.responsavel) &&
          (!filtros.funil || a.deal.funilId === filtros.funil),
      ),
    [atividades, mostrarFeitas, filtros.tipos, filtros.responsavel, filtros.funil],
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
      {/* ── Barra lateral (só no calendário; a lista tem a própria barra de filtros) ── */}
      <aside className={cn("scroll-thin hidden w-64 shrink-0 flex-col gap-5 overflow-y-auto", visao !== "lista" && "lg:flex")}>
        <button
          onClick={() => setCriar({ data: chaveDia(ref), hora: "09:00" })}
          className="inline-flex w-fit items-center gap-3 rounded-md bg-[var(--color-surface)] py-3.5 pl-4 pr-6 text-sm font-semibold shadow-[var(--shadow-card)] backdrop-blur-2xl transition-colors hover:bg-[var(--color-surface-2)]"
        >
          <Plus className="size-6 text-[var(--color-accent)]" strokeWidth={2.5} />
          Criar
        </button>

        <MiniMes ref_={ref} hojeChave={hojeChave} porDia={porDia} onEscolher={(d) => ir(visao === "mes" ? "dia" : visao, d)} />

        <div className="rounded-md border border-[var(--color-border)] p-3 text-xs">
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
      <section className="glass relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg">
        {visao === "lista" ? (
          <VisaoLista
            atividades={atividades}
            agora={agora}
            filtros={filtros}
            onFiltros={setFiltros}
            responsaveis={responsaveis}
            funis={funis}
            proprios={proprios}
            alternador={<AlternarModo lista onCalendario={() => ir(ultimaVisaoCal, ref)} onLista={() => {}} />}
            leadsSemAtividade={leadsSemAtividade}
            onAgendar={(lead) => setCriar({ data: chaveDia(agora ?? ref), hora: "09:00", lead })}
            onCriar={() => setCriar({ data: chaveDia(agora ?? ref), hora: "09:00" })}
            onAbrir={setDetalheId}
            onAbrirLead={setLeadAberto}
            onAlternar={(a) => void alternar(a)}
          />
        ) : (
        <>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <AlternarModo lista={false} onLista={() => ir("lista", ref)} onCalendario={() => {}} />
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
              {(Object.keys(NOMES_VISAO) as VisaoCalendario[]).map((v) => (
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

        {/* Filtros do calendário: os mesmos da Lista, em qualquer tamanho de tela. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
          <BarraDeTipos tipos={opcoesDeTipo(proprios)} escolhidos={filtros.tipos} onChange={(tipos) => setFiltros({ ...filtros, tipos })} />
          <div className="no-scrollbar flex max-w-full items-center gap-2 overflow-x-auto sm:flex-wrap lg:ml-auto [&>*]:shrink-0">
            <FiltrosDePessoaEFunil filtros={filtros} onChange={setFiltros} responsaveis={responsaveis} funis={funis} />
            <label className="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm text-[var(--color-muted)]">
              <input
                type="checkbox"
                checked={mostrarFeitas}
                onChange={() => setMostrarFeitas((v) => !v)}
                className="size-4 rounded accent-[var(--color-accent)]"
              />
              Concluídas
            </label>
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
        </>
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
          onEditado={() => {
            setDetalheId(null);
            router.refresh();
          }}
        />
      )}
      {criar && (
        <CriarAtividade
          inicial={criar}
          leadInicial={criar.lead ?? null}
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

// ── Quantas atividades no dia ────────────────────────────────────────────────

/**
 * Quantas atividades o dia tem, no cabeçalho de cada dia. Vermelho se alguma
 * em aberto já venceu; apagado quando todas estão feitas. Conta o que os
 * filtros deixam na tela.
 */
function ContagemDoDia({
  itens,
  compacta = false,
  className,
}: {
  itens: AtividadeCalendario[];
  /** No mês, só o número (o espaço é pequeno). */
  compacta?: boolean;
  className?: string;
}) {
  if (itens.length === 0) return null;
  const abertas = itens.filter((a) => !a.doneAt).length;
  const feitas = itens.length - abertas;
  const atrasada = itens.some((a) => situacao(a) === "atrasada");
  const nome = itens.length === 1 ? "atividade" : "atividades";
  const titulo = [
    `${itens.length} ${nome}`,
    feitas > 0 ? `${feitas} ${feitas === 1 ? "feita" : "feitas"}` : null,
    atrasada ? "tem atrasada" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={titulo}
      className={cn(
        "inline-flex w-fit items-center justify-center rounded px-1.5 text-[10px] font-bold tabular-nums leading-4",
        atrasada
          ? "bg-[var(--color-hot)] text-white"
          : abertas === 0
            ? "bg-[var(--color-surface-2)] text-[var(--color-muted)] line-through"
            : "bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] text-[var(--color-text)]",
        className,
      )}
    >
      {compacta ? itens.length : `${itens.length} ${nome}`}
    </span>
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
              <div className="relative flex items-center justify-center">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDia(d);
                }}
                className={cn(
                  // min-w em vez de largura fixa: o dia 1 leva o mês junto ("1 out").
                  "grid h-7 min-w-7 place-items-center whitespace-nowrap rounded-full px-1.5 text-xs tabular-nums hover:bg-[var(--color-surface-2)]",
                  foraDoMes && "text-[var(--color-muted)]",
                  k === hojeChave && "bg-[var(--color-ink)] font-bold text-[var(--color-on-ink)] hover:bg-[var(--color-ink)]",
                )}
              >
                {d.getDate() === 1 ? `${d.getDate()} ${d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}` : d.getDate()}
              </button>
                <ContagemDoDia itens={itens} compacta className="absolute right-0" />
              </div>
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
      title={`${tituloNaAgenda(a)} · ${a.deal.nome}`}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] leading-tight hover:bg-[var(--color-surface-2)]",
        a.doneAt && "opacity-55",
      )}
    >
      <span
        className={cn("size-2 shrink-0 rounded-full", s === "atrasada" && "ring-2 ring-[var(--color-hot)]")}
        style={{ backgroundColor: corDo(a) }}
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
              <ContagemDoDia itens={porDia.get(k) ?? []} className="mx-auto mt-1" />
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
                  const cor = corDo(a);
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
                        {tituloNaAgenda(a)}
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
              <ContagemDoDia itens={porDia.get(k) ?? []} className="mt-1" />
            </div>
            <ul className="flex min-w-0 flex-1 flex-col gap-1">
              {(porDia.get(k) ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
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
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: corDo(a) }} />
                  <span className="w-14 shrink-0 text-sm tabular-nums text-[var(--color-muted)]">
                    {a.dueAt ? hora(a.dueAt) : "—"}
                  </span>
                  <button onClick={() => onAbrir(a.id)} className="min-w-0 flex-1 truncate text-left text-sm">
                    <span className={cn("font-semibold", a.doneAt && "text-[var(--color-muted)] line-through")}>
                      {tituloNaAgenda(a)}
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

// ── Lista ↔ Calendário ───────────────────────────────────────────────────────

/** Os dois botões do topo, como no Pipedrive: a lista e o calendário. */
function AlternarModo({ lista, onLista, onCalendario }: { lista: boolean; onLista: () => void; onCalendario: () => void }) {
  const botao = (ativo: boolean) =>
    cn(
      "grid h-8 w-10 place-items-center rounded-full transition-colors",
      ativo ? "bolha text-white" : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
    );
  return (
    <div className="flex shrink-0 rounded-full border p-0.5" role="group" aria-label="Modo de exibição">
      <button onClick={onLista} className={botao(lista)} aria-pressed={lista} title="Lista">
        <List className="size-4" />
      </button>
      <button onClick={onCalendario} className={botao(!lista)} aria-pressed={!lista} title="Calendário">
        <CalendarDays className="size-4" />
      </button>
    </div>
  );
}

/**
 * Os tipos como botões coloridos, no molde do Pipedrive: "Tudo" ou um ou mais
 * tipos escolhidos. Os mesmos na Lista e no calendário.
 */
function BarraDeTipos({
  tipos,
  escolhidos,
  onChange,
}: {
  tipos: { chave: string; nome: string; cor: string }[];
  escolhidos: string[];
  onChange: (tipos: string[]) => void;
}) {
  const alternar = (chave: string) =>
    onChange(escolhidos.includes(chave) ? escolhidos.filter((t) => t !== chave) : [...escolhidos, chave]);
  return (
    <div className="no-scrollbar flex max-w-full items-center gap-1.5 overflow-x-auto sm:flex-wrap [&>*]:shrink-0 [&>*]:whitespace-nowrap">
      <button
        onClick={() => onChange([])}
        className={cn(
          "rounded-full px-3 py-1 text-xs font-semibold",
          escolhidos.length === 0 ? "bolha text-white" : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
        )}
      >
        Tudo
      </button>
      {tipos.map((o) => {
        const ativo = escolhidos.includes(o.chave);
        return (
          <button
            key={o.chave}
            onClick={() => alternar(o.chave)}
            aria-pressed={ativo}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors"
            style={
              ativo
                ? { borderColor: o.cor, backgroundColor: `color-mix(in srgb, ${o.cor} 22%, transparent)`, color: "var(--color-text)" }
                : { color: "var(--color-muted)" }
            }
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: o.cor }} />
            {o.nome}
          </button>
        );
      })}
    </div>
  );
}

/** Responsável e funil: valem na lista e no calendário. */
function FiltrosDePessoaEFunil({
  filtros,
  onChange,
  responsaveis,
  funis,
  comResponsavel = true,
}: {
  filtros: FiltrosLista;
  onChange: (f: FiltrosLista) => void;
  responsaveis: { id: string; nome: string }[];
  funis: { id: string; nome: string }[];
  /** Na lista de leads sem atividade não há de quem filtrar. */
  comResponsavel?: boolean;
}) {
  const estilo = (ativo: boolean) =>
    cn(
      "rounded-full px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]",
      ativo ? "bolha font-semibold text-white" : "border bg-transparent text-[var(--color-muted)]",
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {comResponsavel && (
      <select
        value={filtros.responsavel}
        onChange={(e) => onChange({ ...filtros, responsavel: e.target.value })}
        aria-label="Responsável"
        className={estilo(Boolean(filtros.responsavel))}
      >
        <option value="">Todos os responsáveis</option>
        {responsaveis.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nome}
          </option>
        ))}
        <option value="-">Sem responsável</option>
      </select>
      )}
      {funis.length > 1 && (
        <select
          value={filtros.funil}
          onChange={(e) => onChange({ ...filtros, funil: e.target.value })}
          aria-label="Funil"
          className={estilo(Boolean(filtros.funil))}
        >
          <option value="">Todos os funis</option>
          {funis.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Visão Lista (tabela) ─────────────────────────────────────────────────────

/** "Hoje, 14:00" · "Amanhã, 09:00" · "qua., 22/10 às 09:00" */
function prazoCurto(iso: string, agora: Date | null): string {
  const ref = agora ?? new Date();
  const dia = chaveDia(iso);
  const amanha = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 1);
  const ontem = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1);
  if (dia === chaveDia(ref)) return `Hoje, ${hora(iso)}`;
  if (dia === chaveDia(amanha)) return `Amanhã, ${hora(iso)}`;
  if (dia === chaveDia(ontem)) return `Ontem, ${hora(iso)}`;
  const d = new Date(iso);
  const data = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", ...(d.getFullYear() !== ref.getFullYear() ? { year: "2-digit" } : {}) });
  return `${data} às ${hora(iso)}`;
}

function VisaoLista({
  atividades,
  agora,
  filtros,
  onFiltros,
  responsaveis,
  funis,
  proprios,
  alternador,
  leadsSemAtividade,
  onAgendar,
  onCriar,
  onAbrir,
  onAbrirLead,
  onAlternar,
}: {
  leadsSemAtividade: LeadSemAtividade[];
  onAgendar: (lead: { id: string; nome: string }) => void;
  atividades: AtividadeCalendario[];
  agora: Date | null;
  filtros: FiltrosLista;
  onFiltros: (f: FiltrosLista) => void;
  responsaveis: { id: string; nome: string }[];
  funis: { id: string; nome: string }[];
  proprios: ReturnType<typeof useTiposProprios>["proprios"];
  alternador: React.ReactNode;
  onCriar: () => void;
  onAbrir: (id: string) => void;
  onAbrirLead: (dealId: string) => void;
  onAlternar: (a: AtividadeCalendario) => void;
}) {
  // Até montar, sem relógio: a lista espera um instante em vez de desenhar
  // "hoje" pelo fuso do servidor.
  const linhas = useMemo(
    () => (agora ? filtrarLista(atividades, filtros, agora) : []),
    [atividades, filtros, agora],
  );
  const set = (p: Partial<FiltrosLista>) => onFiltros({ ...filtros, ...p });
  const extras = filtrosExtrasAtivos(filtros);
  // "⚠️ Sem atividade" troca a tabela: em vez de atividades, os leads sem nada marcado.
  const semAtividade = filtros.periodo === "sem-atividade";
  // O número de cada botão de período, com os demais filtros valendo.
  const contagens = useMemo(() => {
    const c: Partial<Record<FiltrosLista["periodo"], number>> = {};
    if (!agora) return c;
    for (const p of PERIODOS_LISTA) {
      c[p.valor] =
        p.valor === "sem-atividade"
          ? filtrarLeadsSemAtividade(leadsSemAtividade, filtros).length
          : filtrarLista(atividades, { ...filtros, periodo: p.valor }, agora).length;
    }
    return c;
  }, [atividades, leadsSemAtividade, filtros, agora]);
  const leads = useMemo(
    () => (semAtividade ? filtrarLeadsSemAtividade(leadsSemAtividade, filtros) : []),
    [semAtividade, leadsSemAtividade, filtros],
  );
  const variosFunis = funis.length > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Linha 1: modo, título, criar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        {alternador}
        <h1 className="ml-1 text-lg font-bold sm:text-xl">{semAtividade ? "Leads sem atividade" : "Atividades"}</h1>
        <span className="text-sm tabular-nums text-[var(--color-muted)]">{semAtividade ? leads.length : agora ? linhas.length : "…"}</span>
        <button
          onClick={onCriar}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink)] px-4 py-1.5 text-sm font-semibold text-[var(--color-on-ink)]"
        >
          <Plus className="size-4" strokeWidth={2.5} /> Atividade
        </button>
      </div>

      {/* Linha 2: tipos (como os botões do Pipedrive) e período */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        {!semAtividade && (
          <BarraDeTipos tipos={opcoesDeTipo(proprios)} escolhidos={filtros.tipos} onChange={(tipos) => set({ tipos })} />
        )}

        <div className="flex flex-wrap items-center gap-1 lg:ml-auto">
          {PERIODOS_LISTA.map((p) => (
            <button
              key={p.valor}
              onClick={() => set({ periodo: p.valor })}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                filtros.periodo === p.valor ? "bolha text-white" : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
              )}
            >
              {p.rotulo}
              {/* Quantas há em cada período, com os outros filtros aplicados
                  ("Hoje 3"). "Período…" depende das datas, fica sem número. */}
              {agora && p.valor !== "periodo" && (
                <span
                  className={cn(
                    "ml-1.5 rounded px-1 tabular-nums",
                    p.valor === "vencido" && (contagens[p.valor] ?? 0) > 0
                      ? "bg-[var(--color-hot)] text-white"
                      : "bg-[var(--color-surface-2)]",
                  )}
                >
                  {contagens[p.valor] ?? 0}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Linha 3: período escolhido, busca, responsável, funil */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        {filtros.periodo === "periodo" && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
            de
            <input type="date" value={filtros.de} onChange={(e) => set({ de: e.target.value })} className="rounded-full border bg-transparent px-2.5 py-1 text-sm text-[var(--color-text)]" />
            até
            <input type="date" value={filtros.ate} onChange={(e) => set({ ate: e.target.value })} className="rounded-full border bg-transparent px-2.5 py-1 text-sm text-[var(--color-text)]" />
          </span>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            value={filtros.busca}
            onChange={(e) => set({ busca: e.target.value })}
            placeholder={semAtividade ? "Buscar lead ou telefone…" : "Buscar assunto, lead ou telefone…"}
            className="w-full sm:w-64 rounded-full border bg-transparent py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]"
          />
        </div>
        <FiltrosDePessoaEFunil
          filtros={filtros}
          onChange={onFiltros}
          responsaveis={responsaveis}
          funis={funis}
          comResponsavel={!semAtividade}
        />
        {extras > 0 && (
          <button
            onClick={() => onFiltros({ ...filtros, tipos: [], responsavel: "", funil: "", busca: "" })}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <X className="size-3.5" /> Limpar filtros
          </button>
        )}
      </div>

      {semAtividade ? (
        <TabelaSemAtividade leads={leads} variosFunis={variosFunis} agora={agora} onAbrirLead={onAbrirLead} onAgendar={onAgendar} />
      ) : (
      /* Tabela */
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-solido)]">
            <tr className="text-left text-xs font-semibold text-[var(--color-muted)]">
              <th className="w-24 px-4 py-2.5">Concluído</th>
              <th className="px-3 py-2.5">Assunto</th>
              <th className="px-3 py-2.5">Lead</th>
              <th className="px-3 py-2.5">Prazo</th>
              <th className="px-3 py-2.5">Responsável</th>
              <th className="px-3 py-2.5">Telefone</th>
              {variosFunis && <th className="px-3 py-2.5">Funil</th>}
            </tr>
          </thead>
          <tbody>
            {agora && linhas.length === 0 && (
              <tr>
                <td colSpan={variosFunis ? 7 : 6} className="px-4 py-12 text-center text-sm text-[var(--color-muted)]">
                  Nenhuma atividade com esses filtros.
                </td>
              </tr>
            )}
            {linhas.map((a) => {
              const s = situacao(a, agora ?? undefined);
              const atrasada = s === "atrasada";
              return (
                <tr key={a.id} className="border-t transition-colors hover:bg-[var(--color-surface-2)]">
                  <td className="px-4 py-2">
                    <button
                      onClick={() => onAlternar(a)}
                      aria-label={a.doneAt ? "Reabrir" : "Marcar como feita"}
                      title={a.doneAt ? "Reabrir" : "Marcar como feita"}
                      className={cn(
                        "grid size-5 place-items-center rounded-full border-2 transition-colors",
                        a.doneAt
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-ink)]"
                          : "border-[var(--color-muted)]/60 hover:border-[var(--color-accent)]",
                      )}
                    >
                      {a.doneAt && <Check className="size-3" strokeWidth={3.5} />}
                    </button>
                  </td>
                  <td className="max-w-[18rem] px-3 py-2">
                    <button onClick={() => onAbrir(a.id)} className="flex min-w-0 items-center gap-2 text-left" title={tituloNaAgenda(a)}>
                      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: corDo(a) }} />
                      <span
                        className={cn(
                          "truncate font-semibold hover:underline",
                          a.doneAt && "text-[var(--color-muted)] line-through",
                          atrasada && "text-[var(--color-hot)]",
                        )}
                      >
                        {tituloNaAgenda(a)}
                      </span>
                    </button>
                  </td>
                  <td className="max-w-[14rem] px-3 py-2">
                    <button onClick={() => onAbrirLead(a.deal.id)} className="max-w-full truncate text-left hover:underline" title={a.deal.estagio}>
                      {a.deal.nome}
                    </button>
                  </td>
                  <td className={cn("whitespace-nowrap px-3 py-2 tabular-nums", atrasada ? "font-semibold text-[var(--color-hot)]" : "text-[var(--color-muted)]")}>
                    {a.doneAt && filtros.periodo === "concluidas"
                      ? `feita ${prazoCurto(a.doneAt, agora)}`
                      : a.dueAt
                        ? prazoCurto(a.dueAt, agora)
                        : "sem data"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--color-muted)]">{a.responsavel?.nome ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--color-muted)]">{a.deal.telefone ?? "—"}</td>
                  {variosFunis && <td className="whitespace-nowrap px-3 py-2 text-[var(--color-muted)]">{a.deal.funilNome}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

/**
 * Leads sem nenhuma atividade em aberto — o ⚠️ amarelo do funil. Cada um com
 * "Agendar", que abre a criação de atividade já com o lead escolhido.
 */
function TabelaSemAtividade({
  leads,
  variosFunis,
  agora,
  onAbrirLead,
  onAgendar,
}: {
  leads: LeadSemAtividade[];
  variosFunis: boolean;
  agora: Date | null;
  onAbrirLead: (dealId: string) => void;
  onAgendar: (lead: { id: string; nome: string }) => void;
}) {
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-[48rem] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-[var(--color-solido)]">
          <tr className="text-left text-xs font-semibold text-[var(--color-muted)]">
            <th className="px-4 py-2.5">Lead</th>
            <th className="px-3 py-2.5">Coluna</th>
            <th className="px-3 py-2.5">Última conversa</th>
            <th className="px-3 py-2.5">Telefone</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {leads.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center text-sm text-[var(--color-muted)]">
                Todo lead tem um próximo passo marcado. 👏
              </td>
            </tr>
          )}
          {leads.map((l) => (
            <tr key={l.id} className="border-t transition-colors hover:bg-[var(--color-surface-2)]">
              <td className="max-w-[16rem] px-4 py-2">
                <button onClick={() => onAbrirLead(l.id)} className="flex max-w-full items-center gap-2 text-left">
                  <TriangleAlert className="size-4 shrink-0 text-[var(--color-warm)]" />
                  <span className="truncate font-semibold hover:underline">{l.nome}</span>
                </button>
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <span className="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
                  <span className="size-2 rounded-full" style={{ backgroundColor: l.colunaCor }} />
                  {variosFunis && <span>{l.funilNome} ·</span>}
                  {l.coluna}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--color-muted)]">
                {l.ultimaConversa ? prazoCurto(l.ultimaConversa, agora) : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--color-muted)]">{l.telefone ?? "—"}</td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => onAgendar({ id: l.id, nome: l.nome })}
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  <Plus className="size-3.5" /> Agendar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        className="glass-forte w-full max-w-md rounded-lg p-5"
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
  onEditado,
}: {
  a: AtividadeCalendario;
  onFechar: () => void;
  onAlternar: () => void;
  onApagar: () => void;
  onAbrirLead: () => void;
  onEditado: () => void;
}) {
  const s = situacao(a);
  const [editando, setEditando] = useState(false);

  if (editando) {
    return (
      <Modal onFechar={onFechar}>
        <h2 className="mb-3 text-base font-bold">Editar atividade</h2>
        <EditarAtividade atividade={a} onCancelar={() => setEditando(false)} onSalvo={onEditado} />
      </Modal>
    );
  }

  return (
    <Modal onFechar={onFechar}>
      <div className="flex justify-end gap-1">
        <button onClick={() => setEditando(true)} aria-label="Editar" title="Editar" className="grid size-8 place-items-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]">
          <Pencil className="size-4" />
        </button>
        <button onClick={onApagar} aria-label="Excluir" title="Excluir" className="grid size-8 place-items-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-hot)]">
          <Trash2 className="size-4" />
        </button>
        <button onClick={onFechar} aria-label="Fechar" className="grid size-8 place-items-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex gap-3">
        <span className="mt-1.5 size-3.5 shrink-0 rounded" style={{ backgroundColor: corDo(a) }} />
        <div className="min-w-0">
          <h2 className={cn("text-xl font-bold", a.doneAt && "line-through opacity-70")}>{nomeDaAtividade(a)}</h2>
          <p className="mt-0.5 text-sm text-[var(--color-muted)]">
            {a.numero ? <span className="font-semibold text-[var(--color-accent)]">{ordinalFollowUp(a.numero)}</span> : (a.tipoNome ?? rotuloTipo(a.type))}
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
        {a.notes && (
          <Linha icone={Pencil} titulo="Anotações">
            <span className="whitespace-pre-wrap">{a.notes}</span>
          </Linha>
        )}
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
  leadInicial = null,
  leads,
  onFechar,
  onCriado,
}: {
  inicial: { data: string; hora: string };
  /** Lead já escolhido (o "Agendar" de um lead sem atividade). */
  leadInicial?: { id: string; nome: string } | null;
  leads: { id: string; nome: string }[];
  onFechar: () => void;
  onCriado: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<string>("FOLLOW_UP");
  const { proprios, recarregar } = useTiposProprios();
  const [data, setData] = useState(inicial.data);
  const [horaStr, setHoraStr] = useState(inicial.hora);
  const [busca, setBusca] = useState("");
  const [lead, setLead] = useState<{ id: string; nome: string } | null>(leadInicial);
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
      body: JSON.stringify({ ...semNulo(tipoDaChave(tipo)), title: titulo.trim() || undefined, dueAt }),
    }).catch(() => null);
    setSalvando(false);
    if (!res?.ok) return setErro("Não deu para salvar. Tente de novo.");
    onCriado();
  }

  const campo =
    "w-full rounded-md bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]";

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

        <div className="mt-4">
          <SeletorDeTipo valor={tipo} onChange={setTipo} proprios={proprios} onMudouTipos={recarregar} estilo="cor" />
        </div>

        <div className="mt-4 flex gap-2">
          <Clock className="mt-2.5 size-4 shrink-0 text-[var(--color-muted)]" />
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} />
          <input type="time" value={horaStr} onChange={(e) => setHoraStr(e.target.value)} className={cn(campo, "w-28")} />
        </div>

        <div className="mt-3 flex gap-2">
          <User className="mt-2.5 size-4 shrink-0 text-[var(--color-muted)]" />
          {lead ? (
            <div className="flex w-full items-center justify-between rounded-md bg-[var(--color-surface-2)] px-3 py-2 text-sm">
              <span className="truncate font-semibold">{lead.nome}</span>
              <button type="button" onClick={() => setLead(null)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">
                trocar
              </button>
            </div>
          ) : (
            <div className="relative w-full">
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar lead pelo nome…" className={campo} />
              {sugestoes.length > 0 && (
                <ul className="glass-forte absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md">
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
