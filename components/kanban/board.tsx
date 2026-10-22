"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import type { DealCard, StageColumn } from "@/lib/types";
import type { Campo } from "@/lib/custom-fields";
import { DealCardView } from "./deal-card";
import { cn } from "@/lib/utils";
import { ColunaMenu, NovaColuna } from "./coluna-menu";
import { useEhAdmin } from "@/components/sessao";
import { DealPanel } from "./deal-panel";
import {
  BoardFilters,
  FILTROS_VAZIOS,
  aplicarFiltros,
  type Filtros,
} from "./board-filters";

export function Board({
  pipelineId,
  stages,
  deals: initialDeals,
  campos,
  leadInicial = null,
  buscaInicial = "",
}: {
  /** Funil aberto: é nele que "Nova coluna" cria. */
  pipelineId: string;
  stages: StageColumn[];
  deals: DealCard[];
  campos: Campo[];
  /** Lead para abrir já com o painel (link direto, ex.: a nota no Pipedrive). */
  leadInicial?: string | null;
  /** Termo da busca da barra de topo. */
  buscaInicial?: string;
}) {
  const [deals, setDeals] = useState(initialDeals);

  // Relógio dos ícones de atividade: só depois de montar (o servidor já mandou
  // o ícone calculado) e a cada minuto — a atividade que vence com a tela
  // aberta fica vermelha sozinha.
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // Criar/editar colunas é de administrador; vendedor só move os cards.
  const admin = useEhAdmin();
  const [filtros, setFiltros] = useState<Filtros>({ ...FILTROS_VAZIOS, busca: buscaInicial });
  // Nova busca pela barra de topo com o funil já aberto.
  useEffect(() => setFiltros((f) => ({ ...f, busca: buscaInicial })), [buscaInicial]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const router = useRouter();

  // Dados novos do servidor (mensagem chegou, lead novo) substituem os da
  // tela — menos durante um arraste ou enquanto o movimento é salvo: trocar a
  // lista nesse intervalo faria o card pular de volta para a coluna antiga.
  // Nesse caso a versão nova espera.
  const pendentes = useRef<DealCard[] | null>(null);
  const ocupado = useRef(false);
  useEffect(() => {
    if (ocupado.current) pendentes.current = initialDeals;
    else setDeals(initialDeals);
  }, [initialDeals]);
  const [openDealId, setOpenDealId] = useState<string | null>(leadInicial);
  const [error, setError] = useState<string | null>(null);

  // Mouse: um pequeno limiar impede que um clique para abrir o card vire
  // arrasto. Toque: só arrasta segurando o card um instante — deslizar o dedo
  // continua rolando as colunas, como em qualquer app de celular.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const trilho = useRef<HTMLDivElement>(null);
  const [colunaVisivel, setColunaVisivel] = useState(0);
  // Celular: a coluna na tela é a que está mais perto da borda esquerda.
  function aoRolar() {
    const el = trilho.current;
    if (!el) return;
    const filhos = [...el.children] as HTMLElement[];
    let melhor = 0;
    filhos.forEach((f, i) => {
      if (Math.abs(f.offsetLeft - el.scrollLeft - 16) < Math.abs(filhos[melhor].offsetLeft - el.scrollLeft - 16)) melhor = i;
    });
    setColunaVisivel(melhor);
  }
  function irParaColuna(i: number) {
    const el = trilho.current;
    const alvo = el?.children[i] as HTMLElement | undefined;
    if (el && alvo) el.scrollTo({ left: alvo.offsetLeft - 16, behavior: "smooth" });
  }

  const visiveis = useMemo(() => aplicarFiltros(deals, filtros, agora), [deals, filtros, agora]);

  const byStage = useMemo(() => {
    const map = new Map<string, DealCard[]>();
    for (const stage of stages) map.set(stage.id, []);
    for (const deal of visiveis) map.get(deal.stageId)?.push(deal);
    return map;
  }, [visiveis, stages]);

  // As contas vem dos proprios cards: e a lista do que existe no funil, nao a
  // de contas cadastradas, entao nunca oferece um filtro que nao acha nada.
  const contas = useMemo(() => {
    const m = new Map<string, { id: string; label: string; color: string }>();
    for (const d of deals) m.set(d.account.id, d.account);
    return [...m.values()];
  }, [deals]);

  const activeDeal = activeId ? deals.find((d) => d.id === activeId) : null;

  // Com um numero so, o ponto colorido de origem seria ruido: todo card teria
  // a mesma cor e nao distinguiria nada.
  const varias = useMemo(
    () => new Set(deals.map((d) => d.account.id)).size > 1,
    [deals],
  );

  function handleDragStart(event: DragStartEvent) {
    ocupado.current = true;
    setActiveId(String(event.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    const dealId = String(active.id);
    const deal = deals.find((d) => d.id === dealId);

    // O alvo pode ser a coluna vazia ou outro card dentro dela.
    const overId = over ? String(over.id) : null;
    const targetStageId = !overId
      ? undefined
      : stages.some((s) => s.id === overId)
        ? overId
        : deals.find((d) => d.id === overId)?.stageId;

    if (!deal || !targetStageId || targetStageId === deal.stageId) {
      liberar();
      return;
    }

    const previousStageId = deal.stageId;

    // Otimista: o card se move na hora. Arrastar e esperar o servidor responder
    // antes de mover deixaria a interface com cara de travada.
    setDeals((prev) =>
      prev.map((d) =>
        d.id === dealId ? { ...d, stageId: targetStageId, daysInStage: 0 } : d,
      ),
    );
    setError(null);

    try {
      const res = await fetch(`/api/deals/${dealId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: targetStageId }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      // Falhou: devolve o card para onde estava. Deixar na coluna nova daria a
      // impressão de que salvou, e o histórico do funil ficaria errado.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stageId: previousStageId } : d)),
      );
      setError("Não deu para mover o card. O card voltou para a coluna anterior.");
    } finally {
      // O movimento já está salvo (ou desfeito): agora é seguro aceitar dados
      // novos do servidor.
      liberar();
    }
  }

  /**
   * Fim do arraste e do salvamento. Se chegou atualização nesse meio-tempo,
   * ela é anterior a este movimento e não serve para aplicar direto — pede
   * uma versão fresca, que já traz o card na coluna nova.
   */
  function liberar() {
    ocupado.current = false;
    if (pendentes.current) {
      pendentes.current = null;
      router.refresh();
    }
  }

  return (
    <>
      {error && (
        <div className="mx-4 mt-3 rounded-md border border-[var(--color-hot)] sm:mx-6 bg-[color-mix(in_srgb,var(--color-hot)_12%,transparent)] px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <BoardFilters
        filtros={filtros}
        onChange={setFiltros}
        campos={campos}
        contas={contas}
        total={deals.length}
        visiveis={visiveis.length}
      />

      {/* Celular: uma coluna por vez; esta barra mostra todas e pula direto. */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b px-4 py-2 sm:hidden">
        {stages.map((stage, i) => (
          <button
            key={stage.id}
            onClick={() => irParaColuna(i)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold",
              i === colunaVisivel ? "border-[var(--color-accent)] text-[var(--color-text)]" : "text-[var(--color-muted)]",
            )}
          >
            {stage.name} <span className="tabular-nums opacity-70">{byStage.get(stage.id)?.length ?? 0}</span>
          </button>
        ))}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          liberar();
        }}
      >
        <div ref={trilho} onScroll={aoRolar} className="scroll-thin flex min-h-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-4 pt-3 sm:snap-none sm:px-6">
          {stages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              stages={stages}
              deals={byStage.get(stage.id) ?? []}
              // O total real da coluna, não o filtrado: é o que muda de
              // lugar se ela for excluída.
              totalNaColuna={deals.filter((d) => d.stageId === stage.id).length}
              onOpen={setOpenDealId}
              mostrarConta={varias}
              agora={agora}
            />
          ))}
          {admin && <NovaColuna pipelineId={pipelineId} />}
        </div>

        <DragOverlay>
          {activeDeal && (
            <DealCardView deal={activeDeal} overlay mostrarConta={varias} agora={agora} />
          )}
        </DragOverlay>
      </DndContext>

      {openDealId && (
        <DealPanel
          dealId={openDealId}
          onClose={() => setOpenDealId(null)}
          // Tira o card da tela na hora, em vez de esperar um recarregamento.
          onRemoved={(id) => setDeals((prev) => prev.filter((d) => d.id !== id))}
        />
      )}
    </>
  );
}

function Column({
  stage,
  stages,
  deals,
  totalNaColuna,
  onOpen,
  mostrarConta,
  agora,
}: {
  stage: StageColumn;
  stages: StageColumn[];
  deals: DealCard[];
  totalNaColuna: number;
  onOpen: (id: string) => void;
  mostrarConta: boolean;
  agora: Date | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const admin = useEhAdmin();

  const totalValue = deals.reduce((sum, d) => sum + (d.value ?? 0), 0);

  return (
    <div className="flex w-[85vw] shrink-0 snap-center flex-col rounded-md bg-[var(--color-surface)] sm:w-[272px]">
      {/* Cabeçalho em seta, como as etapas do Pipedrive: nome, e embaixo o
          total em R$ e quantos negócios. A cor da coluna fica no traço. */}
      <div className="relative py-2 pl-3 pr-5">
        {/* A seta é só o fundo: recortar o cabeçalho inteiro cortaria o menu ⋯. */}
        <span
          className="absolute inset-0 bg-[#1d1813]"
          style={{ clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)" }}
          aria-hidden
        />
        <span
          className="absolute inset-x-0 bottom-0 h-[2px]"
          style={{ backgroundColor: stage.color, clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 0, calc(100% - 12px) 100%, 0 100%)" }}
          aria-hidden
        />
        <div className="relative flex items-center gap-1.5">
          <h2 className="truncate text-[13px] font-bold">{stage.name}</h2>
          <span className="ml-auto flex items-center">
            {admin && <ColunaMenu stage={stage} stages={stages} quantidade={totalNaColuna} />}
          </span>
        </div>
        <p className="relative text-[11px] tabular-nums text-[var(--color-muted)]">
          {totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
          {" · "}
          {deals.length} {deals.length === 1 ? "negócio" : "negócios"}
        </p>
      </div>

      <div
        ref={setNodeRef}
        className={`scroll-thin flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto rounded-b-md p-1.5 transition-colors ${
          isOver
            ? "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] ring-1 ring-inset ring-[var(--color-accent)]"
            : ""
        }`}
      >
        <SortableContext
          items={deals.map((d) => d.id)}
          strategy={verticalListSortingStrategy}
        >
          {deals.map((deal) => (
            <DealCardView
              key={deal.id}
              deal={deal}
              onOpen={onOpen}
              mostrarConta={mostrarConta}
              agora={agora}
            />
          ))}
        </SortableContext>

        {deals.length === 0 && (
          <p className="grid flex-1 place-items-center rounded-md border border-dashed text-xs text-[var(--color-muted)]">
            Arraste um lead para cá
          </p>
        )}
      </div>
    </div>
  );
}
