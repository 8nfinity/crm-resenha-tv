import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Peças visuais compartilhadas pelas telas: o título grande de duas linhas, o
 * indicador com o botão redondo "↗" e o cabeçalho de card.
 */

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  /** Use "\n" para quebrar o título em duas linhas, como no painel. */
  title: string;
  subtitle?: React.ReactNode;
  /** Controles alinhados à direita (filtros de período, exportar…). */
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-4 pb-5 pt-6 sm:px-8 sm:pt-8">
      <div className="min-w-0">
        <h1 className="display text-3xl leading-[0.95] sm:text-5xl">
          {title.split("\n").map((linha, i, linhas) => (
            <span
              key={i}
              className={cn(
                // Texto com leve degradê (luz vindo de cima), como nos títulos
                // da Apple. A última linha em verde, como o "BIOMECH" do material.
                "block bg-clip-text pb-[0.06em] text-transparent",
                linhas.length > 1 && i === linhas.length - 1
                  ? "bg-gradient-to-r from-[var(--color-accent)] via-[#7ff0b4] to-[#d6ffe8]"
                  : "bg-gradient-to-b from-white to-white/70",
              )}
            >
              {linha}
            </span>
          ))}
        </h1>
        <span className="mt-4 block h-[3px] w-24 rounded-full bg-[var(--color-yellow)]" />
        {subtitle && (
          <p className="mt-3 text-sm text-[var(--color-muted)]">{subtitle}</p>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** Número em destaque com rótulo, legenda e — opcional — o botão "↗". */
export function Kpi({
  label,
  value,
  caption,
  href,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  href?: string;
  tone?: "accent" | "hot";
  className?: string;
}) {
  return (
    <div className={cn("flex items-end gap-6", className)}>
      <div className="min-w-0">
        <p className="text-sm text-[var(--color-muted)]">{label}</p>
        <p
          className={cn(
            "mt-2 text-3xl font-semibold tabular-nums tracking-tight",
            tone === "accent" && "text-[var(--color-accent-strong)]",
            tone === "hot" && "text-[var(--color-hot)]",
          )}
        >
          {value}
        </p>
        {caption && (
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{caption}</p>
        )}
      </div>
      {href && (
        <Link href={href} className="icon-btn" aria-label={`Abrir ${label}`}>
          <ArrowUpRight className="size-4" />
        </Link>
      )}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  children,
  dark,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        {description && (
          <p
            className={cn(
              "mt-1 max-w-prose text-xs",
              "text-[var(--color-muted)]",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** Pílula de seleção: vidro quando solta, "bolha" de vidro verde quando ativa. */
export function Pill({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-4 py-2 text-sm transition-all duration-300",
        active
          ? "bolha font-semibold text-white"
          : "bg-[var(--color-surface)] text-[var(--color-muted)] shadow-[var(--shadow-card)] backdrop-blur-2xl hover:text-[var(--color-text)]",
      )}
    >
      {children}
    </Link>
  );
}
