"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
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

export function TopNav() {
  const pathname = usePathname();
  const ativo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

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

      <Link
        href="/configuracoes"
        className="icon-btn hidden sm:inline-grid"
        aria-label="Configurações"
      >
        <Settings className="size-4" />
      </Link>
    </header>
  );
}
