"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

type Stage = {
  id: string;
  name: string;
  color: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
  _count: { deals: number };
};

export function StageEditor() {
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    const res = await fetch("/api/stages");
    if (res.ok) setStages(await res.json());
  }

  useEffect(() => {
    void carregar();
  }, []);

  async function renomear(id: string, name: string) {
    await fetch(`/api/stages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    void carregar();
  }

  async function mudarCor(id: string, color: string) {
    await fetch(`/api/stages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
    void carregar();
  }

  async function criar() {
    if (!novo.trim()) return;
    setErro(null);
    const res = await fetch("/api/stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: novo.trim() }),
    });
    if (!res.ok) setErro((await res.json()).error ?? "Falha ao criar");
    setNovo("");
    void carregar();
  }

  async function apagar(id: string) {
    setErro(null);
    const res = await fetch(`/api/stages/${id}`, { method: "DELETE" });
    if (!res.ok) setErro((await res.json()).error ?? "Falha ao apagar");
    void carregar();
  }

  if (!stages) {
    return <p className="text-sm text-[var(--color-muted)]">Carregando…</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {erro && (
        <p className="rounded-2xl bg-[color-mix(in_srgb,var(--color-hot)_12%,transparent)] px-3 py-2 text-xs">
          {erro}
        </p>
      )}

      {stages.map((s) => (
        <div key={s.id} className="flex items-center gap-2">
          <input
            type="color"
            value={s.color}
            onChange={(e) => void mudarCor(s.id, e.target.value)}
            className="size-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label={`Cor de ${s.name}`}
          />
          <input
            defaultValue={s.name}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value !== s.name) {
                void renomear(s.id, e.target.value.trim());
              }
            }}
            className="flex-1 rounded-xl bg-[var(--color-surface-2)] px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-[var(--color-muted)]">
            {s._count.deals} {s._count.deals === 1 ? "lead" : "leads"}
          </span>
          <button
            onClick={() => void apagar(s.id)}
            disabled={s._count.deals > 0}
            className="shrink-0 rounded-full border p-1.5 text-[var(--color-muted)] hover:text-[var(--color-hot)] disabled:opacity-30"
            aria-label={`Apagar ${s.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}

      <div className="mt-2 flex gap-2">
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void criar()}
          placeholder="Nome do novo estágio…"
          className="flex-1 rounded-xl bg-[var(--color-surface-2)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--color-muted)]"
        />
        <button
          onClick={() => void criar()}
          disabled={!novo.trim()}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          Adicionar
        </button>
      </div>
    </div>
  );
}
