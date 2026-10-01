import { test } from "node:test";
import assert from "node:assert/strict";
import { descreverAparelho, endpointPermitido } from "../lib/push";
import { responsaveisDaAtividade, resumoCurto, type Pessoa } from "../lib/avisos";

test("aceita só os serviços de notificação dos navegadores", () => {
  assert.equal(endpointPermitido("https://fcm.googleapis.com/fcm/send/abc", ""), true, "Chrome/Android");
  assert.equal(endpointPermitido("https://updates.push.services.mozilla.com/wpush/v2/abc", ""), true, "Firefox");
  assert.equal(endpointPermitido("https://web.push.apple.com/QGx", ""), true, "iPhone/Safari");
  assert.equal(endpointPermitido("https://wns2-bn3p.notify.windows.com/w/?token=x", ""), true, "Edge");
});

test("recusa endereço que faria o CRM chamar outro lugar", () => {
  assert.equal(endpointPermitido("http://fcm.googleapis.com/x", ""), false, "sem https");
  assert.equal(endpointPermitido("https://localhost:3000/api/usuarios", ""), false);
  assert.equal(endpointPermitido("https://169.254.169.254/latest/meta-data", ""), false);
  assert.equal(endpointPermitido("https://googleapis.com.atacante.com/x", ""), false, "domínio parecido");
  assert.equal(endpointPermitido("https://fakegoogleapis.com/x", ""), false, "sufixo sem ponto");
  assert.equal(endpointPermitido("isso não é url", ""), false);
});

test("serviço extra só entra quando declarado (testes automáticos)", () => {
  assert.equal(endpointPermitido("https://localhost:8443/push/1", "localhost"), true);
  assert.equal(endpointPermitido("https://localhost:8443/push/1", ""), false);
});

test("descreve o aparelho para a pessoa reconhecer", () => {
  const chromeWin =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
  const edge = `${chromeWin} Edg/140.0`;
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const android = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
  assert.equal(descreverAparelho(chromeWin), "Chrome no Windows");
  assert.equal(descreverAparelho(edge), "Edge no Windows");
  assert.equal(descreverAparelho(iphone), "Safari no iPhone");
  assert.equal(descreverAparelho(android), "Chrome no Android");
  assert.equal(descreverAparelho(null), "Navegador no aparelho");
});

const pessoa = (id: string, extra: Partial<Pessoa> = {}): Pessoa => ({
  id,
  name: id,
  email: `${id}@x.com`,
  active: true,
  emailNotifications: true,
  ...extra,
});

test("notificação vai para quem marcou — mesmo quem desligou o e-mail", () => {
  const r = responsaveisDaAtividade({ criador: pessoa("bia", { emailNotifications: false }), admins: [pessoa("chefe")] });
  assert.deepEqual(r.map((p) => p.id), ["bia"]);
});

test("sem autor ativo, a notificação vai para os administradores ativos", () => {
  const r = responsaveisDaAtividade({
    criador: pessoa("ex", { active: false }),
    admins: [pessoa("chefe"), pessoa("saiu", { active: false })],
  });
  assert.deepEqual(r.map((p) => p.id), ["chefe"]);
});

test("resumo curto da notificação do dia", () => {
  assert.equal(resumoCurto(3, 1), "3 para hoje e 1 atrasada");
  assert.equal(resumoCurto(0, 2), "2 atrasadas");
  assert.equal(resumoCurto(1, 0), "1 para hoje");
});
