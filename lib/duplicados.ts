import { prisma } from "@/lib/db";
import { mesclarContatos } from "@/lib/mesclar-contatos";
import { variantesDoTelefone } from "@/lib/identidade-contato";
import { unificarContatoLid } from "@/lib/sincronizacao";

/**
 * Limpeza de leads duplicados de um número — o botão "Juntar duplicados".
 *
 * A varredura de cada minuto já junta duplicados aos poucos; aqui é tudo de
 * uma vez, com o resultado na tela. Junta dois tipos de cópia da MESMA pessoa:
 *
 *  - pelo LID: o contato que entrou só com o código interno do WhatsApp
 *    ("…@lid") e o do telefone. Quando a Evolution sabe o telefone daquele
 *    LID, os dois viram um só (mensagens, notas, atividades e etiquetas vão
 *    juntos; fica o estágio de quem andou por último no funil);
 *  - pelo 9: o mesmo celular com e sem o 9 da frente.
 *
 * O mesmo telefone em OUTRO número conectado não é duplicado: é de propósito
 * (cada número seu é um relacionamento). Só é contado, para a tela explicar.
 */

/** Por clique — o que sobrar, a varredura continua (ou um próximo clique). */
const LIMITE_POR_VEZ = 150;

export type ResultadoDuplicados = {
  /** Cópias pelo LID juntadas ao contato do telefone. */
  pelaLid: number;
  /** Cópias do mesmo celular com e sem o 9 juntadas. */
  peloNove: number;
  /** Leads ativos que continuam só com o LID (a Evolution ainda não sabe o telefone). */
  semTelefone: number;
  /** Contatos só com LID que ficaram para o próximo clique. */
  restantes: number;
  /** Telefones que também são lead em outro número conectado. */
  emOutroNumero: number;
};

export async function juntarDuplicados(accountId: string): Promise<ResultadoDuplicados> {
  const conta = await prisma.whatsAppAccount.findUnique({
    where: { id: accountId },
    select: { id: true, instanceName: true },
  });
  if (!conta) throw new Error("Conta não encontrada");

  // 1. Pelo LID — só quem é lead: os contatos da agenda sem card não
  // aparecem no funil, e conferir cada um custava uma consulta à Evolution.
  const soLid = await prisma.contact.findMany({
    where: { accountId, waJid: { endsWith: "@lid" }, deals: { some: {} } },
    orderBy: { updatedAt: "asc" },
    select: { id: true, waJid: true },
  });
  let pelaLid = 0;
  for (const c of soLid.slice(0, LIMITE_POR_VEZ)) {
    try {
      if (await unificarContatoLid(conta, c)) pelaLid++;
    } catch (error) {
      console.warn(`Duplicados: LID ${c.waJid} —`, (error as Error).message);
    }
  }

  // 2. Pelo 9: agrupa os celulares pelas duas formas do número.
  const telefones = await prisma.contact.findMany({
    where: { accountId, waJid: { endsWith: "@s.whatsapp.net" } },
    select: { id: true, waJid: true },
  });
  const grupos = new Map<string, string[]>();
  for (const t of telefones) {
    const variantes = variantesDoTelefone(t.waJid);
    if (variantes.length < 2) continue;
    const chave = [...variantes].sort().join("|");
    grupos.set(chave, [...(grupos.get(chave) ?? []), t.id]);
  }
  let peloNove = 0;
  for (const ids of grupos.values()) {
    if (ids.length < 2) continue;
    // Fica o contato da forma que o WhatsApp usa hoje: o da mensagem mais recente.
    const ultimas = await prisma.message.groupBy({
      by: ["contactId"],
      where: { contactId: { in: ids } },
      _max: { timestamp: true },
    });
    const quando = new Map(ultimas.map((u) => [u.contactId, u._max.timestamp?.getTime() ?? 0]));
    const [manter, ...copias] = [...ids].sort((a, b) => (quando.get(b) ?? 0) - (quando.get(a) ?? 0));
    for (const copia of copias) {
      try {
        await mesclarContatos(manter, copia);
        peloNove++;
      } catch (error) {
        console.warn("Duplicados: celular com e sem o 9 —", (error as Error).message);
      }
    }
  }

  const [semTelefone, outros] = await Promise.all([
    prisma.contact.count({
      where: { accountId, waJid: { endsWith: "@lid" }, deals: { some: { archivedAt: null } } },
    }),
    prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(DISTINCT c.phone)::bigint AS total
      FROM "Contact" c
      JOIN "Contact" o ON o.phone = c.phone AND o."accountId" <> c."accountId"
      WHERE c."accountId" = ${accountId}
        AND c.phone IS NOT NULL
        AND EXISTS (SELECT 1 FROM "Deal" d WHERE d."contactId" = c.id AND d."archivedAt" IS NULL)
        AND EXISTS (SELECT 1 FROM "Deal" d WHERE d."contactId" = o.id AND d."archivedAt" IS NULL)
    `,
  ]);

  return {
    pelaLid,
    peloNove,
    semTelefone,
    restantes: Math.max(0, soLid.length - LIMITE_POR_VEZ),
    emOutroNumero: Number(outros[0]?.total ?? 0),
  };
}
