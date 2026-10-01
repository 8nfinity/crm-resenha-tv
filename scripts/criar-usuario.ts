import "dotenv/config";
import { createInterface } from "node:readline";
import { prisma } from "../lib/db";
import { gerarHash, senhaFraca } from "../lib/auth/senha";

/**
 * Cria (ou redefine a senha de) um usuário pelo terminal:
 *
 *   npm run usuario:criar
 *
 * É o jeito de criar o primeiro administrador sem a senha passar por lugar
 * nenhum além do seu teclado. A senha não aparece enquanto você digita.
 */

const rl = createInterface({ input: process.stdin, output: process.stdout });
const perguntar = (texto: string) => new Promise<string>((r) => rl.question(texto, (v) => r(v.trim())));

function perguntarSenha(texto: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(texto);
    // Silencia o eco: o que for digitado não aparece no terminal.
    const saida = rl as unknown as { _writeToOutput?: (s: string) => void };
    const original = saida._writeToOutput;
    saida._writeToOutput = () => {};
    rl.question("", (valor) => {
      saida._writeToOutput = original;
      process.stdout.write("\n");
      resolve(valor);
    });
  });
}

async function main() {
  console.log("\nCriar acesso ao CRM Biomech\n");
  const name = await perguntar("Nome: ");
  const email = (await perguntar("E-mail: ")).toLowerCase();
  const papel = (await perguntar("Administrador? (S/n): ")).toLowerCase();
  const role = papel === "n" ? "VENDEDOR" : "ADMIN";

  if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Nome ou e-mail inválido.");
  }

  const senha = await perguntarSenha("Senha (mín. 8, não aparece ao digitar): ");
  const fraca = senhaFraca(senha);
  if (fraca) throw new Error(fraca);
  if ((await perguntarSenha("Repita a senha: ")) !== senha) throw new Error("As senhas não conferem.");

  const passwordHash = await gerarHash(senha);
  const existente = await prisma.user.findUnique({ where: { email } });
  if (existente) {
    await prisma.user.update({
      where: { email },
      data: { name, role, passwordHash, active: true, sessionVersion: { increment: 1 } },
    });
    console.log(`\nAcesso de ${email} atualizado (senha nova, ${role === "ADMIN" ? "administrador" : "vendedor"}).`);
  } else {
    await prisma.user.create({ data: { name, email, role, passwordHash } });
    console.log(`\nAcesso criado: ${email} (${role === "ADMIN" ? "administrador" : "vendedor"}).`);
  }
}

main()
  .catch((erro) => {
    console.error(`\nNão foi possível: ${(erro as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
