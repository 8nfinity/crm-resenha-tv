import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Peças visuais compartilhadas pelas telas, no layout do Pipedrive: a barra
 * de ferramentas da tela, o indicador compacto e o cabeçalho de quadro.
 */

/**
 * Barra de ferramentas da tela. O nome da tela já está na barra de topo (como
 * no Pipedrive); aqui fica o título curto com o traço das barras da TV, o
 * subtítulo e os controles à direita.
 */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  /** Quebra de linha vira espaço: o título é de uma linha só. Sem título
   *  (quando a barra de topo já diz o nome da tela), fica só o subtítulo. */
  title?: string;
  subtitle?: React.ReactNode;
  /** Controles alinhados à direita (filtros de período, exportar…). */
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b px-4 py-3 sm:px-6">
      <div className="min-w-0">
        {title ? (
          <>
            <h2 className="flex items-center gap-2.5 text-base font-bold">
              <span className="barras-tv h-4 w-1 shrink-0 rounded-full" aria-hidden />
              <span className="truncate">{title.replace(/\n/g, " ")}</span>
            </h2>
            {subtitle && <p className="mt-0.5 pl-3.5 text-xs text-[var(--color-muted)]">{subtitle}</p>}
          </>
        ) : (
          subtitle && (
            <p className="flex items-center gap-2.5 text-sm text-[var(--color-muted)]">
              <span className="barras-tv h-4 w-1 shrink-0 rounded-full" aria-hidden />
              {subtitle}
            </p>
          )
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
        <p className="text-xs font-semibold text-[var(--color-muted)]">{label}</p>
        <p
          className={cn(
            "mt-0.5 text-2xl font-bold tabular-nums tracking-tight",
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

/** Botão de seleção (período, funil): laranja quando ativo. */
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
        "rounded-md border px-3 py-1.5 text-sm transition-colors",
        active
          ? "bolha border-transparent font-semibold text-white"
          : "bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)]",
      )}
    >
      {children}
    </Link>
  );
}
