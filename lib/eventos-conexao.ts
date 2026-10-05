import { prisma } from "@/lib/db";

/**
 * Linha do tempo da conexão de cada conta: quando o QR Code foi gerado e
 * quando o WhatsApp abriu ou caiu.
 *
 * É ela que responde "a Evolution reiniciou?": uma reconexão sem QR Code,
 * seguida de etiquetas que não chegam, é a Evolution que voltou sem os
 * arquivos da sessão (sem volume em /evolution/instances).
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

/** Última vez que aconteceu um evento deste tipo na conta. */
async function ultimoDoTipo(accountId: string, kind: string): Promise<Date | null> {
  const e = await prisma.connectionEvent.findFirst({
    where: { accountId, kind },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return e?.createdAt ?? null;
}

/** Última vez que um QR Code foi gerado para parear o número (pelo CRM). */
export function ultimoQrCode(accountId: string): Promise<Date | null> {
  return ultimoDoTipo(accountId, "qr");
}

export async function limparEventosAntigos() {
  const limite = new Date(Date.now() - GUARDAR_DIAS * 24 * 60 * 60 * 1000);
  await prisma.connectionEvent.deleteMany({ where: { createdAt: { lt: limite } } });
}
