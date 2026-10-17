"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, ChevronDown, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEhAdmin } from "@/components/sessao";
import { COOKIE_FUNIL } from "@/lib/funil-cookie";
import { cn } from "@/lib/utils";

type FunilComColunas = {
  id: string;
  name: string;
  leads: number;
  stages: { id: string; name: string; isWon: boolean; isLost: boolean }[];
};

/** Lembra o funil escolhido: o próximo "Funil" abre direto nele. */
function lembrar(id: string) {
  document.cookie = `${COOKIE_FUNIL}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
}

async function enviar(url: string, init: RequestInit): Promise<{ ok: boolean; erro?: string; corpo?: { id?: string } }> {
  const res = await fetch(url, init).catch(() => null);
  if (!res) return { ok: false, erro: "Sem conexão com o servidor." };
  const corpo = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, corpo };
  return { ok: false, erro: corpo.error ?? "Não deu certo. Tente de novo." };
}

/**
 * Seletor de funis, no molde do Pipedrive: a lista com o atual marcado, e,
 * para administradores, lápis para renomear, setas para reordenar, lixeira
 * e "Novo funil".
 */
export function SeletorDeFunil({ atual }: { atual: { id: string; name: string } }) {
  const router = useRouter();
  const admin = useEhAdmin();
  const [aberto, setAberto] = useState(false);
  const [funis, setFunis] = useState<FunilComColunas[] | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [excluindo, setExcluindo] = useState<FunilComColunas | null>(null);
  const [destino, setDestino] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  async function carregar() {
    const res = await fetch("/api/pipelines").catch(() => null);
    if (res?.ok) setFunis(await res.json());
  }

  useEffect(() => {
    if (aberto) void carregar();
  }, [aberto]);

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
    setEditando(null);
    setCriando(false);
    setExcluindo(null);
    setDestino("");
    setErro(null);
  }

  function abrirFunil(id: string) {
    lembrar(id);
    fechar();
    router.push(`/funil?funil=${encodeURIComponent(id)}`);
  }

  async function aplicar(url: string, init: RequestInit) {
    setSalvando(true);
    setErro(null);
    const r = await enviar(url, init);
    setSalvando(false);
    if (!r.ok) setErro(r.erro ?? null);
    return r;
  }

  const json = (metodo: string, corpo: object): RequestInit => ({
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

  async function salvarNome(id: string) {
    if (!nome.trim()) return;
    const r = await aplicar(`/api/pipelines/${id}`, json("PATCH", { name: nome.trim() }));
    if (r.ok) {
      setEditando(null);
      await carregar();
      router.refresh();
    }
  }

  async function mover(id: string, sentido: "cima" | "baixo") {
    const r = await aplicar(`/api/pipelines/${id}`, json("PATCH", { mover: sentido }));
    if (r.ok) await carregar();
  }

  async function criar() {
    if (!nome.trim()) return;
    const r = await aplicar("/api/pipelines", json("POST", { name: nome.trim() }));
    if (r.ok && r.corpo?.id) abrirFunil(r.corpo.id);
  }

  async function excluir(f: FunilComColunas) {
    const sp = destino ? `?moverPara=${encodeURIComponent(destino)}` : "";
    const r = await aplicar(`/api/pipelines/${f.id}${sp}`, { method: "DELETE" });
    if (r.ok) {
      setExcluindo(null);
      setDestino("");
      if (f.id === atual.id) {
        const outro = funis?.find((x) => x.id !== f.id);
        if (outro) abrirFunil(outro.id);
      } else {
        await carregar();
      }
    }
  }

  const campo =
    "w-full rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]";

  return (
    <div className="relative" ref={caixa}>
      <button
        onClick={() => (aberto ? fechar() : setAberto(true))}
        className="bolha inline-flex max-w-72 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white"
        aria-haspopup="menu"
        aria-expanded={aberto}
      >
        <span className="truncate">{atual.name}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", aberto && "rotate-180")} />
      </button>

      {aberto && (
        <div className="glass-forte absolute left-0 top-full z-40 mt-2 w-80 rounded-3xl p-2" role="menu">
          {!funis ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-[var(--color-muted)]">
              <Loader2 className="size-4 animate-spin" /> Carregando funis…
            </p>
          ) : excluindo ? (
            <div className="p-2">
              <p className="text-sm font-semibold">Excluir o funil “{excluindo.name}”?</p>
              {excluindo.leads > 0 ? (
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Os {excluindo.leads} {excluindo.leads === 1 ? "lead deste funil vai" : "leads deste funil vão"} para:
                </p>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Se já passou lead por aqui, escolha onde somar o histórico (as métricas não perdem o passado). Sem histórico, pode deixar em branco.
                </p>
              )}
              <select value={destino} onChange={(e) => setDestino(e.target.value)} className={cn(campo, "mt-2")}>
                <option value="">Escolha a coluna…</option>
                {funis
                  .filter((f) => f.id !== excluindo.id)
                  .map((f) => (
                    <optgroup key={f.id} label={f.name}>
                      {f.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </select>
              <div className="mt-2 flex gap-2">
                <button
                  disabled={salvando || (excluindo.leads > 0 && !destino)}
                  onClick={() => void excluir(excluindo)}
                  className="flex-1 rounded-full bg-[var(--color-hot)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {salvando ? "Excluindo…" : "Excluir funil"}
                </button>
                <button onClick={() => setExcluindo(null)} className="rounded-full border px-3 py-1.5 text-sm text-[var(--color-muted)]">
                  Voltar
                </button>
              </div>
            </div>
          ) : (
            <>
              <ul>
                {funis.map((f, i) => (
                  <li key={f.id}>
                    {editando === f.id ? (
                      <form
                        className="flex items-center gap-1 p-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void salvarNome(f.id);
                        }}
                      >
                        <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} className={campo} />
                        <button disabled={salvando} className="rounded-full p-1.5 text-[var(--color-accent)] hover:bg-[var(--color-surface-2)]" aria-label="Salvar">
                          <Check className="size-4" />
                        </button>
                        <button type="button" onClick={() => setEditando(null)} className="rounded-full p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]" aria-label="Cancelar">
                          <X className="size-4" />
                        </button>
                      </form>
                    ) : (
                      <div
                        className={cn(
                          "group flex items-center gap-1 rounded-2xl px-1 py-0.5",
                          f.id === atual.id ? "bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)]" : "hover:bg-[var(--color-surface-2)]",
                        )}
                      >
                        <button onClick={() => abrirFunil(f.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm" role="menuitem">
                          <span className={cn("truncate", f.id === atual.id && "font-semibold")}>{f.name}</span>
                          <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-muted)]">{f.leads}</span>
                          {f.id === atual.id && <Check className="ml-auto size-4 shrink-0 text-[var(--color-accent)]" />}
                        </button>
                        {admin && (
                          <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <BotaoIcone rotulo="Subir" onClick={() => void mover(f.id, "cima")} desligado={i === 0}>
                              <ArrowUp className="size-3.5" />
                            </BotaoIcone>
                            <BotaoIcone rotulo="Descer" onClick={() => void mover(f.id, "baixo")} desligado={i === funis.length - 1}>
                              <ArrowDown className="size-3.5" />
                            </BotaoIcone>
                            <BotaoIcone
                              rotulo="Renomear"
                              onClick={() => {
                                setNome(f.name);
                                setEditando(f.id);
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </BotaoIcone>
                            {funis.length > 1 && (
                              <BotaoIcone rotulo="Excluir" perigo onClick={() => setExcluindo(f)}>
                                <Trash2 className="size-3.5" />
                              </BotaoIcone>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {admin && (
                <div className="mt-1 border-t pt-1">
                  {criando ? (
                    <form
                      className="p-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void criar();
                      }}
                    >
                      <input
                        autoFocus
                        value={nome}
                        onChange={(e) => setNome(e.target.value)}
                        maxLength={60}
                        placeholder="Ex.: Captação, Relacionamento…"
                        className={campo}
                      />
                      <p className="mt-1.5 px-1 text-[11px] text-[var(--color-muted)]">
                        Nasce com as colunas Novo lead, Em contato, Ganho e Perdido. Dá para renomear e criar outras depois.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button disabled={salvando || !nome.trim()} className="flex-1 rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50">
                          {salvando ? "Criando…" : "Criar funil"}
                        </button>
                        <button type="button" onClick={() => setCriando(false)} className="rounded-full border px-3 py-1.5 text-sm text-[var(--color-muted)]">
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => {
                        setNome("");
                        setEditando(null);
                        setCriando(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[var(--color-accent)] hover:bg-[var(--color-surface-2)]"
                    >
                      <Plus className="size-4" /> Novo funil
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {erro && <p className="px-3 pb-1 pt-2 text-xs text-[var(--color-hot)]">{erro}</p>}
        </div>
      )}
    </div>
  );
}

function BotaoIcone({
  rotulo,
  onClick,
  desligado,
  perigo,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  desligado?: boolean;
  perigo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={desligado}
      aria-label={rotulo}
      title={rotulo}
      className={cn(
        "grid size-7 place-items-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-30",
        perigo ? "hover:text-[var(--color-hot)]" : "hover:text-[var(--color-text)]",
      )}
    >
      {children}
    </button>
  );
}
