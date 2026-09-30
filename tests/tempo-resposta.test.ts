import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distribuir,
  formatarMinutos,
  resumir,
  type VezDoLead,
} from "../lib/tempo-resposta";

const base = new Date("2026-09-29T12:00:00Z");
const depois = (min: number) => new Date(base.getTime() + min * 60_000);
const vez = (espera: number | null): VezDoLead => ({
  accountId: "a",
  perguntou: base,
  respondeu: espera === null ? null : depois(espera),
  inicio: true,
});

test("mediana ignora o efeito de uma resposta muito atrasada", () => {
  const r = resumir([vez(2), vez(4), vez(6), vez(3 * 1440)]);
  assert.equal(r.respondidas, 4);
  assert.equal(r.medianaMin, 5); // entre 4 e 6
  assert.ok(r.mediaMin! > 1000); // a média, sim, explode
});

test("conversas sem resposta entram na contagem, mas não nos tempos", () => {
  const r = resumir([vez(10), vez(null), vez(null)], depois(90));
  assert.equal(r.conversas, 3);
  assert.equal(r.semResposta, 2);
  assert.equal(r.medianaMin, 10);
  assert.equal(r.maiorEsperaMin, 90);
});

test("frações de até 5 min e até 1 h", () => {
  const r = resumir([vez(1), vez(5), vez(30), vez(61)]);
  assert.equal(r.ate5Min, 0.5);
  assert.equal(r.ate1h, 0.75);
});

test("sem nenhuma resposta, os tempos ficam nulos em vez de zero", () => {
  const r = resumir([vez(null)]);
  assert.equal(r.medianaMin, null);
  assert.equal(r.ate5Min, null);
});

test("distribui nas faixas pelo limite superior inclusivo", () => {
  const d = distribuir([vez(5), vez(6), vez(120), vez(2000), vez(null)]);
  assert.deepEqual(
    d.map((f) => f.quantidade),
    [1, 1, 1, 0, 0, 1],
  );
});

test("formata minutos de forma curta", () => {
  assert.equal(formatarMinutos(null), "—");
  assert.equal(formatarMinutos(0.4), "< 1 min");
  assert.equal(formatarMinutos(12.4), "12 min");
  assert.equal(formatarMinutos(80), "1 h 20");
  assert.equal(formatarMinutos(120), "2 h");
  assert.equal(formatarMinutos(2160), "1,5 d");
});
