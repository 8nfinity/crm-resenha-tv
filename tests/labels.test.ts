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
});

test("conferência da chave das etiquetas: quando perguntar de novo", async () => {
  const { precisaVerificar } = await import("../lib/saude-etiquetas");
  const agora = new Date("2026-10-01T12:00:00Z");
  const minAtras = (m: number) => new Date(agora.getTime() - m * 60_000);
  const conta = (estado: string | null, ha: number | null) => ({
    labelKeyStatus: estado,
    labelKeyCheckedAt: ha === null ? null : minAtras(ha),
  });

  assert.equal(precisaVerificar(conta(null, null), null, agora), true, "nunca conferida");
  assert.equal(precisaVerificar(conta("ok", 60), null, agora), false, "OK há 1 h: espera a rotina");
  assert.equal(precisaVerificar(conta("ok", 7 * 60), null, agora), true, "rotina de 6 h");

  // Reconectou depois da última conferência: é quando a chave pode ter sumido.
  assert.equal(precisaVerificar(conta("ok", 60), minAtras(5), agora), true, "reconexão");
  assert.equal(precisaVerificar(conta("ok", 60), minAtras(0.5), agora), false, "reconexão de agora: espera assentar");
  assert.equal(precisaVerificar(conta("ok", 10), minAtras(5), agora), false, "não confere mais que a cada 30 min");
  assert.equal(precisaVerificar(conta("ok", 60), minAtras(90), agora), false, "reconexão anterior à conferência");

  // Estados passageiros tentam de novo logo; chave perdida só volta com novo pareamento.
  assert.equal(precisaVerificar(conta("sem_chave", 11), null, agora), true);
  assert.equal(precisaVerificar(conta("fora_do_ar", 11), null, agora), true);
  assert.equal(precisaVerificar(conta("desconectado", 11), null, agora), true);
  assert.equal(precisaVerificar(conta("chave_perdida", 11), null, agora), false);
});

test("leitura forçada: cada resposta da Evolution vira o diagnóstico certo", async () => {
  const { classificarFalha } = await import("../lib/saude-etiquetas");
  const corpo = (msg: string) => JSON.stringify({ status: 400, error: "Bad Request", response: { message: [msg] } });

  // Login no banco, chave em arquivo que sumiu: reinício sem volume.
  const perdida = classificarFalha(
    "Evolution API respondeu 400 em /label/handleLabel/crm",
    400,
    corpo('Unable to remove label to chat Error: myAppStateKey ("AAAAAJn5") not present'),
  );
  assert.equal(perdida.estado, "chave_perdida");
  assert.match(perdida.texto, /\/evolution\/instances/);

  assert.equal(classificarFalha("x", 400, corpo("Error: App state key not present!")).estado, "sem_chave");
  // A Evolution respondeu, mas o WhatsApp dentro dela estava com a conexão fechada.
  const fechada = classificarFalha(
    "Evolution API respondeu 400 em /label/handleLabel/crm_muq73euq",
    400,
    corpo("Error: Connection Closed"),
  );
  assert.equal(fechada.estado, "desconectado");
  assert.doesNotMatch(fechada.texto, /Evolution API respondeu/, "mensagem em português, sem o erro técnico");
  // Sem resposta (ou página de erro da hospedagem no lugar da Evolution).
  assert.equal(classificarFalha("Não consegui alcançar a Evolution", 503, "").estado, "fora_do_ar");
  assert.equal(classificarFalha("erro 502 da hospedagem", 502, "<html>").estado, "fora_do_ar");
  // Erro da própria Evolution, com resposta dela: outro problema.
  assert.equal(classificarFalha("Evolution API respondeu 500", 500, '{"status":500}').estado, "erro");
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
  assert.equal(estagioDeMesmoNome("Não lidas", [{ id: "x", name: "Não lidas" }]), null, "lista automática nunca");
});
