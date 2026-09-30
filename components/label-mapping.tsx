"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Loader2, ArrowRight, Tag } from "lucide-react";

type Estagio = { id: string; name: string; color: string };

type Etiqueta = {
  id: string;
  labelId: string;
  name: string;
  color: string | null;
  stageId: string | null;
  stage: Estagio | null;
};

type Conta = { id: string; label: string | null; status: string };

/**
 * Mapeamento etiqueta do WhatsApp Business → estágio do funil.
 *
 * O sentido é único: etiquetar no celular move o card. Mover o card no CRM
 * não aplica etiqueta nenhuma — evita o eco entre os dois lados.
 */
export function LabelMapping({ contas }: { contas: Conta[] }) {
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [porConta, setPorConta] = useState<Record<string, Etiqueta[]>>({});
  const [sincronizando, setSincronizando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(
    async (sincronizar = false, contaId?: string) => {
      const alvos = contaId ? contas.filter((c) => c.id === contaId) : contas;

      for (const conta of alvos) {
        const url = `/api/accounts/${conta.id}/labels${sincronizar ? "?sincronizar=true" : ""}`;
        try {
          const res = await fetch(url);
          const data = await res.json();
          if (!res.ok) {
            setErro(data.error ?? "Falha ao carregar etiquetas");
            continue;
          }
          if (data.erroSync) setErro(data.erroSync);
          setPorConta((p) => ({ ...p, [conta.id]: data.etiquetas }));
        } catch {
          setErro("Não consegui falar com o servidor.");
        }
      }
      setCarregado(true);
    },
    [contas],
  );

  useEffect(() => {
    void fetch("/api/stages")
      .then((r) => r.json())
      .then((s: Estagio[]) => setEstagios(s))
      .catch(() => {});
    void carregar(false);
  }, [carregar]);

  async function mapear(contaId: string, labelId: string, stageId: string | null) {
    // Otimista: o select responde na hora. Esperar o servidor daria a sensação
    // de travamento num controle que deveria ser instantâneo.
    setPorConta((p) => ({
      ...p,
      [contaId]: (p[contaId] ?? []).map((e) =>
        e.labelId === labelId
          ? { ...e, stageId, stage: estagios.find((s) => s.id === stageId) ?? null }
          : e,
      ),
    }));

    const res = await fetch(`/api/accounts/${contaId}/labels`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labelId, stageId }),
    });

    if (!res.ok) {
      setErro("Não consegui salvar o mapeamento.");
      void carregar(false, contaId);
    }
  }

  async function sincronizar(contaId: string) {
    setSincronizando(contaId);
    setErro(null);
    await carregar(true, contaId);
    setSincronizando(null);
  }

  if (!carregado) {
    return <p className="text-sm text-[var(--color-muted)]">Carregando etiquetas…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {erro && (
        <p className="rounded-2xl bg-[color-mix(in_srgb,var(--color-hot)_12%,transparent)] px-3 py-2 text-xs">
          {erro}
        </p>
      )}

      {contas.map((conta) => {
        const etiquetas = porConta[conta.id] ?? [];
        const conectado = conta.status === "open";

        return (
          <div key={conta.id} className="rounded-full border p-3">
            <div className="mb-3 flex items-center gap-2">
              <p className="flex-1 text-sm font-medium">
                {conta.label ?? "Conta"}
              </p>
              <button
                onClick={() => void sincronizar(conta.id)}
                disabled={!conectado || sincronizando === conta.id}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
              >
                {sincronizando === conta.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Buscar do aparelho
              </button>
            </div>

            {etiquetas.length === 0 ? (
              <p className="text-xs text-[var(--color-muted)]">
                {conectado
                  ? "Nenhuma etiqueta encontrada. Etiquetas existem apenas no " +
                    "WhatsApp Business — num WhatsApp pessoal o recurso não existe. " +
                    "Se este número é Business, crie as etiquetas no celular e " +
                    'clique em "Buscar do aparelho".'
                  : "Conecte este número para buscar as etiquetas."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {etiquetas.map((etiqueta) => (
                  <li key={etiqueta.id} className="flex items-center gap-2">
                    <Tag
                      className="size-3.5 shrink-0"
                      style={{ color: etiqueta.color ?? "var(--color-muted)" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {etiqueta.name}
                    </span>

                    <ArrowRight className="size-3.5 shrink-0 text-[var(--color-muted)]" />

                    <select
                      value={etiqueta.stageId ?? ""}
                      onChange={(e) =>
                        void mapear(conta.id, etiqueta.labelId, e.target.value || null)
                      }
                      className="w-44 shrink-0 rounded-xl bg-[var(--color-surface-2)] px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                    >
                      <option value="">Não move o lead</option>
                      {estagios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
