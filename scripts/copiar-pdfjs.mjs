/**
 * Copia os arquivos do leitor de PDF (pdf.js) para public/pdfjs.
 *
 * O leitor de e-book do playbook roda no navegador e precisa buscar estes
 * arquivos do próprio CRM: o "worker" (que lê o PDF sem travar a tela), as
 * fontes padrão, os mapas de caracteres e os decodificadores de imagem.
 * Servir daqui (e não de um CDN) mantém a política de segurança fechada:
 * nada de script de fora.
 *
 * Roda sozinho antes do `npm run dev` e do `npm run build` (predev/prebuild),
 * então a pasta não vai para o Git e acompanha a versão instalada.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const origem = join(raiz, "node_modules", "pdfjs-dist");
const destino = join(raiz, "public", "pdfjs");

if (!existsSync(origem)) {
  console.warn("pdfjs-dist não instalado — leitor de e-book sem arquivos. Rode npm install.");
  process.exit(0);
}

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
cpSync(join(origem, "build", "pdf.worker.min.mjs"), join(destino, "pdf.worker.min.mjs"));
for (const pasta of ["standard_fonts", "cmaps", "wasm", "iccs"]) {
  if (existsSync(join(origem, pasta))) cpSync(join(origem, pasta), join(destino, pasta), { recursive: true });
}
console.log("Leitor de e-book: arquivos do pdf.js copiados para public/pdfjs");
