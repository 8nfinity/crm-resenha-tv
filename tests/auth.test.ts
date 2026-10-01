import { test, before } from "node:test";
import assert from "node:assert/strict";
import { conferirSenha, gerarHash, senhaFraca } from "../lib/auth/senha";

before(() => {
  process.env.AUTH_SECRET = "teste-".repeat(8); // 48 caracteres
});

test("senha: confere a certa, recusa a errada", async () => {
  const hash = await gerarHash("Biomech#2026");
  assert.equal(await conferirSenha("Biomech#2026", hash), true);
  assert.equal(await conferirSenha("biomech#2026", hash), false);
  assert.ok(!hash.includes("Biomech#2026"), "a senha não pode estar no hash");
});

test("senha: a mesma senha gera hashes diferentes (sal aleatório)", async () => {
  assert.notEqual(await gerarHash("mesma-senha"), await gerarHash("mesma-senha"));
});

test("senha: hash malformado nunca confere", async () => {
  assert.equal(await conferirSenha("qualquer", "lixo"), false);
  assert.equal(await conferirSenha("qualquer", ""), false);
});

test("senha: mínimo de 8 caracteres", () => {
  assert.ok(senhaFraca("1234567"));
  assert.equal(senhaFraca("12345678"), null);
});

test("sessão: token válido devolve o usuário e a versão", async () => {
  const { criarToken, lerToken } = await import("../lib/auth/sessao");
  const dados = lerToken(criarToken("usuario-1", 3));
  assert.equal(dados?.u, "usuario-1");
  assert.equal(dados?.v, 3);
});

test("sessão: token adulterado é recusado", async () => {
  const { criarToken, lerToken } = await import("../lib/auth/sessao");
  const [conteudo, assinatura] = criarToken("usuario-1", 0).split(".");
  // Troca o usuário dentro do token mantendo a assinatura antiga.
  const falso = Buffer.from(JSON.stringify({ u: "admin", v: 0, exp: 9_999_999_999 })).toString("base64url");
  assert.equal(lerToken(`${falso}.${assinatura}`), null);
  assert.equal(lerToken(`${conteudo}.x${assinatura.slice(1)}`), null);
  assert.equal(lerToken("sem-ponto"), null);
  assert.equal(lerToken(undefined), null);
});

test("sessão: token assinado com outro segredo é recusado", async () => {
  const { criarToken, lerToken } = await import("../lib/auth/sessao");
  const token = criarToken("usuario-1", 0);
  process.env.AUTH_SECRET = "outro-".repeat(8);
  assert.equal(lerToken(token), null);
  process.env.AUTH_SECRET = "teste-".repeat(8);
});

test("sessão: token vencido é recusado", async () => {
  const { lerToken } = await import("../lib/auth/sessao");
  const { createHmac } = await import("node:crypto");
  const conteudo = Buffer.from(JSON.stringify({ u: "u", v: 0, exp: 1 })).toString("base64url");
  const assinatura = createHmac("sha256", process.env.AUTH_SECRET!).update(conteudo).digest("base64url");
  assert.equal(lerToken(`${conteudo}.${assinatura}`), null);
});

test("sessão: sem AUTH_SECRET (ou curta demais) o login fica desligado", async () => {
  const { authConfigurado, lerToken, criarToken } = await import("../lib/auth/sessao");
  const token = criarToken("u", 0);
  process.env.AUTH_SECRET = "curta";
  assert.equal(authConfigurado(), false);
  assert.equal(lerToken(token), null);
  assert.throws(() => criarToken("u", 0));
  process.env.AUTH_SECRET = "teste-".repeat(8);
});
