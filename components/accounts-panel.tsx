"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, RefreshCw } from "lucide-react";
import type { ContaResumo } from "@/lib/accounts";
import { AccountCard } from "./account-card";

/**
 * Lista de números de WhatsApp conectados.
 *
 * O estado real de cada conta é o da Evolution, não o que o CRM guardou: um
 * celular pode desconectar sem avisar ninguém. Por isso a lista recarrega a
 * cada 10 segundos enquanto a tela estiver aberta.
 */
export function AccountsPanel() {
  const [contas, setContas] = useState<ContaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Falha ao carregar as contas");
        setContas([]);
        return;
      }
      setErro(null);
      setContas(data);
    } catch {
      setErro("Não consegui falar com o servidor.");
      setContas([]);
    }
  }, []);

  useEffect(() => {
    void carregar();

    // A cada verificacao o CRM consulta a Evolution conta a conta e roda tres
    // consultas no banco — perto de um segundo. A cada 10s isso deixava a tela
    // ocupada o tempo todo; 30s e suficiente, ja que a queda de uma sessao
    // tambem chega pelo webhook.
    //
    // Fora da aba, nao verifica: nao adianta gastar requisicao para atualizar
    // uma tela que ninguem esta vendo.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void carregar();
    }, 30000);

    // Voltou para a aba: atualiza na hora, sem esperar o proximo ciclo.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [carregar]);

  async function adicionar() {
    setCriando(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErro(data.error ?? "Falha ao criar a conta");
        return;
      }
      await carregar();
    } finally {
      setCriando(false);
    }
  }

  if (!contas) {
    return (
      <p className="text-sm text-[var(--color-muted)]">Carregando contas…</p>
    );
  }

  const conectadas = contas.filter((c) => c.status === "open").length;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm">
            {contas.length} {contas.length === 1 ? "número" : "números"} ·{" "}
            {conectadas} conectado{conectadas === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            Cada número tem sessão própria. Desconectar um não afeta os outros.
          </p>
        </div>

        <button
          onClick={() => void carregar()}
          className="rounded-full border p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          aria-label="Atualizar"
        >
          <RefreshCw className="size-4" />
        </button>

        <button
          onClick={() => void adicionar()}
          disabled={criando}
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {criando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Adicionar número
        </button>
      </div>

      {erro && (
        <p className="rounded-2xl bg-[color-mix(in_srgb,var(--color-hot)_12%,transparent)] px-3 py-2 text-sm">
          {erro}
        </p>
      )}

      {contas.map((conta) => (
        <AccountCard key={conta.id} conta={conta} onMudou={carregar} />
      ))}

      {contas.length === 0 && !erro && (
        <p className="text-sm text-[var(--color-muted)]">
          Nenhuma conta ainda. Clique em &quot;Adicionar número&quot; para começar.
        </p>
      )}
    </div>
  );
}
