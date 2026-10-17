import { prisma } from "@/lib/db";
import { recalculateScore } from "@/lib/deals";
import { avisarMudanca } from "@/lib/eventos";

/**
 * Junta dois contatos que são a mesma pessoa (um pelo telefone, outro pelo
 * "@lid" do WhatsApp) num só.
 *
 * Fica o contato `manterId` (o do telefone). Do outro vêm as mensagens, o
 * histórico de etiquetas e, se ele tinha um lead, as anotações, atividades e
 * movimentos no funil. Nada que você registrou se perde: só some a cópia.
 */
/**
 * Ao juntar dois leads da mesma pessoa, vale o estágio de quem andou por
 * último no funil. É o caso da etiqueta que caiu na cópia (chegou pelo LID
 * antes de o CRM saber o telefone): juntar não pode desfazer o movimento.
 * Cópia parada na primeira coluna (de qualquer funil) nunca puxa o lead de volta.
 */
export function copiaDecideOEstagio(
  manter: { stageId: string; enteredStageAt: Date },
  copia: { stageId: string; enteredStageAt: Date },
  primeirasColunas: string | null | ReadonlySet<string>,
): boolean {
  const ehPrimeira = (id: string) =>
    typeof primeirasColunas === "string" || primeirasColunas === null
      ? id === primeirasColunas
      : primeirasColunas.has(id);
  if (ehPrimeira(copia.stageId) || copia.stageId === manter.stageId) return false;
  return ehPrimeira(manter.stageId) || copia.enteredStageAt > manter.enteredStageAt;
}

export async function mesclarContatos(manterId: string, removerId: string): Promise<void> {
  if (manterId === removerId) return;

  let juntou = false;
  const dealFinal = await prisma.$transaction(async (tx) => {
    const [manter, remover] = await Promise.all([
      tx.contact.findUnique({ where: { id: manterId }, include: { deals: true } }),
      tx.contact.findUnique({ where: { id: removerId }, include: { deals: true } }),
    ]);
    // Outra requisição já juntou os dois neste meio-tempo.
    if (!manter || !remover) return null;
    juntou = true;

    // Mensagens: passam para o contato que fica. As que já existem nele (a
    // mesma mensagem importada pelos dois caminhos) somem junto com a cópia.
    await tx.$executeRaw`
      UPDATE "Message" SET "contactId" = ${manterId}
      WHERE "contactId" = ${removerId}
        AND "waMessageId" NOT IN (SELECT "waMessageId" FROM "Message" WHERE "contactId" = ${manterId})`;
    await tx.labelEvent.updateMany({ where: { contactId: removerId }, data: { contactId: manterId } });

    const dealManter = manter.deals[0] ?? null;
    const dealRemover = remover.deals[0] ?? null;
    let dealId: string | null = dealManter?.id ?? null;

    if (dealRemover && !dealManter) {
      // Só a cópia tinha lead: ele passa inteiro para o contato que fica.
      await tx.deal.update({ where: { id: dealRemover.id }, data: { contactId: manterId } });
      dealId = dealRemover.id;
    } else if (dealRemover && dealManter) {
      await tx.activity.updateMany({ where: { dealId: dealRemover.id }, data: { dealId: dealManter.id } });
      await tx.note.updateMany({ where: { dealId: dealRemover.id }, data: { dealId: dealManter.id } });
      // Movimentos no funil vêm junto; o "nascimento" da cópia não (seria um
      // segundo lead novo nas métricas de entrada).
      await tx.stageTransition.updateMany({
        where: { dealId: dealRemover.id, fromStageId: { not: null } },
        data: { dealId: dealManter.id },
      });

      // A primeira coluna de cada funil: é onde o lead nasce, em qualquer um deles.
      const primeiras = await tx.stage.findMany({
        orderBy: [{ pipelineId: "asc" }, { order: "asc" }],
        distinct: ["pipelineId"],
        select: { id: true },
      });
      const herdaEstagio = copiaDecideOEstagio(dealManter, dealRemover, new Set(primeiras.map((s) => s.id)));
      const maior = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);

      await tx.deal.update({
        where: { id: dealManter.id },
        data: {
          ...(herdaEstagio ? { stageId: dealRemover.stageId, enteredStageAt: dealRemover.enteredStageAt } : {}),
          lastInboundAt: maior(dealManter.lastInboundAt, dealRemover.lastInboundAt),
          lastInteractionAt: maior(dealManter.lastInteractionAt, dealRemover.lastInteractionAt),
          title: dealManter.title ?? dealRemover.title,
          value: dealManter.value ?? dealRemover.value,
          customValues: dealManter.customValues ?? dealRemover.customValues ?? undefined,
          // Arquivado só se os dois estavam: um lead ativo não some por causa da cópia.
          archivedAt: dealManter.archivedAt && dealRemover.archivedAt ? dealManter.archivedAt : null,
          createdAt: dealManter.createdAt < dealRemover.createdAt ? dealManter.createdAt : dealRemover.createdAt,
        },
      });
    }

    // Apaga a cópia (o lead dela, se sobrou, e as mensagens repetidas vão junto).
    await tx.contact.delete({ where: { id: removerId } });

    // Completa o contato que fica com o que só a cópia sabia.
    const ignorado =
      manter.ignoredAt && remover.ignoredAt
        ? (manter.ignoredAt < remover.ignoredAt ? manter.ignoredAt : remover.ignoredAt)
        : (manter.ignoredAt ?? remover.ignoredAt);
    await tx.contact.update({
      where: { id: manterId },
      data: {
        savedName: manter.savedName ?? remover.savedName,
        pushName: manter.pushName ?? remover.pushName,
        profilePicUrl: manter.profilePicUrl ?? remover.profilePicUrl,
        ignoredAt: ignorado,
        lid: manter.lid ?? (remover.waJid.endsWith("@lid") ? remover.waJid : remover.lid),
      },
    });

    return dealId;
  });

  if (dealFinal) await recalculateScore(dealFinal).catch(() => {});
  // O card da cópia some das telas abertas na hora — antes ficava até a
  // próxima recarga, e parecia que o duplicado continuava lá.
  if (juntou) avisarMudanca({ dealIds: dealFinal ? [dealFinal] : [], motivo: "funil" });
}
