"use client";

import { useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";

export function FormLogin({ destino }: { destino: string }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEntrando(true);
    setErro(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha }),
    }).catch(() => null);

    if (res?.ok) {
      // Navegação completa (não a do Next): a página nova já nasce com o
      // cookie de sessão e o menu com o nome de quem entrou.
      window.location.assign(destino);
      return;
    }
    const corpo = await res?.json().catch(() => null);
    setErro(corpo?.error ?? "Sem conexão com o servidor. Tente de novo.");
    setEntrando(false);
  }

  const campo =
    "w-full rounded-md bg-[var(--color-surface-2)] px-4 py-3 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-accent)]";

  return (
    <form onSubmit={entrar} className="flex flex-col gap-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-[var(--color-muted)]">E-mail</span>
        <input
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@resenha.tv"
          className={campo}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-[var(--color-muted)]">Senha</span>
        <span className="relative block">
          <input
            type={mostrar ? "text" : "password"}
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className={`${campo} pr-12`}
          />
          <button
            type="button"
            onClick={() => setMostrar((m) => !m)}
            aria-label={mostrar ? "Esconder senha" : "Mostrar senha"}
            className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            {mostrar ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
      </label>

      {erro && (
        <p role="alert" className="rounded-md bg-[color-mix(in_srgb,var(--color-hot)_14%,transparent)] px-3 py-2 text-sm text-[var(--color-hot)]">
          {erro}
        </p>
      )}

      <button
        disabled={entrando}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-ink)] px-5 py-3 text-sm font-bold text-[var(--color-on-ink)] disabled:opacity-60"
      >
        <LogIn className="size-4" />
        {entrando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
