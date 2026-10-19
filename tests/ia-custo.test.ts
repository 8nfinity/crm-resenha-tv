import { test } from "node:test";
import assert from "node:assert/strict";
import { aproveitamentoCache, cotacaoDolar, custoUsd } from "../lib/ia/custo";

const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("custo: Sonnet 5.5 cobra entrada, saída, leitura e gravação do cache separadas", () => {
  // 1M de cada: 2 (entrada) + 10 (saída) + 0,20 (cache lido) + 2,50 (cache gravado, 1,25×)
  perto(
    custoUsd("claude-sonnet-5-5", { inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 1e6, cacheWriteTokens: 1e6 }),
    2 + 10 + 0.2 + 2.5,
  );
  // Uma resposta típica: 1.000 novos, 3.000 do cache, 150 de saída.
  perto(
    custoUsd("claude-sonnet-5-5", { inputTokens: 1000, outputTokens: 150, cacheReadTokens: 3000, cacheWriteTokens: 0 }),
    (1000 * 2 + 150 * 10 + 3000 * 0.2) / 1e6,
  );
});

test("custo: Opus 5.5 é o dobro do Sonnet na entrada e na saída", () => {
  perto(custoUsd("claude-opus-5-5", { inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0 }), 24);
});

test("custo: modelo fora da tabela conta como o mais caro (nunca subestima)", () => {
  const u = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.equal(custoUsd("modelo-novo", u), custoUsd("claude-opus-5-5", u));
});

test("custo: aproveitamento do cache é a fração da entrada lida do cache", () => {
  assert.equal(aproveitamentoCache({ inputTokens: 1000, cacheReadTokens: 3000, cacheWriteTokens: 0 }), 0.75);
  assert.equal(aproveitamentoCache({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), null);
});

test("custo: cotação do dólar vem da variável, com 5,60 de padrão", () => {
  const antes = process.env.COTACAO_DOLAR;
  delete process.env.COTACAO_DOLAR;
  assert.equal(cotacaoDolar(), 5.6);
  process.env.COTACAO_DOLAR = "5.12";
  assert.equal(cotacaoDolar(), 5.12);
  process.env.COTACAO_DOLAR = "abc";
  assert.equal(cotacaoDolar(), 5.6);
  if (antes === undefined) delete process.env.COTACAO_DOLAR;
  else process.env.COTACAO_DOLAR = antes;
});
