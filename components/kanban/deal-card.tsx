"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, MessageSquare, CheckSquare, Phone } from "lucide-react";
import type { DealCard as DealCardType } from "@/lib/types";
import { cn, formatCurrency, initials, relativeDays } from "@/lib/utils";

/** Cor da faixa de temperatura. Quente laranja, gelado azul — leitura instantânea. */
function scoreColor(score: number): string {
  if (score >= 70) return "var(--color-hot)";
  if (score >= 45) return "var(--color-warm)";
  if (score >= 20) return "var(--color-cold)";
  return "var(--color-muted)";
}

export function DealCardView({
  deal,
  onOpen,
  overlay = false,
  mostrarConta = false,
}: {
  deal: DealCardType;
  onOpen?: (id: string) => void;
  overlay?: boolean;
  /** Só faz sentido com mais de um número conectado. */
  mostrarConta?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: deal.id, data: { stageId: deal.stageId } });

  const color = scoreColor(deal.score);
  const value = formatCurrency(deal.value);

  // "Parado" só vira alerta depois de uma semana: antes disso é só o processo
  // normal de uma negociação, não um esquecimento.
  const stalled = deal.daysInStage >= 7;

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={
        overlay
          ? undefined
          : { transform: CSS.Transform.toString(transform), transition }
      }
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      onClick={() => onOpen?.(deal.id)}
      className={cn(
        "group cursor-grab rounded-[20px] border border-transparent bg-[var(--color-surface-2)] p-3.5 text-left shadow-[inset_0_1px_0_rgb(255_255_255/0.07)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-accent)]/50 hover:bg-white/[0.08] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_12px_28px_-14px_rgb(47_227_140/0.45)] active:cursor-grabbing",
        isDragging && "dragging",
        overlay && "glass-forte rotate-2 cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2.5">
        {deal.contact.profilePicUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={deal.contact.profilePicUrl}
            alt=""
            className="size-9 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-ink)] text-xs font-semibold text-[var(--color-on-ink)]">
            {initials(deal.contact.name)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {mostrarConta && (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: deal.account.color }}
                title={`Veio de: ${deal.account.label}`}
              />
            )}
            <p className="truncate text-sm font-medium">{deal.title}</p>
          </div>
          {/* O número do lead em todo card. Sem ele (o WhatsApp só mandou o
              código interno da pessoa), diz isso em vez de esconder. */}
          {deal.contact.phone ? (
            deal.contact.phone !== deal.title && (
              <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] tabular-nums text-[var(--color-muted)]">
                <Phone className="size-3" />
                {deal.contact.phone}
              </p>
            )
          ) : (
            <p
              className="mt-0.5 text-[11px] italic text-[var(--color-muted)]"
              title="O WhatsApp só informou o código interno desta pessoa. O número aparece quando ela mandar mensagem — e, se houver um card repetido, o CRM junta os dois."
            >
              número ainda não informado pelo WhatsApp
            </p>
          )}
          {deal.lastMessagePreview && (
            <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
              {deal.lastMessagePreview}
            </p>
          )}
        </div>

        <div
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
          style={{ color, backgroundColor: `${color}1a` }}
          title={deal.scoreFactors.map((f) => `${f.label}: ${f.detail}`).join("\n")}
        >
          {deal.score}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted)]">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3" />
          {relativeDays(deal.lastInboundAt)}
        </span>

        <span
          className={cn(
            "inline-flex items-center gap-1",
            stalled && "text-[var(--color-warm)]",
          )}
        >
          <Clock className="size-3" />
          {deal.daysInStage}d parado
        </span>

        {deal.openActivities > 0 && (
          <span className="inline-flex items-center gap-1">
            <CheckSquare className="size-3" />
            {deal.openActivities}
          </span>
        )}

        {value && (
          <span className="ml-auto text-xs font-semibold text-[var(--color-text)]">{value}</span>
        )}
      </div>
    </div>
  );
}
