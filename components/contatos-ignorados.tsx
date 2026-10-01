"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { LabelMapping } from "@/components/label-mapping";
import { dataHora } from "@/lib/atividades";

type Ignorado = {
  id: string;
  nome: string;
  telefone: string | null;
  conta: string;
  ignoradoEm: string;
};

/**
 * Seção de etiquetas: o mapeamento etiqueta → ação e, logo abaixo, quem está
 * ignorado no momento. Juntas porque uma mexe na outra.
 */
export function EtiquetasEIgnorados({
  contas,
}: {
  contas: { id: string; label: string | null; status: string }[];
}) {
  const [versao, setVersao] = useState(0);
  return (
    <div className="flex flex-col gap-5">
      <LabelMapping contas={contas} onMudouIgnorados={() => setVersao((v) => v + 1)} />
      <ContatosIgnorados versao={versao} />
    </div>
  );
}

function ContatosIgnorados({ versao }: { versao: number }) {
  const [lista, setLista] = useState<Ignorado[] | null>(null);
  const [voltando, setVoltando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/contatos-ignorados").catch(() => null);
    if (res?.ok) setLista(await res.json());
  }, []);
  useEffect(() => void carregar(), [carregar, versao]);

  async function voltar(id: string) {
    setVoltando(id);
    await fetch("/api/contatos-ignorados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: id }),
    }).catch(() => null);
    setVoltando(null);
    void carregar();
  }

  return (
    <div className="rounded-2xl border p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <EyeOff className="size-4 text-[var(--color-muted)]" />
        Contatos ignorados
        {lista && lista.length > 0 && (
          <span className="rounded-full bg-[var(--color-surface-2)] px-2 text-xs tabular-nums text-[var(--color-muted)]">
            {lista.length}
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">
        Não aparecem no CRM e as mensagens deles não entram. Tirar a etiqueta no
        celular traz de volta; o botão abaixo também.
      </p>

      {lista === null ? (
        <p className="mt-3 text-xs text-[var(--color-muted)]">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-muted)]">Nenhum contato ignorado.</p>
      ) : (
        <ul className="scroll-thin mt-3 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {lista.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.nome}</p>
                <p className="truncate text-[11px] text-[var(--color-muted)]">
                  {[c.telefone, c.conta, `desde ${dataHora(c.ignoradoEm)}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                onClick={() => void voltar(c.id)}
                disabled={voltando === c.id}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
              >
                <Eye className="size-3.5" />
                {voltando === c.id ? "Voltando…" : "Voltar a mostrar"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
