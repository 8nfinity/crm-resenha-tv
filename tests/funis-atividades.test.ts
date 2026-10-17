import { test } from "node:test";
import assert from "node:assert/strict";
import { sinalDoLead } from "../lib/atividades";
import { FILTROS_LISTA_PADRAO, filtrarLista, type FiltrosLista, type ItemDaLista } from "../lib/lista-atividades";
import { copiaDecideOEstagio } from "../lib/mesclar-contatos";
import { escolherFunil } from "../lib/funis";

// Quarta-feira, 15/10/2026, 14:00 no fuso local.
const agora = new Date(2026, 9, 15, 14, 0);
const iso = (d: number, h = 9, mes = 9) => new Date(2026, mes, d, h, 0).toISOString();

// ─── Ícone de atividades no card ─────────────────────────────────────────────

test("ícone: sem atividade marcada é o amarelo", () => {
  assert.equal(sinalDoLead(null, agora), "nenhuma");
});

test("ícone: prazo vencido é vermelho, inclusive hoje mais cedo", () => {
  assert.equal(sinalDoLead({ dueAt: iso(14) }, agora), "atrasada");
  assert.equal(sinalDoLead({ dueAt: iso(15, 9) }, agora), "atrasada");
});

test("ícone: hoje mais tarde é verde; outro dia ou sem data é cinza", () => {
  assert.equal(sinalDoLead({ dueAt: iso(15, 18) }, agora), "hoje");
  assert.equal(sinalDoLead({ dueAt: iso(16) }, agora), "futura");
  assert.equal(sinalDoLead({ dueAt: null }, agora), "futura");
});

// ─── Lista de atividades ─────────────────────────────────────────────────────

function item(p: Partial<ItemDaLista> & { id: string }): ItemDaLista & { id: string } {
  return {
    tipo: "FOLLOW_UP",
    title: null,
    dueAt: null,
    doneAt: null,
    deal: { nome: "Lead", telefone: null, funilId: "f1" },
    responsavel: null,
    ...p,
  };
}

const itens = [
  item({ id: "atrasada", dueAt: iso(10) }),
  item({ id: "hoje-cedo", dueAt: iso(15, 9) }),
  item({ id: "hoje-tarde", dueAt: iso(15, 18) }),
  item({ id: "amanha", dueAt: iso(16) }),
  item({ id: "domingo", dueAt: iso(18) }),
  item({ id: "prox-segunda", dueAt: iso(19) }),
  item({ id: "longe", dueAt: iso(5, 9, 11) }),
  item({ id: "sem-data" }),
  item({ id: "feita", dueAt: iso(14), doneAt: iso(14, 10) }),
];
const filtrar = (f: Partial<FiltrosLista>) =>
  filtrarLista(itens, { ...FILTROS_LISTA_PADRAO, ...f }, agora).map((a) => a.id);

test("lista: 'Para fazer' é tudo em aberto, do mais atrasado ao sem data", () => {
  assert.deepEqual(filtrar({ periodo: "para-fazer" }), [
    "atrasada",
    "hoje-cedo",
    "hoje-tarde",
    "amanha",
    "domingo",
    "prox-segunda",
    "longe",
    "sem-data",
  ]);
});

test("lista: Vencido, Hoje e Amanhã", () => {
  assert.deepEqual(filtrar({ periodo: "vencido" }), ["atrasada", "hoje-cedo"]);
  assert.deepEqual(filtrar({ periodo: "hoje" }), ["hoje-cedo", "hoje-tarde"]);
  assert.deepEqual(filtrar({ periodo: "amanha" }), ["amanha"]);
});

test("lista: a semana vai de segunda a domingo", () => {
  // Semana de 12/10 (segunda) a 18/10 (domingo).
  assert.deepEqual(filtrar({ periodo: "esta-semana" }), ["hoje-cedo", "hoje-tarde", "amanha", "domingo"]);
  assert.deepEqual(filtrar({ periodo: "proxima-semana" }), ["prox-segunda"]);
});

test("lista: Concluídas mostra só as feitas; Período inclui feitas e abertas", () => {
  assert.deepEqual(filtrar({ periodo: "concluidas" }), ["feita"]);
  assert.deepEqual(filtrar({ periodo: "periodo", de: "2026-10-14", ate: "2026-10-15" }), ["feita", "hoje-cedo", "hoje-tarde"]);
});

test("lista: tipo, responsável, funil e busca por telefone", () => {
  const varios = [
    item({ id: "a", tipo: "CALL", responsavel: { id: "u1" }, deal: { nome: "Ana", telefone: "+55 51 98540-9366", funilId: "f1" } }),
    item({ id: "b", tipo: "FOLLOW_UP", responsavel: { id: "u2" }, deal: { nome: "Bia", telefone: null, funilId: "f2" } }),
    item({ id: "c", tipo: "k:proprio", responsavel: null, deal: { nome: "Caio", telefone: null, funilId: "f1" } }),
  ];
  const f = (p: Partial<FiltrosLista>) => filtrarLista(varios, { ...FILTROS_LISTA_PADRAO, ...p }, agora).map((a) => a.id);
  assert.deepEqual(f({ tipos: ["CALL", "k:proprio"] }), ["a", "c"]);
  assert.deepEqual(f({ responsavel: "u2" }), ["b"]);
  assert.deepEqual(f({ responsavel: "-" }), ["c"]);
  assert.deepEqual(f({ funil: "f1" }), ["a", "c"]);
  assert.deepEqual(f({ busca: "98540" }), ["a"]);
  assert.deepEqual(f({ busca: "bia" }), ["b"]);
});

// ─── Vários funis ────────────────────────────────────────────────────────────

test("funil: o pedido se existir, senão o primeiro", () => {
  const funis = [
    { id: "cap", name: "Captação", order: 0 },
    { id: "rel", name: "Relacionamento", order: 1 },
  ];
  assert.equal(escolherFunil(funis, "rel")?.id, "rel");
  assert.equal(escolherFunil(funis, "apagado")?.id, "cap");
  assert.equal(escolherFunil(funis, undefined)?.id, "cap");
  assert.equal(escolherFunil([], "rel"), null);
});

test("juntar leads: a cópia parada na primeira coluna de QUALQUER funil não puxa o lead", () => {
  const primeiras = new Set(["novo-captacao", "novo-relacionamento"]);
  const antes = new Date(2026, 9, 1);
  const depois = new Date(2026, 9, 10);
  assert.equal(
    copiaDecideOEstagio({ stageId: "proposta", enteredStageAt: antes }, { stageId: "novo-relacionamento", enteredStageAt: depois }, primeiras),
    false,
  );
  // Lead parado na entrada de um funil; a cópia andou em outro: vale a cópia.
  assert.equal(
    copiaDecideOEstagio({ stageId: "novo-captacao", enteredStageAt: depois }, { stageId: "reuniao-rel", enteredStageAt: antes }, primeiras),
    true,
  );
});
