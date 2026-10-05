import { test } from "node:test";
import assert from "node:assert/strict";
import { emFila } from "../lib/fila";

/**
 * Etiquetagem em massa: 50 conversas com a mesma etiqueta chegam como 50
 * avisos ao mesmo tempo. A fila tem que processar TODOS, um de cada vez e na
 * ordem de chegada — e o erro de um não pode travar os outros.
 */

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("50 avisos simultâneos: todos processados, um de cada vez, na ordem", async () => {
  const ordem: number[] = [];
  let rodandoAgora = 0;
  let maximoJuntos = 0;

  const tarefas = Array.from({ length: 50 }, (_, i) =>
    emFila("teste:massa", async () => {
      rodandoAgora++;
      maximoJuntos = Math.max(maximoJuntos, rodandoAgora);
      await esperar(Math.random() * 3);
      ordem.push(i);
      rodandoAgora--;
      return i;
    }),
  );

  const resultados = await Promise.all(tarefas);
  assert.equal(resultados.length, 50, "nenhum aviso fica de fora");
  assert.deepEqual(ordem, [...Array(50).keys()], "na ordem em que chegaram");
  assert.equal(maximoJuntos, 1, "nunca dois ao mesmo tempo");
});

test("o erro de um aviso não trava os seguintes", async () => {
  const feitos: string[] = [];
  const falha = emFila("teste:erro", async () => {
    throw new Error("banco fora");
  });
  const depois = emFila("teste:erro", async () => {
    feitos.push("depois");
    return "ok";
  });
  await assert.rejects(falha, /banco fora/, "quem pediu recebe o erro (o webhook pede o reenvio)");
  assert.equal(await depois, "ok");
  assert.deepEqual(feitos, ["depois"]);
});

test("filas de chaves diferentes não esperam uma pela outra", async () => {
  const ordem: string[] = [];
  const lenta = emFila("teste:conta-a", async () => {
    await esperar(30);
    ordem.push("a");
  });
  const rapida = emFila("teste:conta-b", async () => {
    ordem.push("b");
  });
  await Promise.all([lenta, rapida]);
  assert.deepEqual(ordem, ["b", "a"]);
});
