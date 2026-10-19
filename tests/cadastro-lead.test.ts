import { test } from "node:test";
import assert from "node:assert/strict";
import { emailValido, lerValor, normalizarTelefone } from "../lib/cadastro-lead";

test("cadastro: telefone brasileiro em qualquer formato vira 55 + DDD + número", () => {
  assert.equal(normalizarTelefone("(51) 98540-9366"), "5551985409366");
  assert.equal(normalizarTelefone("51985409366"), "5551985409366");
  assert.equal(normalizarTelefone("+55 51 98540-9366"), "5551985409366");
  assert.equal(normalizarTelefone("5551985409366"), "5551985409366");
  // Fixo (8 dígitos) também vale.
  assert.equal(normalizarTelefone("(51) 3333-4444"), "555133334444");
});

test("cadastro: número de fora precisa do +, e lixo é recusado", () => {
  assert.equal(normalizarTelefone("+1 415 555 0100"), "14155550100");
  assert.equal(normalizarTelefone("98540-9366"), null); // sem DDD
  assert.equal(normalizarTelefone("abc"), null);
  assert.equal(normalizarTelefone(""), null);
});

test("cadastro: e-mail", () => {
  assert.equal(emailValido("ana@loja.com.br"), true);
  assert.equal(emailValido(" ana@loja.com "), true);
  assert.equal(emailValido("ana@loja"), false);
  assert.equal(emailValido("ana loja@x.com"), false);
});

test("cadastro: valor em reais, no jeito brasileiro de escrever", () => {
  assert.equal(lerValor(""), null);
  assert.equal(lerValor("R$ 2.500,50"), 2500.5);
  assert.equal(lerValor("2500,5"), 2500.5);
  assert.equal(lerValor("2.500"), 2500);
  assert.equal(lerValor("1500"), 1500);
  assert.ok(Number.isNaN(lerValor("dez reais") as number));
});
