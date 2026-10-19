"use client";

import { Search, X } from "lucide-react";
import type { Campo } from "@/lib/custom-fields";
import type { DealCard } from "@/lib/types";
import { sinalDoLead, type SinalAtividades } from "@/lib/atividades";
import { cn } from "@/lib/utils";

/**
 * Filtros do funil.
 *
 * Tudo acontece no cliente: o funil já carrega todos os cards para desenhar o
 * kanban, então filtrar no servidor significaria uma ida e volta para esconder
 * dados que já estão na tela.
 */

export type Filtros = {
  busca: string;
  temperatura: "todas" | "quente" | "morno" | "frio";
  parados: number | null;
  contaId: string | null;
  /** O ícone de atividades do card: atrasadas, hoje, futuras, sem nenhuma. */
  atividade: "todas" | SinalAtividades;
  campos: Record<string, string>;
};

export const FILTROS_VAZIOS: Filtros = {
  busca: "",
  temperatura: "todas",
  parados: null,
  contaId: null,
  atividade: "todas",
  campos: {},
};

export function filtrosAtivos(f: Filtros): number {
  return (
    (f.busca.trim() ? 1 : 0) +
    (f.temperatura !== "todas" ? 1 : 0) +
    (f.parados !== null ? 1 : 0) +
    (f.contaId ? 1 : 0) +
    (f.atividade !== "todas" ? 1 : 0) +
    Object.values(f.campos).filter(Boolean).length
  );
}

/** As faixas espelham describeScore, para a tela e o Claude concordarem. */
function naFaixa(score: number, t: Filtros["temperatura"]): boolean {
  if (t === "quente") return score >= 70;
  if (t === "morno") return score >= 45 && score < 70;
  if (t === "frio") return score < 45;
  return true;
}

export function aplicarFiltros(deals: DealCard[], f: Filtros, agora: Date | null = null): DealCard[] {
  const termo = f.busca.trim().toLowerCase();
  // Busca por telefone ignora formatação: você digita "98765" e acha
  // "+55 11 98765-4321".
  const digitos = termo.replace(/\D/g, "");

  return deals.filter((d) => {
    if (termo) {
      const alvos = [
        d.title,
        d.contact.name,
        d.lastMessagePreview ?? "",
      ].map((s) => s.toLowerCase());

      const casaTexto = alvos.some((a) => a.includes(termo));
      const casaFone =
        digitos.length >= 3 &&
        (d.contact.phone ?? "").replace(/\D/g, "").includes(digitos);

      if (!casaTexto && !casaFone) return false;
    }

    if (!naFaixa(d.score, f.temperatura)) return false;
    if (f.parados !== null && d.daysInStage < f.parados) return false;
    if (f.contaId && d.account.id !== f.contaId) return false;
    if (f.atividade !== "todas") {
      // O mesmo cálculo do ícone do card: o filtro acha exatamente o que a tela
      // mostra — e card fechado (Ganho/Perdido) não tem ícone.
      if (d.fechado) return false;
      const sinal = agora ? sinalDoLead(d.proximaAtividade, agora) : d.sinal;
      if (sinal !== f.atividade) return false;
    }

    for (const [campoId, valor] of Object.entries(f.campos)) {
      if (!valor) continue;
      if (String(d.customValues?.[campoId] ?? "") !== valor) return false;
    }

    return true;
  });
}

export function BoardFilters({
  filtros,
  onChange,
  campos,
  contas,
  total,
  visiveis,
}: {
  filtros: Filtros;
  onChange: (f: Filtros) => void;
  campos: Campo[];
  contas: { id: string; label: string; color: string }[];
  total: number;
  visiveis: number;
}) {
  const ativos = filtrosAtivos(filtros);
  const set = (p: Partial<Filtros>) => onChange({ ...filtros, ...p });

  // Só campos de seleção viram filtro: texto livre geraria uma lista infinita
  // de valores e um controle inútil.
  const camposFiltraveis = campos.filter((c) => c.type === "SELECT");

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-6">
      <div className="relative w-full sm:w-auto">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-muted)]" />
        <input
          value={filtros.busca}
          onChange={(e) => set({ busca: e.target.value })}
          placeholder="Buscar por nome, telefone ou mensagem…"
          className="w-full sm:w-64 rounded-md border bg-[var(--color-surface)] py-1.5 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
        />
      </div>

      {/* No celular os filtros rolam para o lado numa linha só. */}
      <div className="no-scrollbar -mx-4 flex w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 sm:contents">
      <Seletor
        valor={filtros.temperatura}
        onChange={(v) => set({ temperatura: v as Filtros["temperatura"] })}
        opcoes={[
          { valor: "todas", rotulo: "Todas as temperaturas" },
          { valor: "quente", rotulo: "Quentes (70+)" },
          { valor: "morno", rotulo: "Mornos (45–69)" },
          { valor: "frio", rotulo: "Frios (<45)" },
        ]}
      />

      <Seletor
        valor={filtros.parados === null ? "" : String(filtros.parados)}
        onChange={(v) => set({ parados: v ? Number(v) : null })}
        opcoes={[
          { valor: "", rotulo: "Qualquer tempo parado" },
          { valor: "7", rotulo: "Parados há 7+ dias" },
          { valor: "14", rotulo: "Parados há 14+ dias" },
          { valor: "30", rotulo: "Parados há 30+ dias" },
        ]}
      />

      <Seletor
        valor={filtros.atividade}
        onChange={(v) => set({ atividade: v as Filtros["atividade"] })}
        opcoes={[
          { valor: "todas", rotulo: "Todas as atividades" },
          { valor: "atrasada", rotulo: "🔴 Com atividade atrasada" },
          { valor: "hoje", rotulo: "🟢 Atividade para hoje" },
          { valor: "futura", rotulo: "⚪ Próxima em outro dia" },
          { valor: "nenhuma", rotulo: "⚠️ Sem atividade marcada" },
        ]}
      />

      {contas.length > 1 && (
        <Seletor
          valor={filtros.contaId ?? ""}
          onChange={(v) => set({ contaId: v || null })}
          opcoes={[
            { valor: "", rotulo: "Todos os números" },
            ...contas.map((c) => ({ valor: c.id, rotulo: c.label })),
          ]}
        />
      )}

      {camposFiltraveis.map((campo) => (
        <Seletor
          key={campo.id}
          valor={filtros.campos[campo.id] ?? ""}
          onChange={(v) =>
            set({ campos: { ...filtros.campos, [campo.id]: v } })
          }
          opcoes={[
            { valor: "", rotulo: `${campo.name}: todos` },
            ...campo.options.map((o) => ({ valor: o, rotulo: o })),
          ]}
        />
      ))}

      {ativos > 0 && (
        <>
          <button
            onClick={() => onChange(FILTROS_VAZIOS)}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <X className="size-3.5" />
            Limpar
          </button>
          <span className="text-xs tabular-nums text-[var(--color-muted)]">
            {visiveis} de {total} leads
          </span>
        </>
      )}
      </div>
    </div>
  );
}

function Seletor({
  valor,
  onChange,
  opcoes,
}: {
  valor: string;
  onChange: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
}) {
  const ativo = valor !== "" && valor !== "todas";

  return (
    <select
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "shrink-0 rounded-md border px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]",
        ativo
          ? "bolha border-transparent font-semibold text-white"
          : "bg-[var(--color-surface)] text-[var(--color-muted)]",
      )}
    >
      {opcoes.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.rotulo}
        </option>
      ))}
    </select>
  );
}
