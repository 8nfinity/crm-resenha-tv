import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diaEmBrasilia,
  escolherDestinatarios,
  horaDoResumoChegou,
  janelaDoLembrete,
  type Pessoa,
} from "../lib/avisos";
import { escaparHtml, moldura } from "../lib/email";

const pessoa = (id: string, extra: Partial<Pessoa> = {}): Pessoa => ({
  id,
  name: id,
  email: `${id}@exemplo.com`,
  active: true,
  emailNotifications: true,
  ...extra,
});

test("lembrete vai para quem marcou a atividade", () => {
  const r = escolherDestinatarios({ criador: pessoa("bia"), admins: [pessoa("chefe")] });
  assert.deepEqual(r.map((p) => p.id), ["bia"]);
});

test("quem desligou os e-mails não recebe — e o aviso não cai nos administradores", () => {
  const r = escolherDestinatarios({ criador: pessoa("bia", { emailNotifications: false }), admins: [pessoa("chefe")] });
  assert.deepEqual(r, []);
});

test("autor desativado conta como sem autor", () => {
  const r = escolherDestinatarios({ criador: pessoa("bia", { active: false }), admins: [pessoa("chefe")] });
  assert.deepEqual(r.map((p) => p.id), ["chefe"]);
});

test("sem autor, vai para os administradores que querem receber", () => {
  const r = escolherDestinatarios({
    criador: null,
    admins: [pessoa("chefe"), pessoa("socio", { emailNotifications: false }), pessoa("ex", { active: false })],
  });
  assert.deepEqual(r.map((p) => p.id), ["chefe"]);
});

test("janela do lembrete: de 15 min atrás até X min à frente", () => {
  const agora = new Date("2026-10-01T12:00:00Z");
  const { de, ate } = janelaDoLembrete(agora, 30);
  assert.equal(de.toISOString(), "2026-10-01T11:45:00.000Z");
  assert.equal(ate.toISOString(), "2026-10-01T12:30:00.000Z");
});

test("dia em Brasília não depende do fuso da máquina", () => {
  // 01h UTC do dia 2 ainda é dia 1 em Brasília (22h).
  assert.equal(diaEmBrasilia(new Date("2026-10-02T01:00:00Z")), "2026-10-01");
  assert.equal(diaEmBrasilia(new Date("2026-10-02T03:00:00Z")), "2026-10-02");
});

test("resumo do dia: a partir da hora marcada, uma vez por dia, até o meio-dia", () => {
  const as = (h: number) => new Date(`2026-10-01T${String(h + 3).padStart(2, "0")}:05:00Z`); // h em Brasília
  assert.equal(horaDoResumoChegou(as(6), null, 7), false, "antes da hora");
  assert.equal(horaDoResumoChegou(as(7), null, 7), true, "na hora");
  assert.equal(horaDoResumoChegou(as(7), "2026-10-01", 7), false, "já mandou hoje");
  assert.equal(horaDoResumoChegou(as(9), "2026-09-30", 7), true, "servidor voltou de manhã");
  assert.equal(horaDoResumoChegou(as(15), "2026-09-30", 7), false, "tarde demais: fica para amanhã");
});

test("texto de fora não vira HTML no e-mail", () => {
  assert.equal(escaparHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  const html = moldura({ titulo: "<b>oi</b>", corpoHtml: "corpo" });
  assert.ok(html.includes("&lt;b&gt;oi&lt;/b&gt;"));
  assert.ok(!html.includes("<b>oi</b>"));
});
