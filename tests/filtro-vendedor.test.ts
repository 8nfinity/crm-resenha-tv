import { test } from "node:test";
import assert from "node:assert/strict";
import { FILTROS_VAZIOS, SEM_VENDEDOR, aplicarFiltros, filtrosAtivos } from "../components/kanban/board-filters";
import type { DealCard } from "../lib/types";

const card = (id: string, vendedor: string | null): DealCard => ({
  id,
  stageId: "s",
  title: id,
  score: 50,
  scoreSummary: "",
  scoreFactors: [],
  value: null,
  contact: { id, name: id, phone: null, profilePicUrl: null },
  account: { id: "a", label: "A", color: "#000" },
  lastInboundAt: null,
  lastInteractionAt: null,
  enteredStageAt: new Date().toISOString(),
  vendedor,
  daysInStage: 0,
  lastMessagePreview: null,
  openActivities: 0,
  customValues: {},
});

const deals = [card("l1", "Rodrigo"), card("l2", "Henrique"), card("l3", null)];

test("filtro de vendedor mostra só os leads dele", () => {
  const r = aplicarFiltros(deals, { ...FILTROS_VAZIOS, vendedor: "Rodrigo" });
  assert.deepEqual(r.map((d) => d.id), ["l1"]);
});

test("filtro 'Sem vendedor' mostra quem ainda não foi etiquetado", () => {
  const r = aplicarFiltros(deals, { ...FILTROS_VAZIOS, vendedor: SEM_VENDEDOR });
  assert.deepEqual(r.map((d) => d.id), ["l3"]);
});

test("busca acha pelo nome do vendedor e o filtro conta como ativo", () => {
  assert.deepEqual(aplicarFiltros(deals, { ...FILTROS_VAZIOS, busca: "henri" }).map((d) => d.id), ["l2"]);
  assert.equal(filtrosAtivos({ ...FILTROS_VAZIOS, vendedor: "Rodrigo" }), 1);
});
