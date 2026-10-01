import { test } from "node:test";
import assert from "node:assert/strict";
import { atividadeDoChat, chatsComAtividade } from "../lib/sincronizacao";

const agora = Date.parse("2026-10-01T15:00:00Z");
const seg = (d: number) => Math.floor(d / 1000);

test("atividade vem do mais recente entre updatedAt e a última mensagem", () => {
  assert.equal(
    atividadeDoChat({ updatedAt: "2026-10-01T14:00:00Z", lastMessage: { messageTimestamp: seg(agora) } }),
    agora,
  );
  assert.equal(atividadeDoChat({ updatedAt: "2026-10-01T15:00:00Z" }), agora);
  // A Evolution às vezes manda o timestamp como texto.
  assert.equal(atividadeDoChat({ lastMessage: { messageTimestamp: String(seg(agora)) } }), agora);
  assert.equal(atividadeDoChat({}), 0);
});

test("pega só conversas de pessoas com atividade depois do ponto de partida", () => {
  const desde = agora - 10 * 60_000;
  const chats = [
    { remoteJid: "5511999999999@s.whatsapp.net", updatedAt: new Date(agora).toISOString() },
    { remoteJid: "123456789@lid", updatedAt: new Date(agora - 60_000).toISOString() },
    { remoteJid: "120363@g.us", updatedAt: new Date(agora).toISOString() }, // grupo
    { remoteJid: "status@broadcast", updatedAt: new Date(agora).toISOString() },
    { remoteJid: "5511888888888@s.whatsapp.net", updatedAt: new Date(agora - 60 * 60_000).toISOString() }, // antiga
  ];
  const r = chatsComAtividade(chats, desde);
  assert.deepEqual(r.map((c) => c.jid), ["5511999999999@s.whatsapp.net", "123456789@lid"]);
});

test("a folga de 2 minutos cobre diferença de relógio", () => {
  const desde = agora;
  const chats = [{ remoteJid: "5511999999999@s.whatsapp.net", updatedAt: new Date(agora - 90_000).toISOString() }];
  assert.equal(chatsComAtividade(chats, desde).length, 1);
});

test("respeita o limite por volta, ficando com as mais recentes", () => {
  const chats = Array.from({ length: 10 }, (_, i) => ({
    remoteJid: `55119999900${String(i).padStart(2, "0")}@s.whatsapp.net`,
    updatedAt: new Date(agora - i * 1000).toISOString(),
  }));
  const r = chatsComAtividade(chats, agora - 60_000, 3);
  assert.equal(r.length, 3);
  assert.equal(r[0].jid, "5511999990000@s.whatsapp.net");
});
