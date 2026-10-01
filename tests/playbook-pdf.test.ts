import { test } from "node:test";
import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import { disposicao, ehPdf, extrairTexto, nomeDoArquivo } from "../lib/playbook-pdf";

function pdfDeTeste(linhas: string[]): Uint8Array {
  const doc = new jsPDF();
  linhas.forEach((l, i) => doc.text(l, 20, 20 + i * 10));
  return new Uint8Array(doc.output("arraybuffer"));
}

test("reconhece PDF pela assinatura, não pelo nome", () => {
  assert.equal(ehPdf(pdfDeTeste(["oi"])), true);
  assert.equal(ehPdf(new TextEncoder().encode("<html>não sou pdf</html>")), false);
  assert.equal(ehPdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false); // PNG
});

test("nome do arquivo: sem pasta, sem caracteres de controle, termina em .pdf", () => {
  assert.equal(nomeDoArquivo("C:\\Users\\x\\Playbook 2026.pdf"), "Playbook 2026.pdf");
  assert.equal(nomeDoArquivo("../../etc/passwd"), "passwd.pdf");
  assert.equal(nomeDoArquivo('ro"teiro\u0007.PDF'), "roteiro.PDF");
  assert.equal(nomeDoArquivo(""), "playbook.pdf");
});

test("Content-Disposition aceita nome acentuado", () => {
  const d = disposicao("inline", "Objeções de preço.pdf");
  assert.ok(d.startsWith('inline; filename="Objecoes de preco.pdf"'));
  assert.ok(d.includes("filename*=UTF-8''Obje%C3%A7%C3%B5es%20de%20pre%C3%A7o.pdf"));
});

test("extrai o texto do PDF para a busca", async () => {
  const texto = await extrairTexto(pdfDeTeste(["Roteiro de abertura", "Objecao de preco: mostre o valor"]));
  assert.ok(texto?.includes("Roteiro de abertura"), texto ?? "sem texto");
  assert.ok(texto?.includes("Objecao de preco"));
});

test("PDF quebrado não derruba o envio: só fica sem texto", async () => {
  const texto = await extrairTexto(new TextEncoder().encode("%PDF-1.4 lixo"));
  assert.equal(texto, null);
});
