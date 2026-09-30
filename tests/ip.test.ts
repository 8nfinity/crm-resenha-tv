import { test } from "node:test";
import assert from "node:assert/strict";
import { ipInCidr, ipv4ToInt, secretsMatch } from "../lib/ip";

/**
 * A trava de IP é a única coisa entre o seu funil e a internet aberta.
 * Um erro para o lado frouxo expõe todos os leads; um erro para o lado
 * apertado derruba o conector do Claude sem explicação óbvia.
 */

test("aceita IPs dentro da faixa de saída da Anthropic", () => {
  const FAIXA = "160.79.104.0/21";
  // 160.79.104.0 até 160.79.111.255
  assert.equal(ipInCidr("160.79.104.0", FAIXA), true, "primeiro IP da faixa");
  assert.equal(ipInCidr("160.79.107.42", FAIXA), true, "meio da faixa");
  assert.equal(ipInCidr("160.79.111.255", FAIXA), true, "último IP da faixa");
});

test("recusa IPs logo fora da faixa", () => {
  const FAIXA = "160.79.104.0/21";
  assert.equal(ipInCidr("160.79.103.255", FAIXA), false, "um antes do início");
  assert.equal(ipInCidr("160.79.112.0", FAIXA), false, "um depois do fim");
  assert.equal(ipInCidr("160.80.104.1", FAIXA), false, "outro segundo octeto");
  assert.equal(ipInCidr("8.8.8.8", FAIXA), false, "IP qualquer");
});

test("lida com IPs acima de 127 sem estourar o sinal do shift de 32 bits", () => {
  // Este é o bug clássico: `<<` em JS opera com inteiro COM sinal, então
  // 200.x.x.x vira negativo e a comparação dá resultado errado sem o `>>> 0`.
  assert.equal(ipv4ToInt("255.255.255.255"), 4294967295);
  assert.equal(ipv4ToInt("128.0.0.0"), 2147483648);
  assert.equal(ipInCidr("200.1.2.3", "200.1.2.0/24"), true);
  assert.equal(ipInCidr("200.1.3.3", "200.1.2.0/24"), false);
});

test("rejeita entradas malformadas em vez de deixar passar", () => {
  assert.equal(ipv4ToInt("1.2.3"), null, "poucos octetos");
  assert.equal(ipv4ToInt("1.2.3.4.5"), null, "octetos demais");
  assert.equal(ipv4ToInt("256.1.1.1"), null, "octeto acima de 255");
  assert.equal(ipv4ToInt("a.b.c.d"), null, "não numérico");
  assert.equal(ipv4ToInt(""), null, "vazio");
  // IPv6 precisa cair fora: a Anthropic só publica faixa IPv4 de saída, e
  // aceitar um IPv6 por engano abriria a porta.
  assert.equal(ipv4ToInt("2607:6bc0::1"), null, "IPv6");
  assert.equal(ipInCidr("2607:6bc0::1", "160.79.104.0/21"), false);
});

test("rejeita CIDR malformado", () => {
  assert.equal(ipInCidr("1.2.3.4", "1.2.3.4"), false, "sem barra");
  assert.equal(ipInCidr("1.2.3.4", "1.2.3.4/33"), false, "bits acima de 32");
  assert.equal(ipInCidr("1.2.3.4", "1.2.3.4/-1"), false, "bits negativos");
  assert.equal(ipInCidr("1.2.3.4", "1.2.3.4/abc"), false, "bits não numérico");
});

test("/32 casa apenas o IP exato e /0 casa qualquer um", () => {
  assert.equal(ipInCidr("1.2.3.4", "1.2.3.4/32"), true);
  assert.equal(ipInCidr("1.2.3.5", "1.2.3.4/32"), false);
  assert.equal(ipInCidr("1.2.3.4", "0.0.0.0/0"), true);
});

test("comparação de segredo distingue valores e tamanhos", () => {
  assert.equal(secretsMatch("abc123", "abc123"), true);
  assert.equal(secretsMatch("abc123", "abc124"), false, "último caractere");
  assert.equal(secretsMatch("abc123", "xbc123"), false, "primeiro caractere");
  assert.equal(secretsMatch("abc", "abc123"), false, "prefixo correto, curto");
  assert.equal(secretsMatch("", ""), true);
});
