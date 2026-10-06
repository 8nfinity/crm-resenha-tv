import { test } from "node:test";
import assert from "node:assert/strict";
import { arquivoDaFoto, avisoEscondeOLid, outroIdentificadorDaMensagem, variantesDoTelefone } from "../lib/identidade-contato";
import { copiaDecideOEstagio } from "../lib/mesclar-contatos";
import { emFila } from "../lib/fila";

/**
 * A mesma pessoa pelo telefone e pelo LID. Estes casos são o formato REAL em
 * que a Evolution 2.3 grava as mensagens (conferido no código dela): errar
 * aqui é o que criava um lead duplicado a cada etiqueta que chegava pelo LID
 * — e o card de verdade não andava.
 */

const PN = "5511987654321@s.whatsapp.net";
const LID = "62194827364@lid";

test("LID → telefone: acha pelos dois jeitos que a Evolution grava a mensagem", () => {
  // Quem escreve pelo LID: gravada com o LID em remoteJid e o telefone ao lado.
  assert.equal(outroIdentificadorDaMensagem({ key: { remoteJid: LID, remoteJidAlt: PN } }, LID), PN);
  // Quem escreve pelo telefone: o LID fica SÓ no remoteJidAlt. Era o caso que
  // o CRM não achava (procurava o LID só no remoteJid).
  assert.equal(outroIdentificadorDaMensagem({ key: { remoteJid: PN, remoteJidAlt: LID } }, LID), PN);
  // Versões antigas da Evolution mandavam o telefone em senderPn.
  assert.equal(outroIdentificadorDaMensagem({ key: { remoteJid: LID, senderPn: PN } }, LID), PN);
});

test("telefone → LID, e nada inventado quando a mensagem não diz", () => {
  assert.equal(outroIdentificadorDaMensagem({ key: { remoteJid: PN, remoteJidAlt: LID } }, PN), LID);
  assert.equal(outroIdentificadorDaMensagem({ key: { remoteJid: LID, remoteJidAlt: PN } }, PN), LID);
  // O aviso que a Evolution manda ao CRM troca o LID pelo telefone nos dois campos.
  assert.equal(outroIdentificadorDaMensagem({ key: { remoteJid: PN, remoteJidAlt: PN } }, PN), null);
  // Mensagem de outra conversa não revela nada sobre esta.
  assert.equal(outroIdentificadorDaMensagem({ key: { remoteJid: "999@s.whatsapp.net" } }, LID), null);
  assert.equal(outroIdentificadorDaMensagem({}, LID), null);
});

test("aviso de mensagem com o LID escondido: é quando o CRM relê a mensagem na Evolution", () => {
  // Quem escreve pelo LID: a Evolution troca o LID pelo telefone nos dois campos.
  assert.equal(avisoEscondeOLid({ key: { id: "1", remoteJid: PN, remoteJidAlt: PN, addressingMode: "lid" } }), true);
  assert.equal(avisoEscondeOLid({ key: { id: "1", remoteJid: PN, remoteJidAlt: PN } }), true, "mesmo sem o addressingMode");
  assert.equal(avisoEscondeOLid({ key: { id: "1", remoteJid: PN, addressingMode: "lid" } }), true, "mesmo sem o remoteJidAlt");
  // O aviso já mostra o LID (quem escreve pelo telefone): nada escondido.
  assert.equal(avisoEscondeOLid({ key: { id: "1", remoteJid: PN, remoteJidAlt: LID, addressingMode: "pn" } }), false);
  // Conversa pelo telefone sem o outro lado, ou que chegou pelo próprio LID: nada a buscar.
  assert.equal(avisoEscondeOLid({ key: { id: "1", remoteJid: PN } }), false);
  assert.equal(avisoEscondeOLid({ key: { id: "1", remoteJid: LID } }), false);
  assert.equal(avisoEscondeOLid({}), false);
});

test("foto de perfil: o arquivo identifica a pessoa, sem a assinatura que muda a cada pedido", () => {
  // Formato real devolvido pelo WhatsApp (a mesma pessoa pelo LID e pelo telefone).
  const pelaLid =
    "https://pps.whatsapp.net/v/t61.24694-24/761236504_1369317727887550_1782546312973305809_n.jpg?ccb=11-4&oh=01_Q5Aa2wE&oe=68F1A2B3&_nc_sid=5e03e0&_nc_cat=105";
  const peloTelefone =
    "https://pps.whatsapp.net/v/t61.24694-24/761236504_1369317727887550_1782546312973305809_n.jpg?ccb=11-4&oh=01_OUTRA&oe=68F9C0DE&_nc_sid=5e03e0&_nc_cat=109";
  assert.equal(arquivoDaFoto(pelaLid), arquivoDaFoto(peloTelefone));
  assert.equal(arquivoDaFoto(pelaLid), "/v/t61.24694-24/761236504_1369317727887550_1782546312973305809_n.jpg");
  assert.notEqual(
    arquivoDaFoto(pelaLid),
    arquivoDaFoto("https://pps.whatsapp.net/v/t61.24694-24/534423706_1660731988168521_3220736755575974958_n.jpg?oh=x"),
    "outra foto, outra pessoa",
  );
  // Sem foto, ou algo que não é endereço de imagem: não serve para comparar.
  assert.equal(arquivoDaFoto(null), null);
  assert.equal(arquivoDaFoto(""), null);
  assert.equal(arquivoDaFoto("não é endereço"), null);
  assert.equal(arquivoDaFoto("https://pps.whatsapp.net/v/"), null);
});

