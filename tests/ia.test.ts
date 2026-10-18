import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FERRAMENTAS,
  contextoDoLead,
  dividirEmMensagens,
  historicoParaClaude,
  instrucoes,
  tempoDigitando,
} from "../lib/ia/prompt";

const msg = (fromMe: boolean, body: string | null, type = "TEXT") => ({ fromMe, porIA: false, type, body });

test("ia: conversa começa pelo contato e junta mensagens seguidas do mesmo lado", () => {
  const h = historicoParaClaude([
    msg(true, "Mensagem antiga da equipe"),
    msg(false, "Oi"),
    msg(false, "Quero anunciar"),
    msg(true, "Olá! Qual o seu negócio?"),
    msg(false, "Uma padaria"),
  ]);
  assert.deepEqual(h, [
    { role: "user", content: "Oi\n\nQuero anunciar" },
    { role: "assistant", content: "Olá! Qual o seu negócio?" },
    { role: "user", content: "Uma padaria" },
  ]);
});

test("ia: mídia sem texto vira um aviso que a IA entende (áudio pede para escrever)", () => {
  const [turno] = historicoParaClaude([msg(false, null, "AUDIO")]);
  assert.match(String(turno.content), /áudio.*escrever/);
  assert.equal(historicoParaClaude([msg(true, "só nós")]).length, 0);
});

test("ia: resposta vira até 4 mensagens, separadas por linha em branco", () => {
  assert.deepEqual(dividirEmMensagens("Oi!\n\nTudo bem?"), ["Oi!", "Tudo bem?"]);
  assert.deepEqual(dividirEmMensagens("uma linha\nsó"), ["uma linha\nsó"]);
  assert.deepEqual(dividirEmMensagens("a\n\nb\n\nc\n\nd\n\ne"), ["a", "b", "c", "d\n\ne"]);
  assert.deepEqual(dividirEmMensagens("   \n\n  "), []);
});

test("ia: 'digitando…' proporcional ao tamanho, entre 1,5 e 6 segundos", () => {
  assert.equal(tempoDigitando("oi"), 1500);
  assert.equal(tempoDigitando("x".repeat(100)), 4500);
  assert.equal(tempoDigitando("x".repeat(1000)), 6000);
});

test("ia: instruções trazem o que a empresa escreveu e avisam quando falta", () => {
  const cheio = instrucoes({
    nome: "Lia",
    empresa: "Vendemos anúncios.",
    qualificacao: "Perguntar a cidade.",
    agenda: "Por videochamada.",
    regras: "",
    horario: "Atendimento para reuniões: segunda, 09:00–12:00.",
  });
  assert.match(cheio, /Você é Lia/);
  assert.match(cheio, /Vendemos anúncios\./);
  assert.match(cheio, /segunda, 09:00–12:00/);
  // Com horário definido, ela sempre consulta o calendário antes de oferecer.
  assert.match(cheio, /SEMPRE use ver_horarios_livres/);
  assert.match(cheio, /Como acontece a reunião: Por videochamada\./);
  assert.doesNotMatch(cheio, /Regras da empresa/);

  const vazio = instrucoes({ nome: "Lia", empresa: "", qualificacao: "", agenda: "", regras: "" });
  // Sem agenda definida ela não marca reunião: passa para a equipe.
  assert.match(vazio, /Não marque reunião/);
});

test("ia: contexto do lead traz a hora de Brasília e a reunião já marcada", () => {
  const c = contextoDoLead({
    agora: new Date("2026-10-18T15:00:00Z"),
    nome: "Ana",
    telefone: "+55 51 98540-9366",
    coluna: "Novo lead",
    qualificado: true,
    reunioes: [{ quando: new Date("2026-10-20T17:30:00Z") }],
  });
  assert.match(c, /12:00/); // 15:00 UTC = 12:00 em Brasília
  assert.match(c, /já qualificado/);
  assert.match(c, /14:30/);
  assert.match(c, /Não marque outra/);
});

test("ia: ferramentas estritas, com todos os campos obrigatórios", () => {
  assert.deepEqual(
    FERRAMENTAS.map((f) => f.name),
    ["ver_horarios_livres", "registrar_qualificacao", "agendar_reuniao", "passar_para_humano"],
  );
  for (const f of FERRAMENTAS) {
    assert.equal(f.strict, true);
    const schema = f.input_schema as unknown as { properties: object; required: string[]; additionalProperties: boolean };
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort());
  }
});
