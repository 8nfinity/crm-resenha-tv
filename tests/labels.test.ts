import { test } from "node:test";
import assert from "node:assert/strict";
import { isPersonJid } from "../lib/evolution/parse";

/**
 * Regras da automação por etiqueta.
 *
 * Aqui só entra a lógica pura de decisão — o caminho completo depende do banco
 * e é verificado ponta a ponta com um webhook simulado. O que estes testes
 * protegem são as decisões que não podem mudar por acidente.
 */

/**
 * Espelha a decisão de `handleLabelAssociation`: só "add" move o lead.
 *
 * Tirar a etiqueta "Reunião marcada" não diz para onde o lead deveria voltar.
 * Adivinhar o estágio anterior bagunçaria o histórico de conversão — que é
 * justamente o dado impossível de reconstruir depois.
 */
function deveMover(tipo: string): boolean {
  return tipo === "add";
}

test("só a aplicação de etiqueta move o lead, nunca a remoção", () => {
  assert.equal(deveMover("add"), true);
  assert.equal(deveMover("remove"), false, "remover não pode desfazer o estágio");
  assert.equal(deveMover(""), false, "payload sem tipo não move nada");
  assert.equal(deveMover("ADD"), false, "a Evolution manda minúsculo; maiúsculo é suspeito");
});

test("etiqueta em grupo ou status não vira lead", () => {
  // Uma conversa de grupo pode receber etiqueta no WhatsApp Business, mas
  // grupo não é pessoa e não pertence a um funil de vendas.
  assert.equal(isPersonJid("120363001234567890@g.us"), false, "grupo");
  assert.equal(isPersonJid("status@broadcast"), false, "status");
  assert.equal(isPersonJid("5511999999999@s.whatsapp.net"), true, "pessoa");
  assert.equal(isPersonJid("62194827364@lid"), true, "pessoa no formato novo");
});

/** Espelha a normalização de evento feita no webhook. */
function normalizarEvento(evento: string): string {
  return evento.toLowerCase().replace(/_/g, ".");
}

test("reconhece o evento de etiquetagem nas duas grafias", () => {
  // A Evolution já mandou "LABELS_ASSOCIATION" e "labels.association" em
  // versões diferentes. Reconhecer só uma faria a automação falhar em silêncio
  // numa atualização da Evolution.
  assert.equal(normalizarEvento("LABELS_ASSOCIATION"), "labels.association");
  assert.equal(normalizarEvento("labels.association"), "labels.association");
  assert.equal(normalizarEvento("LABELS_EDIT"), "labels.edit");
});

test("atendente: o histórico conta quem atendeu e a passagem entre atendentes", async () => {
  const { textoDoAtendimento, nomeDoAtendente } = await import("../lib/labels");
  assert.equal(textoDoAtendimento(null, "João"), null, "primeiro atendimento: só 'João atendeu o lead'");
  assert.equal(textoDoAtendimento("João", "Maria"), "Atendimento passou de João para Maria");
  assert.equal(textoDoAtendimento("Maria", "Maria"), "Maria continuou o atendimento");
  assert.equal(nomeDoAtendente({ name: "  João " }), "João");
  assert.equal(nomeDoAtendente({ name: "" }), "Atendente");
});

test("listas automáticas do WhatsApp ficam de fora; listas criadas e Favoritos entram", async () => {
  const { corrigirNomeEtiqueta, ehFiltroAutomatico } = await import("../lib/etiquetas-nomes");
  for (const nome of ["No lidas", "Não lidas", "Grupos", "Comunidades", "Unread"]) {
    assert.equal(ehFiltroAutomatico(nome), true, nome);
  }
  for (const nome of ["Favoritos", "Follow up", "Novo cliente", "João"]) {
    assert.equal(ehFiltroAutomatico(nome), false, nome);
  }
  assert.equal(corrigirNomeEtiqueta("No lidas"), "Não lidas");
  assert.equal(corrigirNomeEtiqueta("Follow up"), "Follow up");
});

