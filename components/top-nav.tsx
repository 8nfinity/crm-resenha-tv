"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  KanbanSquare,
  LogOut,
  MessageCircle,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import type { Usuario } from "@/lib/auth/usuario";
import { ehAdministrador, NOME_PAPEL } from "@/lib/auth/papeis";
import { cn } from "@/lib/utils";
import { AoVivo, EVENTO_MUDOU } from "@/components/ao-vivo";

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

/** Nome de cada tela na barra de topo, como o Pipedrive mostra "Negócios". */
const TITULOS: Record<string, string> = {
  "/hoje": "Agenda de hoje",
  "/calendario": "Atividades",
  "/funil": "Funil de vendas",
  "/metricas": "Métricas",
  "/playbook": "Playbook",
  "/conexao": "Conexão com o WhatsApp",
  "/configuracoes": "Configurações",
};

/**
 * Menu lateral preto e estreito, no molde do Pipedrive: a TV da Resenha no
 * alto e um ícone com nome curto por tela; a atual ganha o laranja e um
 * traço à esquerda.
 */
/**
 * Atividades em aberto marcadas para hoje (no relógio de quem vê), para o
 * número no ícone do Calendário. Busca ao abrir, a cada aviso do "Ao vivo"
 * (atividade criada, feita, apagada), ao voltar para a aba e a cada minuto.
 */
function usePendentesDeHoje(ligado: boolean) {
  const [dados, setDados] = useState<{ pendentes: number; atrasadas: number } | null>(null);

  useEffect(() => {
    if (!ligado) return;
    let vivo = true;
    async function buscar() {
      const agora = new Date();
      const de = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
      const ate = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
      const res = await fetch(
        `/api/activities/hoje?de=${encodeURIComponent(de.toISOString())}&ate=${encodeURIComponent(ate.toISOString())}`,
      ).catch(() => null);
      if (vivo && res?.ok) setDados(await res.json());
    }
    void buscar();
    const t = setInterval(() => void buscar(), 60_000);
    const aoMudar = () => void buscar();
    const aoVoltar = () => document.visibilityState === "visible" && void buscar();
    window.addEventListener(EVENTO_MUDOU, aoMudar);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      vivo = false;
      clearInterval(t);
      window.removeEventListener(EVENTO_MUDOU, aoMudar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [ligado]);

  return dados;
}

export function MenuLateral({ usuario }: { usuario: Usuario | null }) {
  const pathname = usePathname();
  const hoje = usePendentesDeHoje(pathname !== "/login" && usuario !== null);
  const ativo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // A tela de login é só o formulário.
  if (pathname === "/login" || !usuario) return null;

  return (
    <aside className="z-30 flex w-[76px] shrink-0 flex-col items-center gap-1 bg-black py-3">
      <Link href="/hoje" className="mb-3 grid place-items-center" title="Resenha TV · CRM">
        <Image
          src="/brand/resenha-selo.png"
          alt="Resenha TV"
          width={44}
          height={44}
          priority
          className="size-11 rounded-full ring-1 ring-white/15 transition-transform hover:scale-105"
        />
      </Link>

      <nav className="no-scrollbar flex w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto">
        {NAV.filter(({ href }) => href !== "/conexao" || ehAdministrador(usuario.role)).map(({ href, label, icone: Icone }) => (
          <Link
            key={href}
            href={href}
            title={label}
            className={cn(
              "relative flex w-[64px] flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-semibold transition-colors",
              ativo(href)
                ? "bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[var(--color-text)]"
                : "text-[var(--color-muted)] hover:bg-white/[0.06] hover:text-[var(--color-text)]",
            )}
          >
            {ativo(href) && <span className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-full bg-[var(--color-accent)]" />}
            <span className="relative">
              <Icone className={cn("size-5", ativo(href) && "text-[var(--color-accent)]")} strokeWidth={ativo(href) ? 2.4 : 2} />
              {/* No Calendário: quantas atividades ainda faltam hoje. Vermelho
                  quando alguma já passou do horário. */}
              {href === "/calendario" && hoje && hoje.pendentes > 0 && (
                <span
                  title={`${hoje.pendentes} ${hoje.pendentes === 1 ? "atividade pendente" : "atividades pendentes"} hoje${
                    hoje.atrasadas > 0 ? ` · ${hoje.atrasadas} já ${hoje.atrasadas === 1 ? "passou" : "passaram"} do horário` : ""
                  }`}
                  className={cn(
                    "absolute -right-2.5 -top-2 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums ring-2 ring-black",
                    hoje.atrasadas > 0 ? "bg-[var(--color-hot)] text-white" : "bg-[var(--color-accent)] text-[var(--color-on-ink)]",
                  )}
                >
                  {hoje.pendentes > 99 ? "99+" : hoje.pendentes}
                </span>
              )}
            </span>
            <span className="max-w-full truncate">{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

/**
 * Barra de topo: o nome da tela, a busca de leads (vai para o funil já
 * filtrado), o "Ao vivo" e o usuário.
 */
export function BarraTopo({ usuario }: { usuario: Usuario | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busca, setBusca] = useState("");

  if (pathname === "/login" || !usuario) return null;
  const titulo = Object.entries(TITULOS).find(([h]) => pathname === h || pathname.startsWith(`${h}/`))?.[1] ?? "";

  return (
    <header className="z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-[var(--color-panel)] px-4 sm:px-6">
      <h1 className="truncate text-base font-bold sm:text-lg">{titulo}</h1>

      <form
        className="relative mx-auto hidden w-full max-w-md md:block"
        onSubmit={(e) => {
          e.preventDefault();
          const termo = busca.trim();
          if (termo) router.push(`/funil?busca=${encodeURIComponent(termo)}`);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar lead por nome ou telefone…"
          aria-label="Buscar lead"
          className="w-full rounded-md border bg-[var(--color-surface)] py-1.5 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
        />
      </form>

      <div className="ml-auto flex shrink-0 items-center gap-3 md:ml-0">
        <AoVivo />
        <MenuUsuario usuario={usuario} />
      </div>
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
        className="grid size-9 place-items-center rounded-full bg-[var(--color-accent)] text-xs font-bold text-[var(--color-on-ink)] transition-transform hover:scale-105"
      >
        {iniciais || "?"}
      </button>

      {aberto && (
        <div className="glass-forte absolute right-0 top-full z-40 mt-2 w-64 rounded-lg p-2">
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
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]"
          >
            <Settings className="size-4" />
            Minha conta e configurações
          </Link>
          <button
            onClick={() => void sair()}
            disabled={saindo}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-hot)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            <LogOut className="size-4" />
            {saindo ? "Saindo…" : "Sair"}
          </button>
        </div>
      )}
    </div>
  );
}
