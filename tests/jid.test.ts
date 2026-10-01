import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPhone,
  isGroupJid,
  isLidJid,
  isPersonJid,
  jidToPhone,
} from "../lib/evolution/parse";

/**
 * O WhatsApp migrou de "@s.whatsapp.net" (que contém o telefone) para "@lid"
 * (Linked ID, opaco). Numa conta real testada aqui, 172 das 176 conversas
 * pessoais já usavam o formato novo — e o filtro antigo descartava todas,
 * silenciosamente. Estes testes existem para isso não voltar.
 */

const NET = "5511999999999@s.whatsapp.net";
const LID = "62194827364@lid";
const GRUPO = "120363001234567890@g.us";

test("aceita como pessoa os dois formatos de identificador", () => {
  assert.equal(isPersonJid(NET), true, "formato antigo");
  assert.equal(isPersonJid(LID), true, "formato novo — era o que faltava");
});

test("descarta o que não é pessoa", () => {
  assert.equal(isPersonJid(GRUPO), false, "grupo");
  assert.equal(isPersonJid("status@broadcast"), false, "status/stories");
  assert.equal(isPersonJid("123@newsletter"), false, "newsletter");
  assert.equal(isPersonJid("123@broadcast"), false, "lista de transmissão");
  assert.equal(isPersonJid("123@bot"), false, "bot");
});

test("extrai telefone apenas do formato que realmente tem um", () => {
  assert.equal(jidToPhone(NET), "5511999999999");
});

test("NUNCA inventa telefone a partir de um LID", () => {
  // Este é o ponto crítico. Um regex de dígitos casaria com "62194827364@lid"
  // e produziria um telefone falso com aparência legítima — e o erro só
  // apareceria quando alguém ligasse para o número errado.
  assert.equal(jidToPhone(LID), null);
  assert.equal(jidToPhone(GRUPO), null);
  assert.equal(jidToPhone("qualquercoisa"), null);

  // E o formatador não pode maquiar um nulo como telefone.
  assert.equal(formatPhone(jidToPhone(LID)), null);
});

test("distingue os tipos de identificador", () => {
  assert.equal(isLidJid(LID), true);
  assert.equal(isLidJid(NET), false);
  assert.equal(isGroupJid(GRUPO), true);
  assert.equal(isGroupJid(LID), false);
});

test("formata telefone brasileiro de forma legível", () => {
  assert.equal(formatPhone("5511987654321"), "+55 11 98765-4321");
  assert.equal(formatPhone("551133334444"), "+55 11 3333-4444", "fixo, 8 dígitos");
  assert.equal(formatPhone("14155551234"), "+14155551234", "fora do padrão BR");
  assert.equal(formatPhone(null), null);
});

test("telefone e LID da mesma pessoa: separa os dois, venha qual vier na conversa", async () => {
  const { identidades, jidAlternativo } = await import("../lib/evolution/parse");
  assert.deepEqual(identidades("12279412199448@lid", "555199544069@s.whatsapp.net"), {
    pn: "555199544069@s.whatsapp.net",
    lid: "12279412199448@lid",
  });
  assert.deepEqual(identidades("555199544069@s.whatsapp.net", "12279412199448@lid"), {
    pn: "555199544069@s.whatsapp.net",
    lid: "12279412199448@lid",
  });
  assert.deepEqual(identidades("12279412199448@lid", null), { pn: null, lid: "12279412199448@lid" });
  // Formato que a Evolution manda na mensagem (Baileys 7).
  assert.equal(
    jidAlternativo({ key: { id: "1", remoteJid: "12279412199448@lid", remoteJidAlt: "555199544069@s.whatsapp.net" } }),
    "555199544069@s.whatsapp.net",
  );
  assert.equal(jidAlternativo({ key: { id: "1", remoteJid: "555199544069@s.whatsapp.net" } }), null);
});
