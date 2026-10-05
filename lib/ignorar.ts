import { prisma } from "@/lib/db";
import { isPersonJid } from "@/lib/evolution/parse";
import type { EvolutionChat } from "@/lib/evolution/types";
import { acharContato, upsertContact } from "@/lib/ingest";
import { avisarMudanca } from "@/lib/eventos";

/**
 * Contatos ignorados: números que não devem aparecer no CRM (família,
 * fornecedor, colega de trabalho...).
 *
 * Ignorar é reversível de propósito. O contato não é apagado: ele ganha a
 * marca `ignoredAt` e o lead dele é arquivado — some do funil, da agenda, do
 * calendário e das métricas. As mensagens novas dele deixam de entrar. Voltar
 * a mostrar desarquiva o lead que foi arquivado por causa do "ignorar".
 */

/** Marca o contato como ignorado e tira o lead dele da tela. */
export async function ignorarContato(accountId: string, waJid: string): Promise<{ id: string } | null> {
  if (!isPersonJid(waJid)) return null;
  const contato = await upsertContact({ accountId, waJid });
  if (contato.ignoredAt) return contato; // já estava

  const agora = new Date();
  await prisma.$transaction([
    prisma.contact.update({ where: { id: contato.id }, data: { ignoredAt: agora } }),
    prisma.deal.updateMany({ where: { contactId: contato.id, archivedAt: null }, data: { archivedAt: agora } }),
  ]);
  avisarMudanca({ dealIds: [], motivo: "mensagem" });
  return contato;
}

/**
 * Volta a mostrar o contato. Desarquiva só o lead arquivado PELO ignorar —
 * um lead que já estava arquivado antes continua arquivado.
 */
export async function voltarAMostrar(contactId: string): Promise<boolean> {
  const contato = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contato?.ignoredAt) return false;

  await prisma.$transaction([
    prisma.deal.updateMany({
      where: { contactId, archivedAt: { gte: contato.ignoredAt } },
      data: { archivedAt: null },
    }),
    prisma.contact.update({ where: { id: contactId }, data: { ignoredAt: null } }),
  ]);
  avisarMudanca({ dealIds: [], motivo: "mensagem" });
  return true;
}

/** Ids das etiquetas de uma conversa — a Evolution já mandou em mais de um formato. */
export function etiquetasDoChat(chat: EvolutionChat): string[] {
  const bruto = (chat as { labels?: unknown }).labels;
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((l) =>
      typeof l === "string" || typeof l === "number"
        ? String(l)
        : l && typeof l === "object"
          ? String((l as Record<string, unknown>).labelId ?? (l as Record<string, unknown>).id ?? "")
          : "",
    )
    .filter(Boolean);
}

/**
 * Conversas que estão com a etiqueta agora — TODAS, sem limite.
 *
 * A fonte é o histórico do próprio CRM: toda etiquetagem que chega do celular
 * vira uma linha, mesmo de etiqueta sem efeito — quem tem um "Adicionado a"
 * como última linha daquela etiqueta está com ela. (A Evolution 2.3 não diz
 * isso: a lista de conversas dela não traz as etiquetas, e pedir a lista
 * inteira só para procurá-las era a consulta mais pesada que existe nela.)
 */
export async function quemEstaComAEtiqueta(accountId: string, labelId: string): Promise<string[]> {
  const eventos = await prisma.labelEvent.findMany({
    where: { labelId, contact: { accountId } },
    orderBy: { createdAt: "desc" },
    select: { contactId: true, action: true, contact: { select: { waJid: true } } },
  });

  const vistos = new Set<string>();
  const jids: string[] = [];
  for (const e of eventos) {
    if (vistos.has(e.contactId)) continue;
    vistos.add(e.contactId);
    if (e.action === "add") jids.push(e.contact.waJid);
  }
  return jids;
}

/**
 * Ao marcar uma etiqueta como "ignorar", aplica nos contatos que JÁ estavam
 * com ela no celular — sem isso, só quem fosse etiquetado dali em diante
 * sumiria. Devolve quantos contatos foram ignorados.
 */
export async function ignorarQuemJaTemAEtiqueta(accountId: string, labelId: string): Promise<number> {
  let total = 0;
  for (const jid of await quemEstaComAEtiqueta(accountId, labelId)) {
    const antes = await acharContato(accountId, jid);
    if (antes?.ignoredAt) continue; // já estava ignorado
    if (await ignorarContato(accountId, jid)) total++;
  }
  return total;
}

/** O contato está marcado para ignorar? Usado antes de gravar mensagens. */
export async function estaIgnorado(accountId: string, waJid: string): Promise<boolean> {
  // Pelo telefone ou pelo LID: a mesma pessoa chega pelos dois.
  const c = await acharContato(accountId, waJid);
  return Boolean(c?.ignoredAt);
}
