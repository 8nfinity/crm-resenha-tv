import { prisma } from "@/lib/db";

/**
 * Funis (Captação, Relacionamento, Processos Seletivos…).
 *
 * O lead está em um funil por vez — o da coluna onde ele está. Leads chegam
 * sozinhos por três caminhos, sem ninguém precisar escolher o funil:
 *   1. o número de WhatsApp tem um funil de entrada (lib/deals.ts);
 *   2. a etiqueta do WhatsApp aponta para uma coluna, de qualquer funil;
 *   3. alguém move o lead pelo painel.
 */

export type Funil = { id: string; name: string; order: number };

export async function listarFunis(): Promise<Funil[]> {
  return prisma.pipeline.findMany({
    orderBy: { order: "asc" },
    select: { id: true, name: true, order: true },
  });
}

/** O funil pedido, se existir; senão o primeiro. Nulo só sem funil nenhum. */
export function escolherFunil(funis: Funil[], pedido?: string | null): Funil | null {
  return funis.find((f) => f.id === pedido) ?? funis[0] ?? null;
}

/**
 * Colunas que todo funil novo ganha. Ganho e Perdido existem desde o começo:
 * são eles que dão sentido a conversão e perdas nas métricas.
 */
export const COLUNAS_DE_FUNIL_NOVO = [
  { name: "Novo lead", color: "#94a3b8", isWon: false, isLost: false },
  { name: "Em contato", color: "#5eb8ff", isWon: false, isLost: false },
  { name: "Ganho", color: "#34d399", isWon: true, isLost: false },
  { name: "Perdido", color: "#f87171", isWon: false, isLost: true },
] as const;
