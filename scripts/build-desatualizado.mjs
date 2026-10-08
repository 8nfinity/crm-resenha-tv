// Diz ao iniciar.bat se o build de produção ficou para trás do código.
//
// Sai com código 1 quando algum arquivo-fonte é mais novo que .next/BUILD_ID
// (ou quando não há build), e 0 quando o build está em dia. Sem essa checagem
// o `next start` continua servindo a versão antiga depois de uma mudança, e
// parece que a alteração "não pegou".
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
// public/ também: no `next start`, imagem nova ou trocada só aparece depois do build.
const PASTAS = ["app", "components", "lib", "public"];
const ARQUIVOS = [
  "package.json",
  "next.config.ts",
  "proxy.ts",
  "postcss.config.mjs",
  "prisma/schema.prisma",
];

function mtime(caminho) {
  try {
    return statSync(join(RAIZ, caminho)).mtimeMs;
  } catch {
    return 0;
  }
}

function maisNovoEm(pasta) {
  let max = 0;
  let entradas;
  try {
    entradas = readdirSync(join(RAIZ, pasta), { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entradas) {
    const rel = join(pasta, e.name);
    max = Math.max(max, e.isDirectory() ? maisNovoEm(rel) : mtime(rel));
  }
  return max;
}

const build = mtime(".next/BUILD_ID");
if (!build) process.exit(1);

const codigo = Math.max(...PASTAS.map(maisNovoEm), ...ARQUIVOS.map(mtime));
process.exit(codigo > build ? 1 : 0);
