import { test } from "node:test";
import assert from "node:assert/strict";
import { chaveDia, juntarDataHora, rotuloTipo, situacao } from "../lib/atividades";

const agora = new Date(2026, 8, 29, 14, 0); // 29/09/2026 14:00, fuso local

test("situação: feita vence qualquer prazo", () => {
  assert.equal(situacao({ dueAt: new Date(2026, 8, 1).toISOString(), doneAt: agora.toISOString() }, agora), "feita");
});

test("situação: prazo que já passou é atrasada, mesmo que seja hoje mais cedo", () => {
  assert.equal(situacao({ dueAt: new Date(2026, 8, 29, 9, 0).toISOString(), doneAt: null }, agora), "atrasada");
});

test("situação: mais tarde hoje é 'hoje'; amanhã é 'agendada'; sem prazo é 'sem-data'", () => {
  assert.equal(situacao({ dueAt: new Date(2026, 8, 29, 18, 0).toISOString(), doneAt: null }, agora), "hoje");
  assert.equal(situacao({ dueAt: new Date(2026, 8, 30, 9, 0).toISOString(), doneAt: null }, agora), "agendada");
  assert.equal(situacao({ dueAt: null, doneAt: null }, agora), "sem-data");
});

test("data e hora do formulário são lidas no fuso local", () => {
  const iso = juntarDataHora("2026-10-01", "09:30");
  assert.ok(iso);
  const d = new Date(iso!);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
});

test("sem data não há prazo; hora vazia cai em 09:00", () => {
  assert.equal(juntarDataHora("", "10:00"), null);
  assert.equal(new Date(juntarDataHora("2026-10-01", "")!).getHours(), 9);
});

test("chave do dia agrupa pelo dia local", () => {
  assert.equal(chaveDia(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("rótulo do tipo em português", () => {
  assert.equal(rotuloTipo("FOLLOW_UP"), "Follow-up");
  assert.equal(rotuloTipo("DESCONHECIDO"), "DESCONHECIDO");
});
