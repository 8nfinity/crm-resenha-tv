"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
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
  stages,
  deals: initialDeals,
  campos,
}: {
  stages: StageColumn[];
  deals: DealCard[];
  campos: Campo[];
}) {
  const [deals, setDeals] = useState(initialDeals);
  // Criar/editar colunas é de administrador; vendedor só move os cards.
  const admin = useEhAdmin();
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
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
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Um pequeno limiar impede que um clique para abrir o card seja interpretado
  // como início de arrasto.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const visiveis = useMemo(() => aplicarFiltros(deals, filtros), [deals, filtros]);
  const vendedores = useMemo(
    () => [...new Set(deals.map((d) => d.vendedor).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [deals],
  );

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
        <div className="mx-4 mb-3 rounded-2xl border border-[var(--color-hot)] sm:mx-8 bg-[color-mix(in_srgb,var(--color-hot)_12%,transparent)] px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <BoardFilters
        filtros={filtros}
        onChange={setFiltros}
        campos={campos}
        contas={contas}
        vendedores={vendedores}
        total={deals.length}
        visiveis={visiveis.length}
      />

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
        <div className="scroll-thin flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 pb-6 sm:px-8">
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
            />
          ))}
          {admin && <NovaColuna />}
        </div>

        <DragOverlay>
          {activeDeal && (
            <DealCardView deal={activeDeal} overlay mostrarConta={varias} />
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
}: {
  stage: StageColumn;
  stages: StageColumn[];
  deals: DealCard[];
  totalNaColuna: number;
  onOpen: (id: string) => void;
  mostrarConta: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const admin = useEhAdmin();

  const totalValue = deals.reduce((sum, d) => sum + (d.value ?? 0), 0);

  return (
    <div className="glass relative flex w-76 shrink-0 flex-col rounded-[28px] p-2">
      <div className="flex items-center gap-2 px-3 pb-3 pt-3">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: stage.color }}
        />
        <h2 className="truncate text-sm font-semibold">{stage.name}</h2>
        <span className="rounded-full bg-[var(--color-ink)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--color-on-ink)]">
          {deals.length}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {totalValue > 0 && (
            <span className="text-[11px] tabular-nums text-[var(--color-muted)]">
              {totalValue.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
                maximumFractionDigits: 0,
              })}
            </span>
          )}
          {admin && <ColunaMenu stage={stage} stages={stages} quantidade={totalNaColuna} />}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`scroll-thin flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-[22px] p-1 transition-colors ${
          isOver
            ? "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] ring-2 ring-[var(--color-accent)]"
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
            />
          ))}
        </SortableContext>

        {deals.length === 0 && (
          <p className="hatch grid flex-1 place-items-center rounded-[20px] text-xs text-[var(--color-muted)]">
            Arraste um lead para cá
          </p>
        )}
      </div>
    </div>
  );
}
