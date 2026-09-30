import { prisma } from "@/lib/db";
import { contactName } from "@/lib/queries";

/**
 * Atividades para o calendário.
 *
 * Cada atividade aparece no dia do PRAZO (dueAt). A que foi registrada como
 * feita sem nunca ter tido prazo ("já fiz agora") aparece no dia em que foi
 * feita — senão ficaria fora do calendário, como se não tivesse acontecido.
 */

export type AtividadeCalendario = {
  id: string;
  type: string;
  title: string | null;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
  deal: {
    id: string;
    nome: string;
    estagio: string;
    estagioCor: string;
  };
};

export async function atividadesEntre(inicio: Date, fim: Date): Promise<AtividadeCalendario[]> {
  const linhas = await prisma.activity.findMany({
    where: {
      deal: { archivedAt: null },
      OR: [
        { dueAt: { gte: inicio, lt: fim } },
        { dueAt: null, doneAt: { gte: inicio, lt: fim } },
      ],
    },
    orderBy: [{ dueAt: "asc" }, { doneAt: "asc" }],
    relationLoadStrategy: "join",
    select: {
      id: true,
      type: true,
      title: true,
      dueAt: true,
      doneAt: true,
      createdAt: true,
      deal: {
        select: {
          id: true,
          title: true,
          stage: { select: { name: true, color: true } },
          contact: { select: { savedName: true, pushName: true, phone: true, waJid: true } },
        },
      },
    },
  });

  return linhas.map((a) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    doneAt: a.doneAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    deal: {
      id: a.deal.id,
      nome: a.deal.title ?? contactName(a.deal.contact),
      estagio: a.deal.stage.name,
      estagioCor: a.deal.stage.color,
    },
  }));
}

/** Leads ativos, só id e nome — a lista de escolha ao agendar pelo calendário. */
export async function leadsParaAgendar(): Promise<{ id: string; nome: string }[]> {
  const deals = await prisma.deal.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      title: true,
      contact: { select: { savedName: true, pushName: true, phone: true, waJid: true } },
    },
  });
  return deals
    .map((d) => ({ id: d.id, nome: d.title ?? contactName(d.contact) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Pendências vencidas de qualquer mês — o que ficou para trás. */
export async function contarAtrasadas(): Promise<number> {
  return prisma.activity.count({
    where: { doneAt: null, dueAt: { lt: new Date() }, deal: { archivedAt: null } },
  });
}
