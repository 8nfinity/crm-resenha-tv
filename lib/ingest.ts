import { prisma } from "@/lib/db";
import { createDealForContact } from "@/lib/deals";
import { identidades, isPersonJid, jidToPhone, parseMessage } from "@/lib/evolution/parse";
import { mesclarContatos } from "@/lib/mesclar-contatos";
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

type DadosContato = {
  pushName?: string | null;
  savedName?: string | null;
  profilePicUrl?: string | null;
};

/** Só sobrescreve quando há valor novo: um evento sem nome não apaga o que já conhecíamos. */
function camposNovos(input: DadosContato) {
  return {
    ...(input.pushName ? { pushName: input.pushName } : {}),
    ...(input.savedName ? { savedName: input.savedName } : {}),
    ...(input.profilePicUrl ? { profilePicUrl: input.profilePicUrl } : {}),
  };
}

/** Contato por qualquer um dos identificadores (telefone ou LID). */
export async function acharContato(accountId: string, jid: string) {
  const achados = await prisma.contact.findMany({
    where: { accountId, OR: [{ waJid: jid }, { lid: jid }] },
  });
  // O do telefone ganha do que só tem o LID.
  return achados.find((c) => c.waJid.endsWith("@s.whatsapp.net")) ?? achados[0] ?? null;
}

/**
 * Grava (ou acha) o contato de uma conversa.
 *
 * O WhatsApp identifica a mesma pessoa de duas formas: pelo telefone
 * ("55…@s.whatsapp.net") e pelo LID ("…@lid"). A mesma conversa chega ora por
 * um, ora pelo outro — e as mensagens novas trazem os dois (`alt`). Tratar
 * cada um como um contato era o que duplicava leads.
 *
 * A regra: o contato é o do TELEFONE, com o LID guardado ao lado. Quando só
 * o LID é conhecido, o contato nasce com ele e é convertido para o telefone
 * assim que uma mensagem revelar o número. Se os dois já existiam separados,
 * são juntados (mesclarContatos) — mensagens, notas e atividades vão juntos.
 */
export async function upsertContact(
  input: { accountId: string; waJid: string; alt?: string | null } & DadosContato,
) {
  const { accountId } = input;
  const { pn, lid } = identidades(input.waJid, input.alt);
  const novos = camposNovos(input);

  if (pn) {
    let porFone = await prisma.contact.findUnique({ where: { accountId_waJid: { accountId, waJid: pn } } });
    const porLid = lid
      ? await prisma.contact.findFirst({
          where: { accountId, OR: [{ waJid: lid }, { lid }], ...(porFone ? { NOT: { id: porFone.id } } : {}) },
        })
      : null;

    if (!porFone && porLid) {
      // Só existia pelo LID: vira o contato do telefone (mesmo registro, nada se perde).
      porFone = await prisma.contact.update({
        where: { id: porLid.id },
        data: { waJid: pn, phone: jidToPhone(pn), lid },
      });
    } else if (porFone && porLid) {
      await mesclarContatos(porFone.id, porLid.id);
    }

    if (porFone) {
      return prisma.contact.update({
        where: { id: porFone.id },
        data: { ...novos, ...(lid && porFone.lid !== lid ? { lid } : {}) },
      });
    }

    try {
      return await prisma.contact.create({
        data: {
          accountId,
          waJid: pn,
          phone: jidToPhone(pn),
          lid,
          pushName: input.pushName ?? null,
          savedName: input.savedName ?? null,
          profilePicUrl: input.profilePicUrl ?? null,
          isGroup: false,
        },
      });
    } catch (error) {
      // Outra requisição criou no mesmo instante (webhook + varredura): usa o dela.
      if ((error as { code?: string }).code !== "P2002") throw error;
      const existente = await prisma.contact.findUnique({ where: { accountId_waJid: { accountId, waJid: pn } } });
      if (!existente) throw error;
      return prisma.contact.update({ where: { id: existente.id }, data: novos });
    }
  }

  if (lid) {
    // Só o LID: acha pelo LID guardado (o contato do telefone) ou pela conversa
    // antiga. Se os dois existem separados, junta no do telefone.
    const achados = await prisma.contact.findMany({ where: { accountId, OR: [{ waJid: lid }, { lid }] } });
    const existente = achados.find((c) => c.waJid.endsWith("@s.whatsapp.net")) ?? achados[0] ?? null;
    for (const outro of achados) {
      if (existente && outro.id !== existente.id) await mesclarContatos(existente.id, outro.id);
    }
    if (existente) {
      return prisma.contact.update({
        where: { id: existente.id },
        data: { ...novos, ...(existente.lid ? {} : { lid }) },
      });
    }
    try {
      return await prisma.contact.create({
        data: {
          accountId,
          waJid: lid,
          lid,
          pushName: input.pushName ?? null,
          savedName: input.savedName ?? null,
          profilePicUrl: input.profilePicUrl ?? null,
          isGroup: false,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      const existente2 = await acharContato(accountId, lid);
      if (!existente2) throw error;
      return prisma.contact.update({ where: { id: existente2.id }, data: novos });
    }
  }

  // Outros formatos (grupo etc.): pelo identificador como veio.
  return prisma.contact.upsert({
    where: { accountId_waJid: { accountId, waJid: input.waJid } },
    update: novos,
    create: {
      accountId,
      waJid: input.waJid,
      phone: jidToPhone(input.waJid),
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
    alt: parsed.alt,
    // O pushName de uma mensagem SUA é o seu próprio nome, não o do contato.
    pushName: parsed.fromMe ? null : (raw.pushName ?? null),
  });

  // Contato ignorado (etiqueta de ignorar ou à mão): a mensagem não entra e
  // ele não volta para o funil.
  if (contact.ignoredAt) return null;

  const inserted = await ingestMessages(contact.id, [raw]);
  if (inserted === 0) return null; // já tínhamos essa mensagem

  const deal = await createDealForContact(contact.id);

  // O funil é ordenado pela última mensagem do lead: atualiza já, para o card
  // subir na hora (o recálculo do score vem depois e leva alguns segundos).
  // Só avança — uma mensagem antiga reentregue não puxa a data para trás.
  const quando = parsed.timestamp;
  await prisma.deal.updateMany({
    where: { id: deal.id, OR: [{ lastInteractionAt: null }, { lastInteractionAt: { lt: quando } }] },
    data: { lastInteractionAt: quando },
  });
  if (!parsed.fromMe) {
    await prisma.deal.updateMany({
      where: { id: deal.id, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: quando } }] },
      data: { lastInboundAt: quando },
    });
  }
  return deal.id;
}
