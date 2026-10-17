"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, Clock, MessageSquare, Phone, TriangleAlert } from "lucide-react";
import type { DealCard as DealCardType } from "@/lib/types";
import { diaSemanaHora, sinalDoLead, type SinalAtividades } from "@/lib/atividades";
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
  agora = null,
}: {
  deal: DealCardType;
  onOpen?: (id: string) => void;
  overlay?: boolean;
  /** Só faz sentido com mais de um número conectado. */
  mostrarConta?: boolean;
  /** Relógio do quadro (nulo até a tela montar). */
  agora?: Date | null;
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
        "group cursor-grab rounded-[20px] border border-transparent bg-[var(--color-surface-2)] p-3.5 text-left shadow-[inset_0_1px_0_rgb(255_255_255/0.07)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-accent)]/50 hover:bg-white/[0.08] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_12px_28px_-14px_rgb(247_136_47/0.45)] active:cursor-grabbing",
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

        <span className="ml-auto flex items-center gap-2">
          {value && <span className="text-xs font-semibold text-[var(--color-text)]">{value}</span>}
          {/* Negócio fechado (Ganho/Perdido) não precisa de próximo passo. */}
          {!deal.fechado && <SinalDeAtividades deal={deal} agora={agora} />}
        </span>
      </div>
    </div>
  );
}

const ESTILO_SINAL: Record<SinalAtividades, { fundo: string; texto: string }> = {
  atrasada: { fundo: "var(--color-hot)", texto: "#fff" },
  hoje: { fundo: "#46c22d", texto: "#fff" },
  futura: { fundo: "rgb(255 255 255 / 0.18)", texto: "var(--color-text)" },
  nenhuma: { fundo: "transparent", texto: "var(--color-warm)" },
};

/**
 * O ícone de atividades do lead, como no Pipedrive: vermelho com "‹" quando
 * há atrasada, verde com "›" quando a próxima é hoje, cinza com "›" quando é
 * outro dia, e o triângulo amarelo quando não tem nada marcado.
 */
function SinalDeAtividades({ deal, agora }: { deal: DealCardType; agora: Date | null }) {
  // Até a tela montar vale o que o servidor calculou (o desenho dos dois
  // precisa bater); depois, o relógio de quem está vendo.
  const sinal = agora ? sinalDoLead(deal.proximaAtividade, agora) : deal.sinal;
  const estilo = ESTILO_SINAL[sinal];
  const prox = deal.proximaAtividade;

  const quando = prox?.dueAt ? diaSemanaHora(prox.dueAt) : "sem data";
  const outras = deal.openActivities - 1;
  const titulo =
    sinal === "nenhuma"
      ? "Nenhuma atividade marcada para este lead"
      : sinal === "atrasada"
        ? `${deal.atrasadas} ${deal.atrasadas === 1 ? "atividade atrasada" : "atividades atrasadas"} · a mais antiga: ${prox!.nome} (${quando})`
        : `${sinal === "hoje" ? "Hoje" : "Próxima"}: ${prox!.nome} (${quando})${outras > 0 ? ` · +${outras} em aberto` : ""}`;

  return (
    <span
      title={titulo}
      aria-label={titulo}
      className="grid size-[22px] shrink-0 place-items-center rounded-full"
      style={{ backgroundColor: estilo.fundo, color: estilo.texto }}
    >
      {sinal === "nenhuma" ? (
        <TriangleAlert className="size-[18px]" strokeWidth={2.4} />
      ) : sinal === "atrasada" ? (
        <ChevronLeft className="size-4" strokeWidth={3} />
      ) : (
        <ChevronRight className="size-4" strokeWidth={3} />
      )}
    </span>
  );
}
