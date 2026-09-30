import { test } from "node:test";
import assert from "node:assert/strict";
import { isPersonJid } from "../lib/evolution/parse";

/**
 * Regras da automação por etiqueta.
 *
 * Aqui só entra a lógica pura de decisão — o caminho completo depende do banco
 * e é verificado ponta a ponta com um webhook simulado. O que estes testes
 * protegem são as decisões que não podem mudar por acidente.
 */

/**
 * Espelha a decisão de `handleLabelAssociation`: só "add" move o lead.
 *
 * Tirar a etiqueta "Reunião marcada" não diz para onde o lead deveria voltar.
 * Adivinhar o estágio anterior bagunçaria o histórico de conversão — que é
 * justamente o dado impossível de reconstruir depois.
 */
function deveMover(tipo: string): boolean {
  return tipo === "add";
}

test("só a aplicação de etiqueta move o lead, nunca a remoção", () => {
  assert.equal(deveMover("add"), true);
  assert.equal(deveMover("remove"), false, "remover não pode desfazer o estágio");
  assert.equal(deveMover(""), false, "payload sem tipo não move nada");
  assert.equal(deveMover("ADD"), false, "a Evolution manda minúsculo; maiúsculo é suspeito");
});

test("etiqueta em grupo ou status não vira lead", () => {
  // Uma conversa de grupo pode receber etiqueta no WhatsApp Business, mas
  // grupo não é pessoa e não pertence a um funil de vendas.
  assert.equal(isPersonJid("120363001234567890@g.us"), false, "grupo");
  assert.equal(isPersonJid("status@broadcast"), false, "status");
  assert.equal(isPersonJid("5511999999999@s.whatsapp.net"), true, "pessoa");
  assert.equal(isPersonJid("62194827364@lid"), true, "pessoa no formato novo");
});

/** Espelha a normalização de evento feita no webhook. */
function normalizarEvento(evento: string): string {
  return evento.toLowerCase().replace(/_/g, ".");
}

test("reconhece o evento de etiquetagem nas duas grafias", () => {
  // A Evolution já mandou "LABELS_ASSOCIATION" e "labels.association" em
  // versões diferentes. Reconhecer só uma faria a automação falhar em silêncio
  // numa atualização da Evolution.
  assert.equal(normalizarEvento("LABELS_ASSOCIATION"), "labels.association");
  assert.equal(normalizarEvento("labels.association"), "labels.association");
  assert.equal(normalizarEvento("LABELS_EDIT"), "labels.edit");
});