test("nome com acento: a lista da Evolution (sem acento) não estraga o nome certo", async () => {
  const { nomeComoAEvolutionGuarda, nomeParaGuardar } = await import("../lib/etiquetas-nomes");
  // A Evolution apaga tudo que não é ASCII.
  assert.equal(nomeComoAEvolutionGuarda("Negociação"), "Negociao");
  assert.equal(nomeComoAEvolutionGuarda("🔥 Quente"), "Quente");

  // O evento do celular trouxe o nome certo; a lista traz sem acento: fica o certo.
  assert.equal(nomeParaGuardar("Negociação", "Negociao"), "Negociação");
  assert.equal(nomeParaGuardar("🔥 Quente", "Quente"), "🔥 Quente");
  assert.equal(nomeParaGuardar("Não lidas", "No lidas"), "Não lidas");
  // Renomeada no celular: vale o nome novo.
  assert.equal(nomeParaGuardar("Negociação", "Fechamento"), "Fechamento");
  // Nome provisório ("Etiqueta 12", de antes de o nome chegar) é trocado.
  assert.equal(nomeParaGuardar("Etiqueta 12", "Follow up"), "Follow up");
  assert.equal(nomeParaGuardar(null, "No lidas"), "Não lidas");
  // Nome só de emoji: a Evolution guarda vazio. Fica o que o CRM já tem.
  assert.equal(nomeParaGuardar("🔥", ""), "🔥");
  assert.equal(nomeParaGuardar("Etiqueta 7", ""), "Etiqueta 7");
  assert.equal(nomeParaGuardar(null, "  "), null, "sem nome nenhum: quem chama usa o provisório");
});

test("lista de etiquetas da Evolution: etiqueta de nome vazio (só emoji) continua existindo", async () => {
  const { lerEtiquetas } = await import("../lib/evolution/client");
  const lidas = lerEtiquetas([
    { labelId: "5", name: "Qualificado", color: "1" },
    { labelId: "7", name: "", color: "2" },
    { id: 9, name: "VIP" },
    { name: "sem id" },
    null,
  ]);
  assert.deepEqual(
    lidas.map((l) => [l.labelId, l.name]),
    [
      ["5", "Qualificado"],
      ["7", ""],
      ["9", "VIP"],
    ],
    "sem id não serve; sem nome serve (senão a sincronização apagava a etiqueta)",
  );
  assert.deepEqual(lerEtiquetas({ erro: true }), [], "resposta que não é lista");
});

test("o CRM não tem como escrever nas etiquetas do WhatsApp", async () => {
  // Retirar uma etiqueta (mesmo inexistente) grava uma alteração nos dados da
  // conta e travou a chegada das etiquetas. O cliente da Evolution não pode
  // ter nenhuma operação desse tipo.
  const { evolution } = await import("../lib/evolution/client");
  for (const nome of Object.keys(evolution)) {
    assert.doesNotMatch(nome, /handleLabel|addLabel|removeLabel|chatModify|archive|markRead|markUnread/i, nome);
  }
});

test("lista nova com o nome de um estágio já nasce ligada a ele", async () => {
  const { estagioDeMesmoNome } = await import("../lib/etiquetas-nomes");
  const estagios = [
    { id: "1", name: "Novo lead" },
    { id: "2", name: "Qualificado" },
    { id: "3", name: "Negociação" },
  ];
  assert.equal(estagioDeMesmoNome("Qualificado", estagios)?.id, "2");
  assert.equal(estagioDeMesmoNome("  qualificado ", estagios)?.id, "2", "maiúsculas e espaços não importam");
  assert.equal(estagioDeMesmoNome("✅ Qualificado", estagios)?.id, "2", "emoji não importa");
  // O evento do celular traz o acento; a lista da Evolution, não. Os dois casam.
  assert.equal(estagioDeMesmoNome("Negociação", estagios)?.id, "3");
  assert.equal(estagioDeMesmoNome("Negociao", estagios)?.id, "3");
  assert.equal(estagioDeMesmoNome("Follow up", estagios), null, "sem estágio de mesmo nome: não liga");
  // Pontuação e espaço não importam: "Follow-up" é o estágio "Follow up".
  const comFollow = [...estagios, { id: "4", name: "Follow up" }];
  assert.equal(estagioDeMesmoNome("Follow-up", comFollow)?.id, "4");
  assert.equal(estagioDeMesmoNome("FOLLOWUP", comFollow)?.id, "4");
  assert.equal(estagioDeMesmoNome("🔥", comFollow), null, "nome só de emoji não casa com nada");
  assert.equal(estagioDeMesmoNome("Não lidas", [{ id: "x", name: "Não lidas" }]), null, "lista automática nunca");
});

