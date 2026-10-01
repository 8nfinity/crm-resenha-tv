import { prisma } from "@/lib/db";
import { numerarFollowUps } from "@/lib/atividades";

/**
 * Número de follow-up (1º, 2º…) de cada atividade, para telas que mostram só
 * um recorte (o calendário de um mês, a lista de hoje): a contagem precisa
 * considerar TODOS os follow-ups do lead, não só os que aparecem na tela.
 */
export async function numerosDeFollowUp(dealIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(dealIds)];
  if (ids.length === 0) return new Map();

  const todos = await prisma.activity.findMany({
    where: { dealId: { in: ids }, type: "FOLLOW_UP" },
    select: { id: true, dealId: true, type: true, dueAt: true, doneAt: true, createdAt: true },
  });

  const porLead = new Map<string, typeof todos>();
  for (const a of todos) porLead.set(a.dealId, [...(porLead.get(a.dealId) ?? []), a]);

  const numeros = new Map<string, number>();
  for (const lista of porLead.values()) {
    for (const [id, n] of numerarFollowUps(lista)) numeros.set(id, n);
  }
  return numeros;
}
