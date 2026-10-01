import { prisma } from "@/lib/db";
import { createDealForContact } from "@/lib/deals";
import { isPersonJid, jidToPhone, parseMessage } from "@/lib/evolution/parse";
import type { EvolutionMessage } from "@/lib/evolution/types";

/**
 * Gravação de contatos e mensagens.
 *
 * A importação em massa e o webhook ao vivo usam exatamente este código. Se
 * fossem dois caminhos separados, eles divergiriam com o tempo e o histórico
 * importado deixaria de bater com o que chega em tempo real.
 *
 * Tudo é idempotente: a chave é (conta, waJid) para contatos e
 * (contato, waMessageId) para mensagens. Reimportar não duplica nada.
 */

export async function upsertContact(input: {
  accountId: string;
  waJid: string;
  pushName?: string | null;
  savedName?: string | null;
  profilePicUrl?: string | null;
}) {
  const phone = jidToPhone(input.waJid);

  return prisma.contact.upsert({
    where: {
      accountId_waJid: { accountId: input.accountId, waJid: input.waJid },
    },
    // Só sobrescreve quando há valor novo: um webhook sem pushName não pode
    // apagar o nome que já conhecíamos.
    update: {
      ...(input.pushName ? { pushName: input.pushName } : {}),
      ...(input.savedName ? { savedName: input.savedName } : {}),
      ...(input.profilePicUrl ? { profilePicUrl: input.profilePicUrl } : {}),
    },
    create: {
      accountId: input.accountId,
      waJid: input.waJid,
      phone,
      pushName: input.pushName ?? null,
      savedName: input.savedName ?? null,
      profilePicUrl: input.profilePicUrl ?? null,
      isGroup: input.waJid.endsWith("@g.us"),
    },
  });
}

/**
 * Grava um lote de mensagens. Devolve quantas eram novas.
 *
 * `skipDuplicates` faz o Postgres ignorar conflitos sem derrubar o lote inteiro
 * — importante na importação, onde reprocessar conversas sobrepostas é o caso
 * normal, não a exceção.
 */
export async function ingestMessages(
  contactId: string,
  raw: EvolutionMessage[],
): Promise<number> {
  const parsed = raw
    .map(parseMessage)
    .filter((m): m is NonNullable<typeof m> => m !== null);

  if (parsed.length === 0) return 0;

  const result = await prisma.message.createMany({
    data: parsed.map((m) => ({
      contactId,
      waMessageId: m.waMessageId,
      fromMe: m.fromMe,
      type: m.type,
      body: m.body,
      timestamp: m.timestamp,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

/**
 * Processa uma mensagem que acabou de chegar pelo webhook: garante o contato,
 * garante o deal e grava a mensagem.
 *
 * Devolve o `dealId` quando algo novo entrou — o chamador usa isso para decidir
 * se precisa recalcular o score. Devolve `null` quando a mensagem era duplicada
 * ou veio de um JID que não é pessoa (grupo, status, newsletter).
 */
export async function ingestLiveMessage(
  accountId: string,
  raw: EvolutionMessage,
): Promise<string | null> {
  const parsed = parseMessage(raw);
  if (!parsed) return null;

  // Grupos e status não viram lead. Entrariam no funil como ruído puro.
  if (!isPersonJid(parsed.remoteJid)) return null;

  const contact = await upsertContact({
    accountId,
    waJid: parsed.remoteJid,
    // O pushName de uma mensagem SUA é o seu próprio nome, não o do contato.
    pushName: parsed.fromMe ? null : (raw.pushName ?? null),
  });

  // Contato ignorado (etiqueta de ignorar ou à mão): a mensagem não entra e
  // ele não volta para o funil.
  if (contact.ignoredAt) return null;

  const inserted = await ingestMessages(contact.id, [raw]);
  if (inserted === 0) return null; // já tínhamos essa mensagem

  const deal = await createDealForContact(contact.id);
  return deal.id;
}
