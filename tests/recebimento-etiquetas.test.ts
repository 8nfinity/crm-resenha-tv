import { test } from "node:test";
import assert from "node:assert/strict";
import { avisosNaFila, LIMITE_NA_FILA, receberEtiquetagem, type Etiquetagem } from "../lib/recebimento-etiquetas";

/** Fila de mentira: guarda as tarefas e só roda quando o teste mandar, em ordem. */
function filaManual() {
  const tarefas: { rodar: () => Promise<void> }[] = [];
  let anterior: Promise<void> = Promise.resolve();
  const rodar = (_conta: string, tarefa: () => Promise<void>) => {
    let liberar!: () => void;
    const vez = new Promise<void>((r) => (liberar = r));
    tarefas.push({ rodar: async () => liberar() });
    const atual = anterior.then(() => vez).then(tarefa);
    anterior = atual.catch(() => {});
    return atual;
  };
  const andarTudo = async () => {
    for (const t of tarefas.splice(0)) await t.rodar();
    await anterior;
  };
  return { rodar, andarTudo };
}

const aviso = (conta: string, tipo: "add" | "remove", chatId = "1@lid", labelId = "5"): Etiquetagem => ({
  accountId: conta,
  tipo,
  chatId,
  labelId,
});

test("o mesmo aviso repetido enquanto o primeiro está na fila é descartado", async () => {
  const { rodar, andarTudo } = filaManual();
  const feitos: string[] = [];
  const r1 = receberEtiquetagem(aviso("c1", "add"), async () => void feitos.push("add"), rodar);
  const r2 = receberEtiquetagem(aviso("c1", "add"), async () => void feitos.push("add"), rodar);
  const r3 = receberEtiquetagem(aviso("c1", "add"), async () => void feitos.push("add"), rodar);
  assert.deepEqual([r1, r2, r3], ["na-fila", "repetida", "repetida"]);
  assert.equal(avisosNaFila("c1"), 1);
  await andarTudo();
  assert.deepEqual(feitos, ["add"]);
  assert.equal(avisosNaFila("c1"), 0);
});

test("pôr, tirar e pôr de novo entram os três, na ordem", async () => {
  const { rodar, andarTudo } = filaManual();
  const feitos: string[] = [];
  const tarefa = (t: string) => async () => void feitos.push(t);
  const r = [
    receberEtiquetagem(aviso("c2", "add"), tarefa("add"), rodar),
    receberEtiquetagem(aviso("c2", "remove"), tarefa("remove"), rodar),
    receberEtiquetagem(aviso("c2", "add"), tarefa("add"), rodar),
    // Este repete o último da fila: sai.
    receberEtiquetagem(aviso("c2", "add"), tarefa("add"), rodar),
  ];
  assert.deepEqual(r, ["na-fila", "na-fila", "na-fila", "repetida"]);
  await andarTudo();
  assert.deepEqual(feitos, ["add", "remove", "add"]);
});

test("depois que o aviso termina, o mesmo aviso volta a valer", async () => {
  const { rodar, andarTudo } = filaManual();
  let n = 0;
  assert.equal(receberEtiquetagem(aviso("c3", "add"), async () => void n++, rodar), "na-fila");
  await andarTudo();
  assert.equal(receberEtiquetagem(aviso("c3", "add"), async () => void n++, rodar), "na-fila");
  await andarTudo();
  assert.equal(n, 2);
});

test("conversas ou etiquetas diferentes não se confundem", async () => {
  const { rodar, andarTudo } = filaManual();
  const r = [
    receberEtiquetagem(aviso("c4", "add", "1@lid", "5"), async () => {}, rodar),
    receberEtiquetagem(aviso("c4", "add", "2@lid", "5"), async () => {}, rodar),
    receberEtiquetagem(aviso("c4", "add", "1@lid", "6"), async () => {}, rodar),
    receberEtiquetagem(aviso("outra", "add", "1@lid", "5"), async () => {}, rodar),
  ];
  assert.ok(r.every((x) => x === "na-fila"));
  await andarTudo();
});

test("erro numa etiquetagem não trava a fila nem a contagem", async () => {
  const { rodar, andarTudo } = filaManual();
  const avisar = console.warn;
  console.warn = () => {};
  try {
    receberEtiquetagem(aviso("c5", "add"), async () => {
      throw new Error("banco fora");
    }, rodar);
    let rodou = false;
    receberEtiquetagem(aviso("c5", "add", "2@lid"), async () => void (rodou = true), rodar);
    await andarTudo();
    await new Promise((r) => setImmediate(r));
    assert.ok(rodou);
    assert.equal(avisosNaFila("c5"), 0);
  } finally {
    console.warn = avisar;
  }
});

test("fila cheia não aceita mais nada (a conferência periódica recupera)", async () => {
  const { rodar, andarTudo } = filaManual();
  const avisar = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < LIMITE_NA_FILA; i++) {
      receberEtiquetagem(aviso("c6", "add", `${i}@lid`), async () => {}, rodar);
    }
    assert.equal(avisosNaFila("c6"), LIMITE_NA_FILA);
    assert.equal(receberEtiquetagem(aviso("c6", "add", "extra@lid"), async () => {}, rodar), "fila-cheia");
    await andarTudo();
    await new Promise((r) => setImmediate(r));
    assert.equal(avisosNaFila("c6"), 0);
    assert.equal(receberEtiquetagem(aviso("c6", "add", "extra@lid"), async () => {}, rodar), "na-fila");
    await andarTudo();
  } finally {
    console.warn = avisar;
  }
});
