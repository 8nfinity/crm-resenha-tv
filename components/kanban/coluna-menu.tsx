"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { StageColumn } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Paleta das colunas: legível no fundo escuro e distinta entre si. */
export const CORES_COLUNA = [
  "#94a3b8", "#5eb8ff", "#a78bfa", "#f472b6", "#ffd629", "#fb923c", "#46c22d", "#ff7a59",
];

async function enviar(url: string, init: RequestInit): Promise<{ ok: boolean; erro?: string }> {
  const res = await fetch(url, init).catch(() => null);
  if (!res) return { ok: false, erro: "Sem conexão com o servidor." };
  if (res.ok) return { ok: true };
  const corpo = await res.json().catch(() => ({}));
  return { ok: false, erro: corpo.error ?? "Não deu certo. Tente de novo." };
}

/** Menu "⋯" no cabeçalho de cada coluna do funil. */
export function ColunaMenu({
  stage,
  stages,
  quantidade,
}: {
  stage: StageColumn;
  stages: StageColumn[];
  quantidade: number;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<"menu" | "renomear" | "excluir">("menu");
  const [nome, setNome] = useState(stage.name);
  const [destino, setDestino] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  // Clique fora fecha, como qualquer menu.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) fechar();
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function fechar() {
    setAberto(false);
    setModo("menu");
    setErro(null);
    setNome(stage.name);
    setDestino("");
  }

  async function aplicar(url: string, init: RequestInit) {
    setSalvando(true);
    setErro(null);
    const r = await enviar(url, init);
    setSalvando(false);
    if (!r.ok) {
      setErro(r.erro ?? null);
      return false;
    }
    router.refresh();
    return true;
  }

  const patch = (corpo: object) =>
    aplicar(`/api/stages/${stage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });

  const final = stage.isWon || stage.isLost;
  const outras = stages.filter((s) => s.id !== stage.id);

  return (
    <div className="relative" ref={caixa}>
      <button
        onClick={() => (aberto ? fechar() : setAberto(true))}
        aria-label={`Opções da coluna ${stage.name}`}
        className="grid size-7 place-items-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      >
        <MoreHorizontal className="size-4" />
      </button>

      {aberto && (
        <div className="glass-forte absolute right-0 top-full z-30 mt-1 w-64 rounded-3xl p-2">
          {modo === "menu" && (
            <>
              <Opcao icone={Pencil} onClick={() => setModo("renomear")}>Renomear</Opcao>
              <Opcao icone={ArrowLeft} onClick={() => void patch({ mover: "esquerda" })}>Mover para a esquerda</Opcao>
              <Opcao icone={ArrowRight} onClick={() => void patch({ mover: "direita" })}>Mover para a direita</Opcao>

              <div className="my-2 px-2">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">Cor</p>
                <div className="flex flex-wrap gap-1.5">
                  {CORES_COLUNA.map((cor) => (
                    <button
                      key={cor}
                      onClick={() => void patch({ color: cor })}
                      aria-label={`Cor ${cor}`}
                      className={cn(
                        "size-6 rounded-full ring-offset-2 ring-offset-[var(--color-surface)]",
                        stage.color.toLowerCase() === cor && "ring-2 ring-[var(--color-text)]",
                      )}
                      style={{ backgroundColor: cor }}
                    />
                  ))}
                </div>
              </div>

              <div className="my-1 border-t" />
              {final ? (
                <p className="px-2 py-1.5 text-xs text-[var(--color-muted)]">
                  Coluna final: conta os {stage.isWon ? "ganhos" : "perdidos"} nas métricas, por isso não pode ser excluída.
                </p>
              ) : (
                <Opcao icone={Trash2} perigo onClick={() => setModo("excluir")}>Excluir coluna</Opcao>
              )}
            </>
          )}

          {modo === "renomear" && (
            <form
              className="p-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (nome.trim()) void patch({ name: nome.trim() }).then((ok) => ok && fechar());
              }}
            >
              <input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={60}
                className="w-full rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
              <div className="mt-2 flex gap-2">
                <button
                  disabled={salvando || !nome.trim()}
                  className="flex-1 rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
                >
                  Salvar
                </button>
                <button type="button" onClick={() => setModo("menu")} className="rounded-full border px-3 py-1.5 text-sm text-[var(--color-muted)]">
                  Voltar
                </button>
              </div>
            </form>
          )}

          {modo === "excluir" && (
            <div className="p-1">
              <p className="text-sm font-semibold">Excluir “{stage.name}”?</p>
              {quantidade > 0 ? (
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Os {quantidade} {quantidade === 1 ? "lead desta coluna vai" : "leads desta coluna vão"} para:
                </p>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Se já passou lead por aqui, o histórico dela é somado à coluna escolhida, para as métricas não perderem o passado:
                </p>
              )}
              <select
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
                className="mt-2 w-full rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none"
              >
                <option value="">Escolha a coluna…</option>
                {outras.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex gap-2">
                <button
                  disabled={salvando || !destino}
                  onClick={() =>
                    void aplicar(`/api/stages/${stage.id}?moverPara=${destino}`, { method: "DELETE" }).then(
                      (ok) => ok && fechar(),
                    )
                  }
                  className="flex-1 rounded-full bg-[var(--color-hot)] px-3 py-1.5 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
                >
                  {salvando ? "Excluindo…" : "Excluir"}
                </button>
                <button onClick={() => setModo("menu")} className="rounded-full border px-3 py-1.5 text-sm text-[var(--color-muted)]">
                  Voltar
                </button>
              </div>
            </div>
          )}

          {erro && <p className="px-2 pt-2 text-xs text-[var(--color-hot)]">{erro}</p>}
        </div>
      )}
    </div>
  );
}

function Opcao({
  icone: Icone,
  onClick,
  perigo,
  children,
}: {
  icone: typeof Pencil;
  onClick: () => void;
  perigo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface-2)]",
        perigo && "text-[var(--color-hot)]",
      )}
    >
      <Icone className="size-4" />
      {children}
    </button>
  );
}

/** Cartão no fim do quadro para criar uma coluna no funil aberto. */
export function NovaColuna({ pipelineId }: { pipelineId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(CORES_COLUNA[1]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSalvando(true);
    const r = await enviar("/api/stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome.trim(), color: cor, pipelineId }),
    });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.erro ?? null);
      return;
    }
    setNome("");
    setAberto(false);
    setErro(null);
    router.refresh();
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="flex h-24 w-64 shrink-0 items-center justify-center gap-2 rounded-[28px] border-2 border-dashed border-[var(--color-border)] text-sm font-semibold text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >
        <Plus className="size-4" />
        Nova coluna
      </button>
    );
  }

  return (
    <form
      onSubmit={criar}
      className="glass relative h-fit w-64 shrink-0 rounded-[28px] p-4"
    >
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--color-muted)]">Nova coluna</p>
      <input
        autoFocus
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        maxLength={60}
        placeholder="Ex.: Avaliação agendada"
        className="mt-2 w-full rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]"
      />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {CORES_COLUNA.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCor(c)}
            aria-label={`Cor ${c}`}
            className={cn("size-6 rounded-full ring-offset-2 ring-offset-[var(--color-surface)]", cor === c && "ring-2 ring-[var(--color-text)]")}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-muted)]">Entra antes de Ganho e Perdido. Dá para mover depois pelo menu ⋯.</p>
      {erro && <p className="mt-2 text-xs text-[var(--color-hot)]">{erro}</p>}
      <div className="mt-3 flex gap-2">
        <button
          disabled={salvando || !nome.trim()}
          className="flex-1 rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
        >
          {salvando ? "Criando…" : "Criar"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="rounded-full border px-3 py-1.5 text-sm text-[var(--color-muted)]">
          Cancelar
        </button>
      </div>
    </form>
  );
}
