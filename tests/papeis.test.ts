import { test } from "node:test";
import assert from "node:assert/strict";
import { ehAdministrador, papeisQuePodeAtribuir, podeAlterar } from "../lib/auth/papeis";

const master = { id: "m", papel: "MASTER" as const };
const admin = { id: "a", papel: "ADMIN" as const };
const admin2 = { id: "a2", papel: "ADMIN" as const };
const vend = { id: "v", papel: "VENDEDOR" as const };

test("master cria qualquer papel; admin só vendedor; vendedor nada", () => {
  assert.deepEqual(papeisQuePodeAtribuir("MASTER"), ["MASTER", "ADMIN", "VENDEDOR"]);
  assert.deepEqual(papeisQuePodeAtribuir("ADMIN"), ["VENDEDOR"]);
  assert.deepEqual(papeisQuePodeAtribuir("VENDEDOR"), []);
});

test("ninguém além do próprio master mexe na conta master", () => {
  assert.equal(podeAlterar(admin, master), false);
  assert.equal(podeAlterar(vend, master), false);
});

test("admin gerencia vendedor, mas não outro admin", () => {
  assert.equal(podeAlterar(admin, vend), true);
  assert.equal(podeAlterar(admin, admin2), false);
});

test("master gerencia admins e vendedores", () => {
  assert.equal(podeAlterar(master, admin), true);
  assert.equal(podeAlterar(master, vend), true);
});

test("ninguém altera a própria conta por aqui (senha própria é em Minha conta)", () => {
  assert.equal(podeAlterar(master, master), false);
  assert.equal(podeAlterar(admin, admin), false);
});

test("vendedor não gerencia ninguém", () => {
  assert.equal(podeAlterar(vend, { id: "v2", papel: "VENDEDOR" }), false);
});

test("master e admin configuram o CRM; vendedor não", () => {
  assert.equal(ehAdministrador("MASTER"), true);
  assert.equal(ehAdministrador("ADMIN"), true);
  assert.equal(ehAdministrador("VENDEDOR"), false);
  assert.equal(ehAdministrador(null), false);
});
