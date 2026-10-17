"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, Clock, MessageSquare, TriangleAlert } from "lucide-react";
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
      // A última mensagem aparece passando o mouse: o card fica compacto como
      // no Pipedrive, sem perder o contexto da conversa.
      title={deal.lastMessagePreview ?? undefined}
      className={cn(
        "group cursor-grab rounded-md bg-[var(--color-card)] px-3 py-2.5 text-left shadow-[var(--shadow-card)] ring-1 ring-white/[0.06] transition-[box-shadow,background-color] duration-150 hover:bg-[#28211a] hover:ring-[var(--color-accent)]/60 active:cursor-grabbing",
        isDragging && "dragging",
        overlay && "rotate-2 cursor-grabbing ring-[var(--color-accent)]",
      )}
    >
      {/* Como no Pipedrive: título, quem é, e o ícone de atividade à direita. */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-snug">
            {mostrarConta && (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: deal.account.color }}
                title={`Veio de: ${deal.account.label}`}
              />
            )}
            <span className="truncate">{deal.title}</span>
          </p>
          {/* O número do lead em todo card. Sem ele (o WhatsApp só mandou o
              código interno da pessoa), diz isso em vez de esconder. */}
          {deal.contact.phone ? (
            deal.contact.phone !== deal.title && (
              <p className="mt-0.5 truncate text-xs tabular-nums text-[var(--color-muted)]">{deal.contact.phone}</p>
            )
          ) : (
            <p
              className="mt-0.5 truncate text-xs italic text-[var(--color-muted)]"
              title="O WhatsApp só informou o código interno desta pessoa. O número aparece quando ela mandar mensagem — e, se houver um card repetido, o CRM junta os dois."
            >
              número ainda não informado
            </p>
          )}
        </div>
        {/* Negócio fechado (Ganho/Perdido) não precisa de próximo passo. */}
        {!deal.fechado && <SinalDeAtividades deal={deal} agora={agora} />}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
        {deal.contact.profilePicUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={deal.contact.profilePicUrl} alt="" className="size-5 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-ink)] text-[9px] font-bold text-[var(--color-on-ink)]">
            {initials(deal.contact.name)}
          </span>
        )}
        <span className="font-semibold tabular-nums text-[var(--color-text)]">{value ?? "R$ 0"}</span>

        <span className="ml-auto flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1" title="Última mensagem dele">
            <MessageSquare className="size-3" />
            {relativeDays(deal.lastInboundAt)}
          </span>
          <span
            className={cn("inline-flex items-center gap-1", stalled && "font-semibold text-[var(--color-warm)]")}
            title="Dias nesta coluna"
          >
            <Clock className="size-3" />
            {deal.daysInStage}d
          </span>
          <span
            className="rounded px-1.5 py-px text-[10px] font-bold tabular-nums"
            style={{ color, backgroundColor: `${color}22` }}
            title={[`Temperatura ${deal.score}`, ...deal.scoreFactors.map((f) => `${f.label}: ${f.detail}`)].join("\n")}
          >
            {deal.score}
          </span>
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
