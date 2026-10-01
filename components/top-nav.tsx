"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import type { Usuario } from "@/lib/auth/usuario";
import { cn } from "@/lib/utils";
import { AoVivo } from "@/components/ao-vivo";

const NAV = [
  // "Hoje" vem primeiro: e a tela que diz o que fazer, nao a que mostra o estado.
  { href: "/hoje", label: "Hoje" },
  { href: "/calendario", label: "Calendário" },
  { href: "/funil", label: "Funil" },
  { href: "/metricas", label: "Métricas" },
  { href: "/playbook", label: "Playbook" },
  { href: "/conexao", label: "Conexão" },
  { href: "/configuracoes", label: "Configurações" },
];

export function TopNav({ usuario }: { usuario: Usuario | null }) {
  const pathname = usePathname();
  const ativo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // A tela de login é só o formulário; o "Ao vivo" também não roda ali,
  // porque sem sessão o canal de avisos recusaria a conexão.
  if (pathname === "/login" || !usuario) return null;

  return (
    <header className="flex shrink-0 items-center gap-4 px-4 pt-4 sm:px-8 sm:pt-6">
      <Link href="/hoje" className="flex shrink-0 items-center gap-2.5">
        <Image
          src="/brand/selo.png"
          alt="Instituto Biomech"
          width={44}
          height={44}
          priority
          className="size-11 rounded-full ring-1 ring-[var(--color-line)]/40"
        />
        <span className="leading-none">
          <span className="display block text-lg text-[var(--color-accent)]">Biomech</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-muted)]">
            CRM
          </span>
        </span>
      </Link>

      <nav className="no-scrollbar mx-auto flex min-w-0 items-center gap-1 overflow-x-auto">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-sm transition-colors",
              ativo(href)
                ? "bg-[var(--color-ink)] font-medium text-[var(--color-on-ink)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <AoVivo />

      <MenuUsuario usuario={usuario} />
    </header>
  );
}

/** Círculo com as iniciais; abre o menu com conta e sair. */
function MenuUsuario({ usuario }: { usuario: Usuario }) {
  const [aberto, setAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  async function sair() {
    setSaindo(true);
    await fetch("/api/auth/sair", { method: "POST" }).catch(() => null);
    window.location.assign("/login");
  }

  const iniciais = usuario.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="relative shrink-0" ref={caixa}>
      <button
        onClick={() => setAberto((a) => !a)}
        aria-label={`Conta de ${usuario.name}`}
        className="grid size-10 place-items-center rounded-full bg-[var(--color-surface-2)] text-sm font-bold ring-1 ring-[var(--color-border)] transition-colors hover:ring-[var(--color-accent)]"
      >
        {iniciais || "?"}
      </button>

      {aberto && (
        <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-2xl">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{usuario.name}</p>
            <p className="truncate text-xs text-[var(--color-muted)]">{usuario.email}</p>
            <span className="mt-1.5 inline-block rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-accent)]">
              {usuario.role === "ADMIN" ? "Administrador" : "Vendedor"}
            </span>
          </div>
          <div className="my-1 border-t" />
          <Link
            href="/configuracoes#conta"
            onClick={() => setAberto(false)}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]"
          >
            <Settings className="size-4" />
            Minha conta e configurações
          </Link>
          <button
            onClick={() => void sair()}
            disabled={saindo}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--color-hot)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            <LogOut className="size-4" />
            {saindo ? "Saindo…" : "Sair"}
          </button>
        </div>
      )}
    </div>
  );
}
