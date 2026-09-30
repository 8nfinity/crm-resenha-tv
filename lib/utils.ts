import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "há 3 dias", "ontem", "hoje" — sem jogar uma data crua na cara do usuário. */
export function relativeDays(date: Date | string | null | undefined): string {
  if (!date) return "nunca";
  const d = typeof date === "string" ? new Date(date) : date;
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months === 1) return "há 1 mês";
  if (months < 12) return `há ${months} meses`;
  const years = Math.floor(months / 12);
  return years === 1 ? "há 1 ano" : `há ${years} anos`;
}

export function formatCurrency(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Iniciais para o avatar quando não há foto de perfil. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
