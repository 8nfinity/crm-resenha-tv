"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { opcoesDeTipo, type TipoProprio } from "@/lib/atividades";
import { useEhAdmin } from "@/components/sessao";
import { EVENTO_MUDOU, type DetalheMudou } from "@/components/ao-vivo";
import { cn } from "@/lib/utils";

/** Cores sugeridas para um tipo novo (as dos fixos já estão em uso). */
const CORES = ["#f97316", "#ec4899", "#14b8a6", "#ef4444", "#84cc16", "#06b6d4", "#e879f9", "#facc15"];

/**
 * Os tipos criados por você ("Avaliação", "Retorno"), buscados uma vez e
 * atualizados quando alguém cria ou apaga um (aviso ao vivo).
 */
export function useTiposProprios(): { proprios: TipoProprio[]; recarregar: () => void } {
  const [proprios, setProprios] = useState<TipoProprio[]>([]);
  const recarregar = useCallback(() => {
    void fetch("/api/tipos-atividade")
      .then((r) => (r.ok ? r.json() : []))
      .then((t: TipoProprio[]) => setProprios(Array.isArray(t) ? t : []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    recarregar();
    const aoMudar = (e: Event) => {
      const motivo = (e as CustomEvent<DetalheMudou>).detail?.motivo;
      if (motivo === "atividade" || motivo === "conferencia") recarregar();
    };
    window.addEventListener(EVENTO_MUDOU, aoMudar);
    return () => window.removeEventListener(EVENTO_MUDOU, aoMudar);
  }, [recarregar]);
  return { proprios, recarregar };
}

/**
 * Botões de tipo para agendar: os fixos, os seus e "Outro". Administrador vê
 * "+ Novo tipo" (nome e cor) e pode apagar um tipo seu — as atividades dele
 * voltam a ser "Outro", nada se perde.
 */
export function SeletorDeTipo({
  valor,
  onChange,
  proprios,
  onMudouTipos,
  estilo = "neutro",
}: {
  valor: string;
  onChange: (chave: string) => void;
  proprios: TipoProprio[];
  onMudouTipos: () => void;
  /** "neutro": selecionado em preto (painel do lead); "cor": na cor do tipo (calendário). */
  estilo?: "neutro" | "cor";
}) {
  const admin = useEhAdmin();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(CORES[0]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function criar() {
    setSalvando(true);
    setErro(null);
    const res = await fetch("/api/tipos-atividade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome, color: cor }),
    });
    const r = await res.json().catch(() => ({}));
    setSalvando(false);
    if (!res.ok) {
      setErro(r.error ?? "Não consegui criar o tipo.");
      return;
    }
    setCriando(false);
    setNome("");
    onMudouTipos();
    onChange(`k:${r.id}`);
  }

  async function apagar(t: TipoProprio) {
    if (!confirm(`Apagar o tipo “${t.name}”? As atividades dele continuam, como “Outro”.`)) return;
    const res = await fetch(`/api/tipos-atividade/${t.id}`, { method: "DELETE" });
    if (!res.ok) return;
    if (valor === `k:${t.id}`) onChange("OTHER");
    onMudouTipos();
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {opcoesDeTipo(proprios).map((o) => {
          const ativo = valor === o.chave;
          const proprio = proprios.find((p) => `k:${p.id}` === o.chave);
          return (
            <span key={o.chave} className="group relative inline-flex">
              <button
                type="button"
                onClick={() => onChange(o.chave)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
                  ativo
                    ? estilo === "cor"
                      ? "font-semibold text-black"
                      : "bg-[var(--color-ink)] font-semibold text-[var(--color-on-ink)]"
                    : "border text-[var(--color-muted)] hover:text-[var(--color-text)]",
                )}
                style={ativo && estilo === "cor" ? { backgroundColor: o.cor } : undefined}
              >
                {!(ativo && estilo === "cor") && <span className="size-2 rounded-full" style={{ backgroundColor: o.cor }} />}
                {o.nome}
              </button>
              {admin && proprio && (
                <button
                  type="button"
                  onClick={() => void apagar(proprio)}
                  className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-[var(--color-surface-2)] p-0.5 text-[var(--color-muted)] shadow hover:text-[var(--color-hot)] group-hover:block"
                  aria-label={`Apagar o tipo ${proprio.name}`}
                  title="Apagar este tipo"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </span>
          );
        })}
        {admin && !criando && (
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <Plus className="size-3" />
            Novo tipo
          </button>
        )}
      </div>

      {criando && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void criar();
              }
              if (e.key === "Escape") setCriando(false);
            }}
            placeholder="Nome (ex.: Avaliação)"
            maxLength={40}
            className="w-40 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          {CORES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCor(c)}
              className={cn("size-5 rounded-full", cor === c && "ring-2 ring-[var(--color-text)] ring-offset-1 ring-offset-transparent")}
              style={{ backgroundColor: c }}
              aria-label={`Cor ${c}`}
            />
          ))}
          <button
            type="button"
            onClick={() => void criar()}
            disabled={salvando || !nome.trim()}
            className="rounded-full p-1 text-[var(--color-accent)] disabled:opacity-40"
            aria-label="Criar tipo"
          >
            <Check className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setCriando(false)}
            className="rounded-full p-1 text-[var(--color-muted)]"
            aria-label="Cancelar"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      {erro && <p className="mt-1 text-xs text-[var(--color-hot)]">{erro}</p>}
    </div>
  );
}
