import { test } from "node:test";
import assert from "node:assert/strict";
import { averageResponseHours, calculateScore, type ScoreInput } from "../lib/scoring";

/**
 * O score decide a ordem em que você aborda os leads. Se ele estiver errado,
 * você trabalha na ordem errada todo dia sem perceber — por isso os casos aqui
 * são comparativos ("A deve ser mais quente que B") e não números fixos, que
 * quebrariam a cada ajuste de peso.
 */

const AGORA = new Date("2026-09-16T12:00:00Z");
const DIA = 24 * 60 * 60 * 1000;

function diasAtras(dias: number): Date {
  return new Date(AGORA.getTime() - dias * DIA);
}

function base(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    lastInboundAt: diasAtras(1),
    lastInteractionAt: diasAtras(1),
    enteredStageAt: diasAtras(1),
    stageOrder: 1,
    totalStages: 5,
    isWon: false,
    isLost: false,
    inboundCount: 5,
    outboundCount: 5,
    avgResponseHours: 2,
    value: null,
    now: AGORA,
    ...over,
  };
}

test("score fica sempre entre 0 e 100", () => {
  const maximo = calculateScore(
    base({
      lastInboundAt: AGORA,
      inboundCount: 50,
      outboundCount: 10,
      avgResponseHours: 0.2,
      stageOrder: 4,
      value: 500_000,
    }),
  );
  assert.ok(maximo.score <= 100, `esperava <= 100, veio ${maximo.score}`);

  const minimo = calculateScore(
    base({
      lastInboundAt: null,
      inboundCount: 0,
      outboundCount: 20,
      avgResponseHours: null,
      stageOrder: 0,
      enteredStageAt: diasAtras(200),
    }),
  );
  assert.ok(minimo.score >= 0, `esperava >= 0, veio ${minimo.score}`);
});

test("quem respondeu ontem é mais quente que quem respondeu há um mês", () => {
  const recente = calculateScore(base({ lastInboundAt: diasAtras(1) }));
  const antigo = calculateScore(base({ lastInboundAt: diasAtras(30) }));
  assert.ok(
    recente.score > antigo.score,
    `recente ${recente.score} deveria superar antigo ${antigo.score}`,
  );
});

test("quem nunca respondeu não pode ser lead quente", () => {
  // Mesmo com tudo a favor: estágio avançado, valor alto, muitas mensagens
  // suas. Sem resposta dele, não há interesse demonstrado.
  const mudo = calculateScore(
    base({
      lastInboundAt: null,
      inboundCount: 0,
      outboundCount: 30,
      avgResponseHours: null,
      stageOrder: 4,
      value: 100_000,
    }),
  );
  assert.ok(mudo.score < 70, `esperava score frio, veio ${mudo.score}`);
  assert.notEqual(mudo.summary, "Quente");
});

test("conversa recíproca vale mais que monólogo", () => {
  const dialogo = calculateScore(base({ inboundCount: 10, outboundCount: 10 }));
  const monologo = calculateScore(base({ inboundCount: 1, outboundCount: 19 }));
  assert.ok(
    dialogo.score > monologo.score,
    `diálogo ${dialogo.score} deveria superar monólogo ${monologo.score}`,
  );
});

test("lead parado há muito tempo perde pontos", () => {
  const ativo = calculateScore(base({ enteredStageAt: diasAtras(1) }));
  const parado = calculateScore(base({ enteredStageAt: diasAtras(60) }));
  assert.ok(
    parado.score < ativo.score,
    `parado ${parado.score} deveria ficar abaixo de ativo ${ativo.score}`,
  );
  assert.ok(
    parado.factors.some((f) => f.key === "stagnation" && f.points < 0),
    "deveria existir um fator de estagnação negativo",
  );
});

test("estágio final zera o score e sai da fila de abordagem", () => {
  const ganho = calculateScore(base({ isWon: true }));
  const perdido = calculateScore(base({ isLost: true }));
  assert.equal(ganho.score, 0);
  assert.equal(perdido.score, 0);
  assert.equal(ganho.summary, "Ganho");
  assert.equal(perdido.summary, "Perdido");
});

test("todo fator traz uma explicação legível", () => {
  // O score só serve se der para discordar dele. Fator sem explicação vira
  // número mágico, e o Claude não teria como justificar a recomendação.
  const r = calculateScore(base({ value: 5000 }));
  assert.ok(r.factors.length > 0);
  for (const f of r.factors) {
    assert.ok(f.detail.length > 0, `fator ${f.key} sem explicação`);
    assert.ok(f.label.length > 0, `fator ${f.key} sem rótulo`);
  }
});

test("a soma dos fatores bate com o score final", () => {
  const r = calculateScore(base());
  const soma = r.factors.reduce((s, f) => s + f.points, 0);
  assert.equal(
    r.score,
    Math.max(0, Math.min(100, soma)),
    "o score precisa ser a soma dos fatores mostrados, senão a explicação mente",
  );
});

test("tempo médio de resposta ignora sequências de mensagens suas", () => {
  // Você mandou três seguidas às 10h, 10h30 e 11h; ele respondeu ao meio-dia.
  // O relógio começa na PRIMEIRA sua: são 2h de espera, não 1h.
  const media = averageResponseHours([
    { fromMe: true, timestamp: new Date("2026-09-16T10:00:00Z") },
    { fromMe: true, timestamp: new Date("2026-09-16T10:30:00Z") },
    { fromMe: true, timestamp: new Date("2026-09-16T11:00:00Z") },
    { fromMe: false, timestamp: new Date("2026-09-16T12:00:00Z") },
  ]);
  assert.equal(media, 2);
});

test("tempo médio de resposta é nulo quando ele nunca respondeu", () => {
  const media = averageResponseHours([
    { fromMe: true, timestamp: new Date("2026-09-16T10:00:00Z") },
    { fromMe: true, timestamp: new Date("2026-09-16T11:00:00Z") },
  ]);
  assert.equal(media, null);
});

test("tempo médio de resposta ignora mensagens dele sem pergunta anterior", () => {
  // Ele mandou duas mensagens do nada antes de você falar qualquer coisa:
  // não há espera a medir aí.
  const media = averageResponseHours([
    { fromMe: false, timestamp: new Date("2026-09-16T08:00:00Z") },
    { fromMe: false, timestamp: new Date("2026-09-16T09:00:00Z") },
    { fromMe: true, timestamp: new Date("2026-09-16T10:00:00Z") },
    { fromMe: false, timestamp: new Date("2026-09-16T11:00:00Z") },
  ]);
  assert.equal(media, 1);
});
