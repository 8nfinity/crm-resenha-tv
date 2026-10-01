import { test } from "node:test";
import assert from "node:assert/strict";
import { etiquetasDoChat } from "../lib/ignorar";

test("etiquetas da conversa: lista de ids em texto ou número", () => {
  assert.deepEqual(etiquetasDoChat({ labels: ["1", 7] } as never), ["1", "7"]);
});

test("etiquetas da conversa: lista de objetos com id ou labelId", () => {
  assert.deepEqual(etiquetasDoChat({ labels: [{ id: "3" }, { labelId: "9", name: "Família" }] } as never), ["3", "9"]);
});

test("conversa sem etiquetas (ou em formato desconhecido) não quebra", () => {
  assert.deepEqual(etiquetasDoChat({} as never), []);
  assert.deepEqual(etiquetasDoChat({ labels: "1,2" } as never), []);
  assert.deepEqual(etiquetasDoChat({ labels: [null, {}] } as never), []);
});