test("o mesmo celular com e sem o 9 da frente", () => {
  const com9 = "5511987654321@s.whatsapp.net";
  const sem9 = "551187654321@s.whatsapp.net";
  assert.deepEqual(variantesDoTelefone(com9), [com9, sem9]);
  assert.deepEqual(variantesDoTelefone(sem9), [com9, sem9]);
  // Fixo não ganhou o 9: não tem variante.
  assert.deepEqual(variantesDoTelefone("551133334444@s.whatsapp.net"), ["551133334444@s.whatsapp.net"]);
  // Fora do Brasil e LID: só ele mesmo.
  assert.deepEqual(variantesDoTelefone("14155550123@s.whatsapp.net"), ["14155550123@s.whatsapp.net"]);
  assert.deepEqual(variantesDoTelefone(LID), [LID]);
});

test("juntar duplicados não desfaz o movimento da etiqueta", () => {
  const primeira = "novo";
  const antes = new Date("2026-10-01T10:00:00Z");
  const depois = new Date("2026-10-05T10:00:00Z");

  // A etiqueta caiu na cópia (pelo LID) depois: vale o estágio dela.
  assert.equal(
    copiaDecideOEstagio({ stageId: "contato", enteredStageAt: antes }, { stageId: "qualificado", enteredStageAt: depois }, primeira),
    true,
  );
  // O lead que fica andou depois da cópia: fica onde está.
  assert.equal(
    copiaDecideOEstagio({ stageId: "proposta", enteredStageAt: depois }, { stageId: "qualificado", enteredStageAt: antes }, primeira),
    false,
  );
  // Cópia parada na primeira coluna nunca puxa o lead de volta, por mais nova que seja.
  assert.equal(
    copiaDecideOEstagio({ stageId: "proposta", enteredStageAt: antes }, { stageId: primeira, enteredStageAt: depois }, primeira),
    false,
  );
  // O lead que fica ainda está na primeira coluna e a cópia andou: vale a cópia.
  assert.equal(
    copiaDecideOEstagio({ stageId: primeira, enteredStageAt: depois }, { stageId: "qualificado", enteredStageAt: antes }, primeira),
    true,
  );
});

test("juntar à mão: fica o card do telefone; entre iguais, o de mais conversa", async () => {
  const { qualFica } = await import("../lib/juntar-leads");
  const fone = (dealId: string, mensagens: number) => ({ dealId, waJid: PN, mensagens });
  const lid = (dealId: string, mensagens: number) => ({ dealId, waJid: LID, mensagens });
  // O caso da Helena: a cópia pelo LID (sem conversa) foi aberta; fica o do telefone.
  assert.equal(qualFica(lid("copia", 0), fone("helena", 15)), "helena");
  assert.equal(qualFica(fone("helena", 15), lid("copia", 0)), "helena");
  // Telefone ganha mesmo com menos conversa: é ele que mostra o número.
  assert.equal(qualFica(lid("a", 300), fone("b", 2)), "b");
  // Dois do mesmo tipo: mais conversa; empate, o que está aberto.
  assert.equal(qualFica(lid("a", 3), lid("b", 9)), "b");
  assert.equal(qualFica(fone("a", 5), fone("b", 5)), "a");
});

test("uma etiquetagem presa não para a fila: as seguintes andam depois do limite", async () => {
  const feitos: string[] = [];
  // Presa para sempre (a Evolution que não responde).
  void emFila("teste:presa", () => new Promise<void>(() => {}), 40);
  const seguinte = emFila(
    "teste:presa",
    async () => {
      feitos.push("seguinte");
      return "ok";
    },
    40,
  );
  assert.equal(await seguinte, "ok");
  assert.deepEqual(feitos, ["seguinte"]);
});

test("lead sem nome: o que serve como nome e o número digitado no card", async () => {
  const { nomeUtilizavel, telefoneDigitado } = await import("../lib/perfil-contato");
  assert.equal(nomeUtilizavel("Helena Kieling"), "Helena Kieling");
  assert.equal(nomeUtilizavel("  Mãe "), "Mãe");
  // Lixo que o WhatsApp devolve como nome.
  assert.equal(nomeUtilizavel("$"), null);
  assert.equal(nomeUtilizavel("24777733476556"), null, "o próprio código");
  assert.equal(nomeUtilizavel("+55 51 8540-9366"), null, "número não é nome");
  assert.equal(nomeUtilizavel("x"), null);
  assert.equal(nomeUtilizavel(null), null);

  assert.equal(telefoneDigitado("(51) 98540-9366"), "5551985409366@s.whatsapp.net", "sem o 55: Brasil");
  assert.equal(telefoneDigitado("51 8540-9366"), "555185409366@s.whatsapp.net", "celular antigo, sem o 9");
  assert.equal(telefoneDigitado("+55 51 98540-9366"), "5551985409366@s.whatsapp.net");
  assert.equal(telefoneDigitado("5551985409366"), "5551985409366@s.whatsapp.net", "com o 55, sem +");
  assert.equal(telefoneDigitado("+1 415 555 0123"), "14155550123@s.whatsapp.net", "com +, vale o país digitado");
  assert.equal(telefoneDigitado("415 555 0123 99"), null, "sem + e sem cara de número brasileiro");
  assert.equal(telefoneDigitado("1234"), null);
  assert.equal(telefoneDigitado("abc"), null);
});
