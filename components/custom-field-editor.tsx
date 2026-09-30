"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import type { Campo, CampoTipo } from "@/lib/custom-fields";

const TIPOS: { valor: CampoTipo; rotulo: string; ajuda: string }[] = [
  { valor: "TEXT", rotulo: "Texto", ajuda: "Escrita livre" },
  { valor: "SELECT", rotulo: "Seleção", ajuda: "Lista de opções — vira filtro no funil" },
  { valor: "NUMBER", rotulo: "Número", ajuda: "Só números" },
  { valor: "DATE", rotulo: "Data", ajuda: "Uma data" },
];

/** Define os campos que aparecem em todos os leads. */
export function CustomFieldEditor() {
  const [campos, setCampos] = useState<Campo[] | null>(null);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<CampoTipo>("SELECT");
  const [opcoes, setOpcoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    const res = await fetch("/api/custom-fields");
    if (res.ok) setCampos(await res.json());
  }

  useEffect(() => {
    void carregar();
  }, []);

  async function criar() {
    if (!nome.trim()) return;
    setErro(null);
    setSalvando(true);

    const lista = opcoes
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    const res = await fetch("/api/custom-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome.trim(), type: tipo, options: lista }),
    });

    setSalvando(false);
    if (!res.ok) {
      setErro((await res.json()).error ?? "Falha ao criar");
      return;
    }
    setNome("");
    setOpcoes("");
    void carregar();
  }

  async function apagar(id: string) {
    await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    void carregar();
  }

  if (!campos) {
    return <p className="text-sm text-[var(--color-muted)]">Carregando…</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {erro && (
        <p className="rounded-2xl bg-[color-mix(in_srgb,var(--color-hot)_12%,transparent)] px-3 py-2 text-xs">
          {erro}
        </p>
      )}

      {campos.length > 0 && (
        <ul className="flex flex-col gap-2">
          {campos.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="w-40 shrink-0 truncate font-medium">{c.name}</span>
              <span className="shrink-0 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--color-muted)]">
                {TIPOS.find((t) => t.valor === c.type)?.rotulo ?? c.type}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-muted)]">
                {c.options.join(" · ")}
              </span>
              <button
                onClick={() => void apagar(c.id)}
                className="shrink-0 rounded-full border p-1.5 text-[var(--color-muted)] hover:text-[var(--color-hot)]"
                aria-label={`Apagar ${c.name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do campo (ex: Origem)"
          className="w-48 rounded-xl bg-[var(--color-surface-2)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--color-muted)]"
        />

        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as CampoTipo)}
          className="rounded-xl bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm outline-none"
        >
          {TIPOS.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.rotulo}
            </option>
          ))}
        </select>

        {tipo === "SELECT" && (
          <input
            value={opcoes}
            onChange={(e) => setOpcoes(e.target.value)}
            placeholder="Opções separadas por vírgula"
            className="min-w-56 flex-1 rounded-xl bg-[var(--color-surface-2)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--color-muted)]"
          />
        )}

        <button
          onClick={() => void criar()}
          disabled={!nome.trim() || salvando}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm disabled:opacity-40"
        >
          {salvando ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          Adicionar
        </button>
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        {TIPOS.find((t) => t.valor === tipo)?.ajuda}. O tipo não muda depois de
        criado — trocar transformaria em lixo o que já estivesse preenchido.
      </p>
    </div>
  );
}
