"use client";

import { useState } from "react";
import { AlertTriangle, Clock, MessageSquare, Snowflake } from "lucide-react";
import type { AgendaHoje, ItemHoje } from "@/lib/today";
import { DealPanel } from "@/components/kanban/deal-panel";
import { cn } from "@/lib/utils";

/**
 * A agenda do dia.
 *
 * Quatro blocos, em ordem de urgência. Clicar num item abre o mesmo painel do
 * funil — para você resolver ali, sem trocar de tela.
 */
export function TodayList({ agenda }: { agenda: AgendaHoje }) {
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [resolvidos, setResolvidos] = useState<Set<string>>(new Set());

  const blocos = [
    {
      chave: "atrasados",
      titulo: "Atrasados",
      descricao: "Venceram e continuam em aberto",
      icone: AlertTriangle,
      cor: "var(--color-hot)",
      itens: agenda.atrasados,
    },
    {
      chave: "hoje",
      titulo: "Para hoje",
      descricao: "Compromissos com prazo até o fim do dia",
      icone: Clock,
      cor: "var(--color-warm)",
      itens: agenda.hoje,
    },
    {
      chave: "responderam",
      titulo: "Responderam",
      descricao: "Deram sinal nas últimas 24h e estão esperando",
      icone: MessageSquare,
      cor: "var(--color-accent)",
      itens: agenda.responderam,
    },
    {
      chave: "esfriando",
      titulo: "Esfriando",
      descricao: "Valiam a pena e você parou no meio",
      icone: Snowflake,
      cor: "var(--color-cold)",
      itens: agenda.esfriando,
    },
  ];

  const vazio = blocos.every((b) => b.itens.length === 0);

  if (vazio) {
    return (
      <div className="card grid flex-1 place-items-center p-10 text-center">
        <div className="max-w-sm">
          <p className="text-xl font-semibold">Nada exige você agora.</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Sem tarefas vencidas, sem respostas esperando e sem lead quente
            abandonado. Se o funil estiver vazio, comece importando conversas em
            Conexão.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {blocos
          .filter((b) => b.itens.length > 0)
          .map((bloco) => (
            <section key={bloco.chave} className="card flex flex-col p-5">
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-surface-2)] ring-1 ring-[var(--color-border)]">
                  <bloco.icone className="size-3.5" style={{ color: bloco.cor }} />
                </span>
                <h2 className="text-base font-semibold">{bloco.titulo}</h2>
                <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--color-muted)]">
                  {bloco.itens.length}
                </span>
                <span className="truncate text-xs text-[var(--color-muted)]">
                  {bloco.descricao}
                </span>
              </div>

              <ul className="flex flex-col gap-1.5">
                {bloco.itens.map((item) => (
                  <Linha
                    key={`${bloco.chave}-${item.dealId}`}
                    item={item}
                    cor={bloco.cor}
                    resolvido={resolvidos.has(item.dealId)}
                    onAbrir={() => setAbertoId(item.dealId)}
                  />
                ))}
              </ul>
            </section>
          ))}
      </div>

      {abertoId && (
        <DealPanel
          dealId={abertoId}
          onClose={() => setAbertoId(null)}
          // Riscar em vez de sumir: um item que desaparece na hora deixa dúvida
          // sobre o que aconteceu com ele.
          onRemoved={(id) => setResolvidos((p) => new Set(p).add(id))}
        />
      )}
    </>
  );
}

function Linha({
  item,
  cor,
  resolvido,
  onAbrir,
}: {
  item: ItemHoje;
  cor: string;
  resolvido: boolean;
  onAbrir: () => void;
}) {
  return (
    <li>
      <button
        onClick={onAbrir}
        className={cn(
          "group flex w-full items-center gap-3 rounded-2xl bg-[var(--color-surface-2)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-ink)] hover:text-[var(--color-on-ink)]",
          resolvido && "opacity-40",
        )}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: cor }} />

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-medium",
              resolvido && "line-through",
            )}
          >
            {item.nome}
          </span>
          <span className="block truncate text-xs text-[var(--color-muted)] group-hover:text-[var(--color-on-ink)]/70">
            {item.detalhe}
          </span>
        </span>

        <span
          className="hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] sm:inline"
          style={{ color: item.estagioCor, backgroundColor: `${item.estagioCor}22` }}
        >
          {item.estagio}
        </span>

        <span className="grid size-8 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums group-hover:border-[var(--color-on-ink)]/30">
          {item.score}
        </span>
      </button>
    </li>
  );
}
