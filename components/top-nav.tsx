"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  KanbanSquare,
  LogOut,
  MessageCircle,
  Settings,
  Sun,
} from "lucide-react";
import type { Usuario } from "@/lib/auth/usuario";
import { ehAdministrador, NOME_PAPEL } from "@/lib/auth/papeis";
import { cn } from "@/lib/utils";
import { AoVivo } from "@/components/ao-vivo";

const NAV = [
  // "Hoje" vem primeiro: e a tela que diz o que fazer, nao a que mostra o estado.
  { href: "/hoje", label: "Hoje", icone: Sun },
  { href: "/calendario", label: "Calendário", icone: CalendarDays },
  { href: "/funil", label: "Funil", icone: KanbanSquare },
  { href: "/metricas", label: "Métricas", icone: BarChart3 },
  { href: "/playbook", label: "Playbook", icone: BookOpen },
  { href: "/conexao", label: "Conexão", icone: MessageCircle },
  { href: "/configuracoes", label: "Configurações", icone: Settings },
];

export function TopNav({ usuario }: { usuario: Usuario | null }) {
  const pathname = usePathname();
  const ativo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // A tela de login é só o formulário; o "Ao vivo" também não roda ali,
  // porque sem sessão o canal de avisos recusaria a conexão.
  if (pathname === "/login" || !usuario) return null;

  return (
    <header className="relative z-30 flex shrink-0 items-center gap-3 px-4 pt-4 sm:gap-4 sm:px-8 sm:pt-5">
      <Link href="/hoje" className="group flex shrink-0 items-center gap-2.5">
        <span className="relative grid size-11 place-items-center rounded-full">
          {/* Halo laranja atrás do selo, como uma luz refletida no vidro. */}
          <span className="absolute inset-0 rounded-full bg-[var(--color-accent)]/30 blur-md transition-opacity group-hover:opacity-100 sm:opacity-60" />
          <Image
            src="/brand/resenha-selo.png"
            alt="Resenha TV"
            width={44}
            height={44}
            priority
            className="relative size-11 rounded-full ring-1 ring-white/15"
          />
        </span>
        <span className="hidden leading-none sm:block">
          <span className="display block text-lg text-[var(--color-accent)]">Resenha TV</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--color-muted)]">
            CRM
          </span>
        </span>
      </Link>

      {/* Barra de vidro flutuante; o item atual ganha a "bolha" de vidro. */}
      <nav className="glass no-scrollbar relative mx-auto flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full p-1.5">
        {NAV.filter(({ href }) => href !== "/conexao" || ehAdministrador(usuario.role)).map(({ href, label, icone: Icone }) => (
          <Link
            key={href}
            href={href}
            title={label}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm transition-all duration-300 lg:px-4",
              ativo(href)
                ? "bolha font-semibold text-white"
                : "text-[var(--color-muted)] hover:bg-white/[0.06] hover:text-[var(--color-text)]",
            )}
          >
            <Icone className={cn("size-4", ativo(href) && "text-[var(--color-accent)]")} strokeWidth={ativo(href) ? 2.4 : 2} />
            <span className="hidden lg:inline">{label}</span>
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
        className="grid size-11 place-items-center rounded-full bg-gradient-to-br from-[var(--color-accent)]/35 to-white/[0.04] text-sm font-bold shadow-[inset_0_1px_0_rgb(255_255_255/0.3),inset_0_0_0_1px_rgb(255_255_255/0.12)] backdrop-blur-xl transition-transform hover:scale-105"
      >
        {iniciais || "?"}
      </button>

      {aberto && (
        <div className="glass-forte absolute right-0 top-full z-40 mt-2 w-64 rounded-3xl p-2">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{usuario.name}</p>
            <p className="truncate text-xs text-[var(--color-muted)]">{usuario.email}</p>
            <span className="mt-1.5 inline-block rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-accent)]">
              {NOME_PAPEL[usuario.role]}
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
