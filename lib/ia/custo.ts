/**
 * Custo das chamadas à Anthropic, a partir dos tokens que a própria API
 * informa em cada resposta. Puro — testado em tests/ia-custo.test.ts.
 *
 * Preços por milhão de tokens (tabela da Anthropic, outubro/2026). A entrada
 * se divide em três: a parte nova (preço cheio), a lida do cache (bem mais
 * barata) e a gravada no cache (1,25× a entrada, cache de 5 minutos).
 */

type Preco = { entrada: number; saida: number; cacheLeitura: number };

export const PRECOS: Record<string, Preco> = {
  "claude-sonnet-5-5": { entrada: 2, saida: 10, cacheLeitura: 0.2 },
  "claude-opus-5-5": { entrada: 4, saida: 20, cacheLeitura: 0.2 },
};

/** Multiplicador da gravação no cache de 5 minutos. */
const GRAVACAO_CACHE = 1.25;

export type Uso = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/**
 * Custo em dólares de uma chamada. Modelo fora da tabela é cobrado como o
 * mais caro, para o número nunca sair menor que o real.
 */
export function custoUsd(modelo: string, u: Uso): number {
  const p = PRECOS[modelo] ?? PRECOS["claude-opus-5-5"];
  const porMilhao =
    u.inputTokens * p.entrada +
    u.cacheWriteTokens * p.entrada * GRAVACAO_CACHE +
    u.cacheReadTokens * p.cacheLeitura +
    u.outputTokens * p.saida;
  return porMilhao / 1_000_000;
}

/** Quanto da entrada veio do cache (0 a 1). Nulo sem entrada nenhuma. */
export function aproveitamentoCache(u: Pick<Uso, "inputTokens" | "cacheReadTokens" | "cacheWriteTokens">): number | null {
  const total = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  return total > 0 ? u.cacheReadTokens / total : null;
}

/** Cotação usada para mostrar em reais (variável COTACAO_DOLAR; padrão 5,60). */
export function cotacaoDolar(): number {
  const v = Number(process.env.COTACAO_DOLAR);
  return Number.isFinite(v) && v > 0 ? v : 5.6;
}
