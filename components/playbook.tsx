"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowDown, ArrowUp, BookOpen, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { dataHora } from "@/lib/atividades";
import { MODELO_PLAYBOOK } from "@/lib/playbook-modelo";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

type Secao = { id: string; title: string; body: string; updatedAt: string };

async function chamar(url: string, method: string, corpo?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }).catch(() => null);
  return res?.ok ? res.json().catch(() => ({})) : null;
}

/**
 * Playbook comercial: índice com busca à esquerda, leitura à direita.
 *
 * Qualquer pessoa do time lê; editar abre o texto em Markdown com a prévia
 * ao lado. O que for salvo aparece na hora para quem estiver com a tela
 * aberta (o "Ao vivo" recarrega os dados).
 */
export function Playbook({ secoes }: { secoes: Secao[] }) {
  const router = useRouter();
  const [atualId, setAtualId] = useState<string | null>(secoes[0]?.id ?? null);
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  // Seção apagada (aqui ou em outra tela): cai na primeira que existir.
  useEffect(() => {
    if (!secoes.some((s) => s.id === atualId)) setAtualId(secoes[0]?.id ?? null);
  }, [secoes, atualId]);

  const atual = secoes.find((s) => s.id === atualId) ?? null;

  const termo = busca.trim().toLowerCase();
  const filtradas = useMemo(
    () =>
      termo
        ? secoes.filter((s) => s.title.toLowerCase().includes(termo) || s.body.toLowerCase().includes(termo))
        : secoes,
    [secoes, termo],
  );

  function abrir(id: string) {
    setAtualId(id);
    setEditando(false);
    setConfirmarExclusao(false);
  }

  function comecarEdicao(s: Secao) {
    setTitulo(s.title);
    setTexto(s.body);
    setEditando(true);
  }

  async function salvar() {
    if (!atual || !titulo.trim()) return;
    setSalvando(true);
    const ok = await chamar(`/api/playbook/${atual.id}`, "PATCH", { title: titulo.trim(), body: texto });
    setSalvando(false);
    if (ok) {
      setEditando(false);
      router.refresh();
    }
  }

  // Trava de clique duplo: dois cliques rápidos criavam o modelo inteiro duas
  // vezes (seções repetidas no índice).
  const [criando, setCriando] = useState(false);

  async function novaSecao() {
    if (criando) return;
    setCriando(true);
    const criadas = await chamar("/api/playbook", "POST", { title: "Nova seção", body: "" });
    setCriando(false);
    if (Array.isArray(criadas) && criadas[0]) {
      setAtualId(criadas[0].id);
      setTitulo(criadas[0].title);
      setTexto("");
      setEditando(true);
      router.refresh();
    }
  }

  async function usarModelo() {
    if (criando) return;
    setCriando(true);
    const criadas = await chamar("/api/playbook", "POST", MODELO_PLAYBOOK);
    setCriando(false);
    if (Array.isArray(criadas) && criadas[0]) setAtualId(criadas[0].id);
    router.refresh();
  }

  async function mover(id: string, direcao: "cima" | "baixo") {
    await chamar(`/api/playbook/${id}`, "PATCH", { mover: direcao });
    router.refresh();
  }

  async function excluir() {
    if (!atual) return;
    await chamar(`/api/playbook/${atual.id}`, "DELETE");
    setConfirmarExclusao(false);
    setEditando(false);
    router.refresh();
  }

  return (
    <div className="scroll-thin flex-1 overflow-y-auto pb-10">
      <PageHeader
        title={"Playbook\ncomercial"}
        subtitle="O material de consulta do time: avaliações, roteiros, objeções e processos."
      >
        <button
          onClick={() => void novaSecao()}
          disabled={criando}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
        >
          <Plus className="size-4" />
          Nova seção
        </button>
      </PageHeader>

      {secoes.length === 0 ? (
        <div className="px-4 sm:px-8">
          <section className="card mx-auto max-w-xl p-10 text-center">
            <BookOpen className="mx-auto size-10 text-[var(--color-accent)]" />
            <h2 className="mt-4 text-lg font-bold">O playbook está vazio</h2>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Comece do zero com “Nova seção”, ou use o modelo: ele já traz a tabela das
              Avaliações 0 a 3 com os valores do Rodrigo e do Henrique, e tópicos de roteiro,
              objeções e follow-up para vocês completarem.
            </p>
            <button
              onClick={() => void usarModelo()}
              disabled={criando}
              className="mt-6 rounded-full bg-[var(--color-ink)] px-5 py-2.5 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
            >
              {criando ? "Criando…" : "Começar com o modelo"}
            </button>
          </section>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 px-4 sm:px-8 lg:grid-cols-[18rem_1fr]">
          <aside className="card h-fit p-4 lg:sticky lg:top-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-muted)]" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar no playbook…"
                className="w-full rounded-full bg-[var(--color-surface-2)] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>

            <nav className="mt-3 flex flex-col gap-0.5">
              {filtradas.map((s) => {
                const indice = secoes.findIndex((x) => x.id === s.id);
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "group flex items-center gap-1 rounded-xl pr-1 transition-colors",
                      s.id === atualId ? "bg-[var(--color-ink)] text-[var(--color-on-ink)]" : "hover:bg-[var(--color-surface-2)]",
                    )}
                  >
                    <button onClick={() => abrir(s.id)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm font-semibold">
                      <span className="mr-2 tabular-nums opacity-60">{indice + 1}.</span>
                      {s.title}
                    </button>
                    {!termo && (
                      <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                        <button onClick={() => void mover(s.id, "cima")} disabled={indice === 0} aria-label="Subir" className="rounded p-0.5 opacity-70 hover:opacity-100 disabled:opacity-20">
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button onClick={() => void mover(s.id, "baixo")} disabled={indice === secoes.length - 1} aria-label="Descer" className="rounded p-0.5 opacity-70 hover:opacity-100 disabled:opacity-20">
                          <ArrowDown className="size-3.5" />
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
              {termo && filtradas.length === 0 && (
                <p className="px-3 py-2 text-sm text-[var(--color-muted)]">Nada encontrado para “{busca}”.</p>
              )}
            </nav>
          </aside>

          {atual && (
            <article className="card min-w-0 p-6 sm:p-8">
              {editando ? (
                <>
                  <input
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                    maxLength={120}
                    placeholder="Título da seção"
                    className="w-full rounded-xl bg-[var(--color-surface-2)] px-4 py-3 text-xl font-bold outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  />
                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                        Texto (Markdown)
                      </p>
                      <textarea
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        rows={22}
                        spellCheck
                        placeholder={"## Título\n\nTexto normal, **negrito**, *itálico*.\n\n- item de lista\n1. passo numerado\n\n> destaque"}
                        className="scroll-thin w-full resize-y rounded-xl bg-[var(--color-surface-2)] p-4 font-mono text-sm leading-relaxed outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]"
                      />
                      <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
                        ## título · **negrito** · *itálico* · - lista · 1. passos · &gt; destaque · | tabela |
                      </p>
                    </div>
                    <div>
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">Prévia</p>
                      <div className="markdown min-h-40 rounded-xl border border-[var(--color-border)] p-4">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{texto || "*Nada escrito ainda.*"}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => void salvar()}
                      disabled={salvando || !titulo.trim()}
                      className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
                    >
                      {salvando ? "Salvando…" : "Salvar"}
                    </button>
                    <button onClick={() => setEditando(false)} className="rounded-full border px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-2xl font-black uppercase tracking-tight">{atual.title}</h2>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">Atualizado em {dataHora(atual.updatedAt)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => comecarEdicao(atual)}
                        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]"
                      >
                        <Pencil className="size-3.5" />
                        Editar
                      </button>
                      <button
                        onClick={() => setConfirmarExclusao(true)}
                        aria-label="Excluir seção"
                        className="rounded-full border p-2 text-[var(--color-muted)] hover:text-[var(--color-hot)]"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {confirmarExclusao && (
                    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--color-hot)] p-3 text-sm">
                      <span>Excluir “{atual.title}”? Não dá para desfazer.</span>
                      <button onClick={() => void excluir()} className="rounded-full bg-[var(--color-hot)] px-3 py-1 font-semibold text-[var(--color-on-ink)]">
                        Excluir
                      </button>
                      <button onClick={() => setConfirmarExclusao(false)} className="text-[var(--color-muted)]">
                        Cancelar
                      </button>
                    </div>
                  )}

                  <div className="markdown mt-6">
                    {atual.body.trim() ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{atual.body}</ReactMarkdown>
                    ) : (
                      <p className="text-[var(--color-muted)]">Seção vazia. Clique em Editar para escrever.</p>
                    )}
                  </div>
                </>
              )}
            </article>
          )}
        </div>
      )}
    </div>
  );
}
