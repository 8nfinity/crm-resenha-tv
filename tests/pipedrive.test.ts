import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mensagemDeErro,
  mesmoTelefone,
  montarNegocio,
  montarNota,
  montarPessoa,
  urlDoNegocio,
} from "../lib/pipedrive";

test("pipedrive: mesmo telefone em formatos diferentes é a mesma pessoa", () => {
  assert.equal(mesmoTelefone(["+55 51 98540-9366"], "5551985409366"), true);
  assert.equal(mesmoTelefone([{ value: "(51) 98540-9366" }], "5551985409366"), true);
  // Sem o nono dígito: o final de 8 dígitos ainda bate.
  assert.equal(mesmoTelefone(["5185409366"], "5551985409366"), true);
  assert.equal(mesmoTelefone(["+55 51 99999-0000"], "5551985409366"), false);
  // Telefone curto demais não casa com ninguém (evita falso positivo).
  assert.equal(mesmoTelefone(["1234"], "1234"), false);
});

test("pipedrive: pessoa leva o telefone com + e DDI; sem telefone, só o nome", () => {
  assert.deepEqual(montarPessoa("Ana", "5551985409366"), {
    name: "Ana",
    phones: [{ value: "+5551985409366", primary: true, label: "mobile" }],
  });
  assert.deepEqual(montarPessoa("Sem número", null), { name: "Sem número" });
});

test("pipedrive: negócio só leva valor, funil e etapa quando existem", () => {
  assert.deepEqual(montarNegocio({ titulo: "Ana", valor: 2500, personId: 7, pipelineId: 3, stageId: 12 }), {
    title: "Ana",
    person_id: 7,
    value: 2500,
    currency: "BRL",
    pipeline_id: 3,
    stage_id: 12,
  });
  assert.deepEqual(montarNegocio({ titulo: "Bia", valor: null, personId: 8, pipelineId: null, stageId: null }), {
    title: "Bia",
    person_id: 8,
  });
});

test("pipedrive: a nota escapa o texto da conversa e traz o link do lead", () => {
  const nota = montarNota({
    telefone: "+55 51 98540-9366",
    funil: "Captação",
    coluna: "Novo lead",
    mensagens: [
      { fromMe: false, body: "Oi <script>alert(1)</script>", timestamp: new Date("2026-10-15T12:00:00Z") },
      { fromMe: true, body: "   ", timestamp: new Date("2026-10-15T12:01:00Z") },
    ],
    link: "https://crm.exemplo/funil?lead=abc",
  });
  assert.ok(nota.includes("&lt;script&gt;"));
  assert.ok(!nota.includes("<script>"));
  assert.ok(nota.includes("Captação · Novo lead"));
  assert.ok(nota.includes('href="https://crm.exemplo/funil?lead=abc"'));
  // Mensagem vazia (só espaços) não entra.
  assert.equal(nota.match(/<li>/g)?.length, 1);
});

test("pipedrive: erros em português e link do negócio no domínio da empresa", () => {
  assert.match(mensagemDeErro(401), /token/);
  assert.match(mensagemDeErro(429), /esperar/);
  assert.equal(urlDoNegocio("resenhatv", 42), "https://resenhatv.pipedrive.com/deal/42");
});
