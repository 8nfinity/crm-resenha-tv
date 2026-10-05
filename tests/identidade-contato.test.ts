import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoEscondeOLid, outroIdentificadorDaMensagem, variantesDoTelefone } from "../lib/identidade-contato";
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
