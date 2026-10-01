import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Hash de senha com scrypt (embutido no Node — nenhuma dependência nova).
 *
 * Formato guardado: scrypt$N$r$p$<sal>$<hash>, tudo em base64url. Os
 * parâmetros vão junto para dar para endurecer o custo no futuro sem
 * invalidar as senhas que já existem.
 */

const N = 16384;
const R = 8;
const P = 1;
const TAMANHO = 64;

function derivar(senha: string, sal: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(senha.normalize("NFKC"), sal, TAMANHO, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (erro, chave) =>
      erro ? reject(erro) : resolve(chave),
    ),
  );
}

export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const chave = await derivar(senha, sal, N, R, P);
  return ["scrypt", N, R, P, sal.toString("base64url"), chave.toString("base64url")].join("$");
}

export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const [alg, n, r, p, sal, hash] = guardado.split("$");
  if (alg !== "scrypt" || !sal || !hash) return false;
  const esperado = Buffer.from(hash, "base64url");
  const obtido = await derivar(senha, Buffer.from(sal, "base64url"), Number(n), Number(r), Number(p));
  // Comparação em tempo constante: `===` vazaria quantos bytes acertaram.
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

/** Regra mínima: comprida o bastante para não cair em força bruta trivial. */
export function senhaFraca(senha: string): string | null {
  if (senha.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  return null;
}
