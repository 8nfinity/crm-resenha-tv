"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { dataHora } from "@/lib/atividades";
import { cn } from "@/lib/utils";

type Linha = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "VENDEDOR";
  active: boolean;
  lastLoginAt: string | null;
};

async function enviar(url: string, method: string, corpo: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  }).catch(() => null);
  if (!res) return "Sem conexão com o servidor.";
  if (res.ok) return null;
  return (await res.json().catch(() => null))?.error ?? "Não deu certo. Tente de novo.";
}

const campo =
  "w-full rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]";

// ─── Minha conta ─────────────────────────────────────────────────────────────

export function MinhaConta({ nome, email }: { nome: string; email: string }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function trocar(e: React.FormEvent) {
    e.preventDefault();
    if (nova !== confirma) return setMsg({ ok: false, texto: "A confirmação não é igual à senha nova." });
    setSalvando(true);
    const erro = await enviar("/api/conta/senha", "PATCH", { atual, nova });
    setSalvando(false);
    if (erro) return setMsg({ ok: false, texto: erro });
    setAtual("");
    setNova("");
    setConfirma("");
    setMsg({ ok: true, texto: "Senha trocada. Outros aparelhos com este acesso foram desconectados." });
  }

  return (
    <div>
      <p className="text-sm">
        <span className="font-semibold">{nome}</span>{" "}
        <span className="text-[var(--color-muted)]">· {email}</span>
      </p>
      <form onSubmit={trocar} className="mt-3 grid gap-2 sm:grid-cols-3">
        <input type="password" autoComplete="current-password" required value={atual} onChange={(e) => setAtual(e.target.value)} placeholder="Senha atual" className={campo} />
        <input type="password" autoComplete="new-password" required value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Senha nova (mín. 8)" className={campo} />
        <input type="password" autoComplete="new-password" required value={confirma} onChange={(e) => setConfirma(e.target.value)} placeholder="Confirme a senha nova" className={campo} />
        <button
          disabled={salvando}
          className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50 sm:col-span-3"
        >
          <KeyRound className="size-4" />
          {salvando ? "Trocando…" : "Trocar senha"}
        </button>
      </form>
      {msg && (
        <p className={cn("mt-2 text-xs", msg.ok ? "text-[var(--color-accent)]" : "text-[var(--color-hot)]")}>{msg.texto}</p>
      )}
    </div>
  );
}

// ─── Usuários (administrador) ────────────────────────────────────────────────

export function GerenciarUsuarios({ meuId }: { meuId: string }) {
  const [lista, setLista] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState({ name: "", email: "", senha: "", role: "VENDEDOR" as Linha["role"] });
  const [criando, setCriando] = useState(false);
  const [resetando, setResetando] = useState<string | null>(null);
  const [senhaReset, setSenhaReset] = useState("");

  const carregar = useCallback(async () => {
    const res = await fetch("/api/usuarios").catch(() => null);
    if (res?.ok) setLista(await res.json());
  }, []);
  useEffect(() => void carregar(), [carregar]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setCriando(true);
    const falha = await enviar("/api/usuarios", "POST", novo);
    setCriando(false);
    setErro(falha);
    if (!falha) {
      setNovo({ name: "", email: "", senha: "", role: "VENDEDOR" });
      void carregar();
    }
  }

  async function alterar(id: string, corpo: Record<string, unknown>) {
    const falha = await enviar(`/api/usuarios/${id}`, "PATCH", corpo);
    setErro(falha);
    if (!falha) {
      setResetando(null);
      setSenhaReset("");
      void carregar();
    }
  }

  return (
    <div>
      <form onSubmit={criar} className="grid gap-2 rounded-2xl border border-[var(--color-border)] p-3 sm:grid-cols-2">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--color-muted)] sm:col-span-2">Novo acesso</p>
        <input required value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} placeholder="Nome (ex.: Henrique)" className={campo} />
        <input required type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} placeholder="E-mail" className={campo} />
        <input required type="text" autoComplete="off" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} placeholder="Senha inicial (mín. 8)" className={campo} />
        <select value={novo.role} onChange={(e) => setNovo({ ...novo, role: e.target.value as Linha["role"] })} className={campo}>
          <option value="VENDEDOR">Vendedor</option>
          <option value="ADMIN">Administrador</option>
        </select>
        <button
          disabled={criando}
          className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
        >
          <UserPlus className="size-4" />
          {criando ? "Criando…" : "Criar acesso"}
        </button>
        <p className="self-center text-[11px] text-[var(--color-muted)]">Passe a senha à pessoa; ela troca em “Minha conta”.</p>
      </form>

      {erro && <p className="mt-2 text-xs text-[var(--color-hot)]">{erro}</p>}

      <ul className="mt-3 flex flex-col gap-2">
        {lista === null && <li className="text-sm text-[var(--color-muted)]">Carregando…</li>}
        {lista?.map((u) => (
          <li key={u.id} className={cn("rounded-2xl bg-[var(--color-surface-2)] p-3", !u.active && "opacity-55")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{u.name}</span>
              {u.id === meuId && <span className="text-[10px] text-[var(--color-muted)]">(você)</span>}
              <span className="text-xs text-[var(--color-muted)]">{u.email}</span>
              {!u.active && (
                <span className="rounded-full bg-[color-mix(in_srgb,var(--color-hot)_18%,transparent)] px-2 text-[10px] font-bold text-[var(--color-hot)]">
                  Desativado
                </span>
              )}
              <select
                value={u.role}
                onChange={(e) => void alterar(u.id, { role: e.target.value })}
                className="ml-auto rounded-full bg-[var(--color-surface)] px-3 py-1 text-xs outline-none"
              >
                <option value="VENDEDOR">Vendedor</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--color-muted)]">
                Último acesso: {u.lastLoginAt ? dataHora(u.lastLoginAt) : "nunca"}
              </span>
              <span className="ml-auto flex gap-2">
                <button onClick={() => setResetando(resetando === u.id ? null : u.id)} className="rounded-full border px-3 py-1 hover:text-[var(--color-text)]">
                  Definir senha
                </button>
                <button
                  onClick={() => void alterar(u.id, { active: !u.active })}
                  className={cn("rounded-full border px-3 py-1", u.active ? "text-[var(--color-hot)]" : "text-[var(--color-accent)]")}
                >
                  {u.active ? "Desativar" : "Reativar"}
                </button>
              </span>
            </div>
            {resetando === u.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void alterar(u.id, { senha: senhaReset });
                }}
                className="mt-2 flex gap-2"
              >
                <input autoFocus type="text" autoComplete="off" value={senhaReset} onChange={(e) => setSenhaReset(e.target.value)} placeholder="Nova senha (mín. 8)" className={campo} />
                <button className="shrink-0 rounded-full bg-[var(--color-ink)] px-4 text-sm font-semibold text-[var(--color-on-ink)]">Salvar</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