test("conferência das etiquetas: aplica só o que a Evolution tem e o histórico do CRM não", async () => {
  const { decidirConferencia, idsDasEtiquetas } = await import("../lib/conferencia-etiquetas");
  const PN = "5551999990001@s.whatsapp.net";
  const LID = "200000000000001@lid";
  const acionaveis = new Map([
    ["5", { ignorar: false }], // Qualificado
    ["9", { ignorar: true }], // Ignorar contato
  ]);
  const contatos = [{ id: "c1", waJid: PN, lid: LID }];
  const conversa = (jid: string, etiquetas: string[], recente = false) => ({ jid, etiquetas, recente });

  // Aviso perdido: a Evolution tem, o histórico não → aplica.
  assert.deepEqual(
    decidirConferencia({ conversas: [conversa(LID, ["5"])], acionaveis, contatos, ultimos: new Map() }),
    [{ tipo: "aplicar", chatId: LID, labelId: "5" }],
  );
  // Já registrada (o aviso chegou) → nada. Retirada registrada e posta de novo → aplica.
  assert.deepEqual(
    decidirConferencia({ conversas: [conversa(LID, ["5"])], acionaveis, contatos, ultimos: new Map([["c1:5", "add"]]) }),
    [],
  );
  assert.equal(
    decidirConferencia({ conversas: [conversa(LID, ["5"])], acionaveis, contatos, ultimos: new Map([["c1:5", "remove"]]) }).length,
    1,
  );
  // Etiqueta que não faz nada no CRM (lista "Favoritos", sem estágio) fica de fora.
  assert.deepEqual(decidirConferencia({ conversas: [conversa(LID, ["2"])], acionaveis, contatos, ultimos: new Map() }), []);
  // Conversa mexida agora há pouco: o aviso pode estar a caminho.
  assert.deepEqual(decidirConferencia({ conversas: [conversa(LID, ["5"], true)], acionaveis, contatos, ultimos: new Map() }), []);
  // A mesma pessoa pelo telefone e pelo LID com a mesma etiqueta: aplica uma vez só.
  assert.equal(
    decidirConferencia({ conversas: [conversa(PN, ["5"]), conversa(LID, ["5"])], acionaveis, contatos, ultimos: new Map() }).length,
    1,
  );
  // Conversa que o CRM nunca viu: aplica (a etiqueta traz para o funil).
  assert.deepEqual(
    decidirConferencia({ conversas: [conversa("300000000000009@lid", ["5"])], acionaveis, contatos: [], ultimos: new Map() }),
    [{ tipo: "aplicar", chatId: "300000000000009@lid", labelId: "5" }],
  );

  // Retirada perdida da etiqueta de "ignorar" → retira (o contato volta).
  assert.deepEqual(
    decidirConferencia({ conversas: [conversa(LID, [])], acionaveis, contatos, ultimos: new Map([["c1:9", "add"]]) }),
    [{ tipo: "retirar", chatId: PN, labelId: "9" }],
  );
  // ...mas não se ela ainda está numa das conversas da pessoa, nem sem a conversa na Evolution.
  assert.deepEqual(
    decidirConferencia({ conversas: [conversa(PN, []), conversa(LID, ["9"])], acionaveis, contatos, ultimos: new Map([["c1:9", "add"]]) }),
    [],
  );
  assert.deepEqual(decidirConferencia({ conversas: [], acionaveis, contatos, ultimos: new Map([["c1:9", "add"]]) }), []);
  // Retirada de etiqueta de estágio não move ninguém: a conferência não mexe.
  assert.deepEqual(
    decidirConferencia({ conversas: [conversa(LID, [])], acionaveis, contatos, ultimos: new Map([["c1:5", "add"]]) }),
    [],
  );

  // A coluna da Evolution: lista de texto ou número; qualquer outra coisa é vazio.
  assert.deepEqual(idsDasEtiquetas(["5", 7]), ["5", "7"]);
  assert.deepEqual(idsDasEtiquetas(null), []);
  assert.deepEqual(idsDasEtiquetas({}), []);
});
