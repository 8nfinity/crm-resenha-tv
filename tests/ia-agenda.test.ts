import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirHorario, descreverHorarios, horariosLivres, inicioDoDia, lerRegra } from "../lib/ia/agenda";

// Brasília é UTC−3: 12:00 UTC = 09:00 em Brasília.
const br = (iso: string) => new Date(`${iso}-03:00`);
const hhmm = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(11, 16);

const regra = lerRegra({ agendaDias: "1,2,3,4,5", agendaJanelas: "09:00-12:00,14:00-16:00", duracaoMin: 60, antecedenciaMin: 120 });
// Sábado, 17/10/2026, 10:00 em Brasília.
const agora = br("2026-10-17T10:00:00");

test("agenda: lê dias e faixas, ignorando o que for inválido", () => {
  assert.deepEqual(regra.dias, [1, 2, 3, 4, 5]);
  assert.deepEqual(regra.janelas, [{ ini: 540, fim: 720 }, { ini: 840, fim: 960 }]);
  const ruim = lerRegra({ agendaDias: "9,1,x", agendaJanelas: "12:00-09:00,25:00-26:00,10:00-11:00", duracaoMin: 5, antecedenciaMin: -1 });
  assert.deepEqual(ruim.dias, [1]);
  assert.deepEqual(ruim.janelas, [{ ini: 600, fim: 660 }]);
  assert.equal(ruim.duracaoMin, 10);
  assert.equal(ruim.antecedenciaMin, 0);
});

test("agenda: horários livres pulam fim de semana e o que já está marcado", () => {
  const livres = horariosLivres(regra, {
    agora,
    de: inicioDoDia("2026-10-17", agora), // sábado
    quantosDias: 3, // sáb, dom, seg
    ocupados: [{ inicio: br("2026-10-19T10:00:00"), fim: br("2026-10-19T11:00:00") }],
  });
  assert.deepEqual(livres.map(hhmm), ["09:00", "11:00", "14:00", "15:00"]);
  assert.ok(livres.every((d) => d.toISOString().startsWith("2026-10-19")));
});

test("agenda: respeita a antecedência mínima no próprio dia", () => {
  // Segunda 09:30: com 2 h de antecedência, o primeiro livre é 14:00 (11:00 já não dá: 11:00 < 11:30).
  const seg = br("2026-10-19T09:30:00");
  const livres = horariosLivres(regra, { agora: seg, de: seg, quantosDias: 1, ocupados: [] });
  assert.deepEqual(livres.map(hhmm), ["14:00", "15:00"]);
});

test("agenda: um compromisso que começa no meio do horário também ocupa", () => {
  const livres = horariosLivres(regra, {
    agora,
    de: inicioDoDia("2026-10-19", agora),
    quantosDias: 1,
    ocupados: [{ inicio: br("2026-10-19T09:30:00"), fim: br("2026-10-19T10:30:00") }],
  });
  assert.deepEqual(livres.map(hhmm), ["11:00", "14:00", "15:00"]);
});

test("agenda: confere o horário antes de marcar", () => {
  const ocupados = [{ inicio: br("2026-10-19T14:00:00"), fim: br("2026-10-19T15:00:00") }];
  assert.deepEqual(conferirHorario(regra, { agora, inicio: br("2026-10-19T09:00:00"), ocupados }), { ok: true });
  assert.match((conferirHorario(regra, { agora, inicio: br("2026-10-19T14:00:00"), ocupados }) as { motivo: string }).motivo, /ocupado/);
  assert.match((conferirHorario(regra, { agora, inicio: br("2026-10-18T10:00:00"), ocupados }) as { motivo: string }).motivo, /domingo/);
  assert.match((conferirHorario(regra, { agora, inicio: br("2026-10-19T11:30:00"), ocupados }) as { motivo: string }).motivo, /Fora do horário/);
  assert.match((conferirHorario(regra, { agora, inicio: br("2026-10-17T11:00:00"), ocupados }) as { motivo: string }).motivo, /antecedência/);
});

test("agenda: descrição agrupada por dia, com o ISO que a IA usa para marcar", () => {
  const texto = descreverHorarios([br("2026-10-19T09:00:00"), br("2026-10-19T14:00:00"), br("2026-10-20T09:00:00")]);
  assert.equal(
    texto,
    "segunda 19/10: 09:00 (2026-10-19T09:00:00-03:00), 14:00 (2026-10-19T14:00:00-03:00)\n" +
      "terça 20/10: 09:00 (2026-10-20T09:00:00-03:00)",
  );
  assert.equal(descreverHorarios([]), "Nenhum horário livre nesse período.");
});
