import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { estaHospedado, urlDoWebhook, urlPublica } from "../lib/url-publica";

const VARIAVEIS = ["APP_URL", "RAILWAY_PUBLIC_DOMAIN", "WEBHOOK_BASE_URL"] as const;
afterEach(() => {
  for (const v of VARIAVEIS) delete process.env[v];
});

test("rodando local, usa a origem da própria requisição", () => {
  assert.equal(urlPublica("http://localhost:3000/conexao?x=1"), "http://localhost:3000");
  assert.equal(estaHospedado(), false);
});

test("na Railway, usa o domínio público com https mesmo se a requisição chegou em http", () => {
  process.env.RAILWAY_PUBLIC_DOMAIN = "crm-biomech.up.railway.app";
  assert.equal(urlPublica("http://10.0.0.5:8080/api/x"), "https://crm-biomech.up.railway.app");
  assert.equal(urlDoWebhook(), "https://crm-biomech.up.railway.app/api/webhooks/evolution");
  assert.equal(estaHospedado(), true);
});

test("APP_URL (domínio próprio) tem precedência e perde a barra final", () => {
  process.env.RAILWAY_PUBLIC_DOMAIN = "crm-biomech.up.railway.app";
  process.env.APP_URL = "https://crm.biomech.com.br/";
  assert.equal(urlPublica(), "https://crm.biomech.com.br");
});

test("WEBHOOK_BASE_URL desvia só o webhook para a rede privada", () => {
  process.env.RAILWAY_PUBLIC_DOMAIN = "crm-biomech.up.railway.app";
  process.env.WEBHOOK_BASE_URL = "http://crm.railway.internal:8080";
  assert.equal(urlDoWebhook(), "http://crm.railway.internal:8080/api/webhooks/evolution");
  assert.equal(urlPublica(), "https://crm-biomech.up.railway.app");
});
