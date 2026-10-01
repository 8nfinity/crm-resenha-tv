import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { emailConfigurado, enviarEmail, provedor, separarRemetente } from "../lib/email";

/**
 * Envio de e-mail sem sair nada de verdade: o fetch é substituído e o teste
 * confere o que seria mandado para o Brevo / a Resend.
 */

const fetchOriginal = globalThis.fetch;
const VARS = ["BREVO_API_KEY", "RESEND_API_KEY", "EMAIL_REMETENTE"];

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const v of VARS) delete process.env[v];
});

function interceptar(resposta: { status: number; corpo: unknown }) {
  const chamadas: { url: string; headers: Record<string, string>; corpo: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      corpo: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status });
  }) as typeof fetch;
  return chamadas;
}

const EMAIL = { para: "vendedor@exemplo.com", assunto: "Lembrete", html: "<p>oi</p>", texto: "oi" };

test("remetente: separa nome e e-mail", () => {
  assert.deepEqual(separarRemetente("CRM Biomech <moises@gmail.com>"), { nome: "CRM Biomech", email: "moises@gmail.com" });
  assert.deepEqual(separarRemetente('"Instituto Biomech" <a@b.com>'), { nome: "Instituto Biomech", email: "a@b.com" });
  assert.deepEqual(separarRemetente("moises@gmail.com"), { nome: "CRM Biomech", email: "moises@gmail.com" });
});

test("sem chave nenhuma, os avisos ficam desligados e o erro explica o que falta", async () => {
  process.env.EMAIL_REMETENTE = "CRM <a@b.com>";
  assert.equal(emailConfigurado(), false);
  const r = await enviarEmail(EMAIL);
  assert.equal(r.ok, false);
  assert.match((r as { erro: string }).erro, /BREVO_API_KEY/);
});

test("Brevo: manda para o e-mail da conta, com o Gmail como remetente", async () => {
  process.env.BREVO_API_KEY = "xkeysib-teste";
  process.env.EMAIL_REMETENTE = "CRM Biomech <moises@gmail.com>";
  const chamadas = interceptar({ status: 201, corpo: { messageId: "x" } });

  assert.equal(provedor(), "brevo");
  assert.deepEqual(await enviarEmail(EMAIL), { ok: true });
  assert.equal(chamadas[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(chamadas[0].headers["api-key"], "xkeysib-teste");
  assert.deepEqual(chamadas[0].corpo.sender, { name: "CRM Biomech", email: "moises@gmail.com" });
  assert.deepEqual(chamadas[0].corpo.to, [{ email: "vendedor@exemplo.com" }]);
  assert.equal(chamadas[0].corpo.htmlContent, "<p>oi</p>");
});

test("com as duas chaves, vale o Brevo", () => {
  process.env.BREVO_API_KEY = "xkeysib-teste";
  process.env.RESEND_API_KEY = "re_teste";
  assert.equal(provedor(), "brevo");
});

test("Brevo bloqueando o IP da Railway: o erro diz onde desativar", async () => {
  process.env.BREVO_API_KEY = "xkeysib-teste";
  process.env.EMAIL_REMETENTE = "CRM <moises@gmail.com>";
  interceptar({ status: 401, corpo: { code: "unauthorized", message: "We have detected you are using an unrecognised IP address 1.2.3.4" } });
  const r = await enviarEmail(EMAIL);
  assert.equal(r.ok, false);
  assert.match((r as { erro: string }).erro, /IPs autorizados/);
});

test("Brevo com remetente não confirmado: o erro diz para confirmar", async () => {
  process.env.BREVO_API_KEY = "xkeysib-teste";
  process.env.EMAIL_REMETENTE = "CRM <moises@gmail.com>";
  interceptar({ status: 400, corpo: { code: "invalid_parameter", message: "Sender is not valid" } });
  const r = await enviarEmail(EMAIL);
  assert.match((r as { erro: string }).erro, /Remetentes/);
});

test("Resend continua funcionando para quem tem domínio próprio", async () => {
  process.env.RESEND_API_KEY = "re_teste";
  process.env.EMAIL_REMETENTE = "CRM <avisos@biomech.com.br>";
  const chamadas = interceptar({ status: 200, corpo: { id: "x" } });
  assert.deepEqual(await enviarEmail(EMAIL), { ok: true });
  assert.equal(chamadas[0].url, "https://api.resend.com/emails");
  assert.deepEqual(chamadas[0].corpo.to, ["vendedor@exemplo.com"]);
});
