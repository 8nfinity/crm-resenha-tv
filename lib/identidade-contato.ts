import { prisma } from "@/lib/db";
import { evolution } from "@/lib/evolution/client";
import type { EvolutionMessage } from "@/lib/evolution/types";

/**
 * Quem é a pessoa por trás de um identificador do WhatsApp.
 *
 * A mesma pessoa chega por dois identificadores: o telefone
 * ("55…@s.whatsapp.net") e o LID ("…@lid"). As etiquetas e listas chegam
 * cada vez mais pelo LID — e, se o CRM não descobre de quem é aquele LID, ele
 * cria um contato novo: o lead DUPLICA, a etiqueta move a cópia e o card que
 * você estava vendo fica parado.
 *
 * Como a Evolution 2.3 guarda as coisas (conferido no código dela):
 *  - cada mensagem fica gravada com o identificador por onde chegou em
 *    `key.remoteJid` e o outro em `key.remoteJidAlt`. Quem escreve pelo
 *    telefone tem o LID SÓ no `remoteJidAlt`;
 *  - no aviso que manda para o CRM, ela troca o LID pelo telefone — o CRM
 *    recebe o telefone nos dois campos e nunca fica sabendo o LID;
 *  - ela mantém um cache leve de números (uma linha por contato) que, para
 *    quem escreveu pelo telefone, liga o LID ao número.
 *
 * Por isso a descoberta tenta primeiro o cache (consulta leve) e depois as
 * mensagens procuradas nos DOIS campos.
 */

/** O outro identificador que uma mensagem revela, dado o que procuramos. */
export function outroIdentificadorDaMensagem(raw: EvolutionMessage, jid: string): string | null {
  const key = raw.key;
  if (!key) return null;
  const candidatos =
    key.remoteJid === jid
      ? [key.remoteJidAlt, key.senderPn]
      : key.remoteJidAlt === jid || key.senderPn === jid
        ? [key.remoteJid]
        : [];
  return candidatos.find((c): c is string => typeof c === "string" && c.length > 0 && c !== jid) ?? null;
}

/**
 * As formas do mesmo celular brasileiro: com e sem o 9 da frente. Contas
 * antigas do WhatsApp mantêm o número sem o 9 ("551187654321"), e o mesmo
 * celular pode aparecer das duas formas. Só para celular (8 dígitos que
 * começam com 6 a 9) — telefone fixo não ganhou o 9.
 */
export function variantesDoTelefone(jid: string): string[] {
  const m = jid.match(/^55(\d{2})(\d{8,9})@s\.whatsapp\.net$/);
  if (!m) return [jid];
  const [, ddd, numero] = m;
  const semNove = numero.length === 9 && numero.startsWith("9") ? numero.slice(1) : numero.length === 8 ? numero : null;
  if (!semNove || !/^[6-9]/.test(semNove)) return [jid];
  return [`55${ddd}9${semNove}@s.whatsapp.net`, `55${ddd}${semNove}@s.whatsapp.net`];
}

/**
 * O telefone na forma que o CRM já usa (com ou sem o 9), se ele já conhece
 * esse celular — para não criar um segundo contato do mesmo número.
 */
export async function formaConhecidaDoTelefone(accountId: string, pnJid: string): Promise<string> {
  const variantes = variantesDoTelefone(pnJid);
  if (variantes.length === 1) return pnJid;
  const existente = await prisma.contact.findFirst({
    where: { accountId, waJid: { in: variantes } },
    select: { waJid: true },
  });
  return existente?.waJid ?? pnJid;
}

/**
 * O outro identificador (telefone ↔ LID) e o nome da pessoa, perguntando à
 * Evolution. Vazio se ela não souber ou não responder — nunca chuta.
 */
export async function descobrirPessoa(
  instanceName: string,
  jid: string,
): Promise<{ alt: string | null; pushName: string | null }> {
  let alt: string | null = null;
  let pushName: string | null = null;

  // 1. LID → telefone pelo cache de números: leve, não varre mensagens. Achou,
  //    basta — o nome vem depois, com a conversa (ver trazerConversaRecente).
  if (jid.endsWith("@lid")) {
    alt = await evolution.telefoneDoLid(instanceName, jid).catch(() => null);
    if (alt) return { alt, pushName: null };
  }

  // 2. As mensagens da conversa, procuradas nos dois campos da chave. Também
  //    trazem o nome que a pessoa usa no WhatsApp.
  try {
    const mensagens = await evolution.findMessages(instanceName, jid, 10, { qualquerLado: true });
    alt ??= mensagens.map((m) => outroIdentificadorDaMensagem(m, jid)).find(Boolean) ?? null;
    // O nome vem de uma mensagem DELA (a sua traria o seu próprio nome).
    pushName = mensagens.find((m) => m.key?.fromMe === false && m.pushName)?.pushName ?? null;
  } catch {
    // Sem as mensagens, fica com o que o cache disse.
  }

  return { alt, pushName };
}
