import { prisma } from "@/lib/db";

/**
 * Linha do tempo da conexão de cada conta: quando o WhatsApp abriu ou caiu e
 * o que deu cada verificação da chave das etiquetas.
 *
 * É ela que responde "a Evolution reiniciou e perdeu os arquivos?": uma
 * reconexão seguida de "chave perdida" é exatamente esse caso.
 */

/** Um mesmo evento repetido dentro deste intervalo vira uma linha só. */
const JANELA_REPETIDO_MS = 60_000;
/** Mais que isso não ajuda a diagnosticar nada. */
const GUARDAR_DIAS = 30;

export async function registrarEventoDeConexao(accountId: string, kind: string, detail?: string | null) {
  const ultimo = await prisma.connectionEvent.findFirst({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    select: { kind: true, createdAt: true },
  });
  // A Evolution manda o mesmo estado várias vezes seguidas numa reconexão.
  if (ultimo?.kind === kind && Date.now() - ultimo.createdAt.getTime() < JANELA_REPETIDO_MS) return;
  await prisma.connectionEvent.create({ data: { accountId, kind, detail: detail ?? null } });
}

/** Últimas linhas, da mais recente para a mais antiga. */
export function eventosRecentes(accountId: string, limite = 12) {
  return prisma.connectionEvent.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    take: limite,
    select: { kind: true, detail: true, createdAt: true },
  });
}

/** Última vez que o WhatsApp (re)conectou. */
export async function ultimaAbertura(accountId: string): Promise<Date | null> {
  const e = await prisma.connectionEvent.findFirst({
    where: { accountId, kind: "open" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return e?.createdAt ?? null;
}

export async function limparEventosAntigos() {
  const limite = new Date(Date.now() - GUARDAR_DIAS * 24 * 60 * 60 * 1000);
  await prisma.connectionEvent.deleteMany({ where: { createdAt: { lt: limite } } });
}
