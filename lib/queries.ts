import { prisma } from "@/lib/db";
import { describeScore } from "@/lib/scoring";
import type { DealCard, StageColumn, StoredScoreFactors } from "@/lib/types";
import { formatPhone } from "@/lib/evolution/parse";
import { lerValores, listarCampos, type Campo } from "@/lib/custom-fields";
import { nomeDaAtividade, sinalDoLead } from "@/lib/atividades";

/**
 * Consultas de leitura compartilhadas entre a interface e as ferramentas do MCP.
 *
 * Elas vivem juntas de propósito: se o kanban e o Claude calculassem "dias
 * parado" de jeitos diferentes, você receberia respostas que não batem com a
 * tela — e não teria como saber qual das duas está certa.
 */

const DAY = 1000 * 60 * 60 * 24;

export function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / DAY);
}

/**
 * Nome de exibição, em ordem de preferência: o nome que você salvou, o que a
 * pessoa escolheu exibir, o telefone e, por último, um rótulo curto.
 *
 * O último caso existe por causa do formato "@lid" do WhatsApp: ele não tem
 * telefone e nem sempre tem nome. Mostrar o identificador cru
 * ("62194827364@lid") deixaria o card ilegível — melhor um rótulo honesto com
 * os últimos dígitos, que dá para casar com a conversa no celular.
 */
export function contactName(contact: {
  savedName: string | null;
  pushName: string | null;
  phone: string | null;
  waJid: string;
}): string {
  const id = contact.waJid.split("@")[0];

  // O WhatsApp às vezes manda o próprio identificador como "nome". Mostrar
  // "95945928753169" num card parece telefone e não é: melhor cair no rótulo.
  const util = (nome: string | null) => (nome && nome.trim() !== id ? nome : null);

  const nome = util(contact.savedName) ?? util(contact.pushName);
  if (nome) return nome;

  const telefone = formatPhone(contact.phone);
  if (telefone) return telefone;

  return `Sem nome (…${id.slice(-4)})`;
}

function parseScoreFactors(raw: unknown): StoredScoreFactors {
  if (raw && typeof raw === "object" && "factors" in raw) {
    const stored = raw as StoredScoreFactors;
    if (Array.isArray(stored.factors)) return stored;
  }
  return { summary: "", factors: [] };
}

/** Colunas de um funil (ou de todos, na ordem dos funis). */
export async function getStages(pipelineId?: string): Promise<StageColumn[]> {
  const stages = await prisma.stage.findMany({
    where: pipelineId ? { pipelineId } : undefined,
    orderBy: [{ pipeline: { order: "asc" } }, { order: "asc" }],
  });
  return stages.map((s) => ({
    id: s.id,
    pipelineId: s.pipelineId,
    name: s.name,
    order: s.order,
    color: s.color,
    isWon: s.isWon,
    isLost: s.isLost,
  }));
}

/**
 * Todos os cards ativos do funil, na ordem do WhatsApp: a conversa com a
 * mensagem mais recente — dele OU sua — fica no topo da coluna, como na lista
 * de conversas do celular. Lead sem mensagem nenhuma vai para baixo, pelo
 * mais novo. O score continua no card, mas não decide a posição.
 */
export async function getDealCards(campos?: Campo[], pipelineId?: string): Promise<DealCard[]> {
  const ativos = { archivedAt: null, ...(pipelineId ? { stage: { pipelineId } } : {}) };
  // Cada ida ao banco custa ~200ms de rede (ele fica em outra região). O que
  // não depende do resultado anterior tem que viajar junto, senão a página
  // paga esse pedágio uma vez por consulta.
  //
  // Por isso as prévias e as atividades filtram pelos deals ativos no próprio
  // banco, em vez de esperar a lista de ids: as quatro consultas saem numa
  // rodada só.
  //
  // E só as colunas que o card mostra: com o banco longe, o TAMANHO da
  // resposta também custa viagens (centenas de KB não cabem numa ida só).
  // A conta vem à parte — são uma ou duas linhas, e no JOIN ela se repetia
  // inteira em cada um dos cards.
  const [deals, camposLista, previews, abertas, contas] = await Promise.all([
    prisma.deal.findMany({
      where: ativos,
      orderBy: [{ lastInteractionAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      // JOIN de verdade. No modo padrao o Prisma buscaria deals e depois
      // contatos — duas viagens de 200ms para montar um card.
      relationLoadStrategy: "join",
      select: {
        id: true,
        contactId: true,
        stageId: true,
        title: true,
        score: true,
        scoreFactors: true,
        value: true,
        lastInboundAt: true,
        lastInteractionAt: true,
        enteredStageAt: true,
        customValues: true,
        stage: { select: { isWon: true, isLost: true } },
        owner: { select: { id: true, name: true } },
        contact: {
          select: {
            id: true,
            accountId: true,
            savedName: true,
            pushName: true,
            phone: true,
            waJid: true,
            profilePicUrl: true,
          },
        },
      },
    }),
    // O chamador pode já ter as definições — a página do funil precisa delas
    // para os filtros, e buscar duas vezes seria uma viagem jogada fora.
    campos ? Promise.resolve(campos) : listarCampos(),
    lastMessagePerActiveDeal(pipelineId),
    // As atividades em aberto, só o que o card usa: o ícone (atrasada, hoje,
    // futura ou nenhuma) sai do prazo mais antigo de cada lead. Em ordem de
    // prazo, as sem data por último.
    prisma.activity.findMany({
      where: { doneAt: null, deal: ativos },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { dealId: true, dueAt: true, title: true, type: true, kind: { select: { name: true } } },
    }),
    prisma.whatsAppAccount.findMany({
      select: { id: true, label: true, instanceName: true, color: true },
    }),
  ]);

  const agora = new Date();
  const porDeal = new Map<string, { total: number; atrasadas: number; primeira: (typeof abertas)[number] }>();
  for (const a of abertas) {
    const atual = porDeal.get(a.dealId);
    const atrasada = a.dueAt !== null && a.dueAt < agora ? 1 : 0;
    if (atual) {
      atual.total += 1;
      atual.atrasadas += atrasada;
    } else {
      porDeal.set(a.dealId, { total: 1, atrasadas: atrasada, primeira: a });
    }
  }
  const contaPorId = new Map(contas.map((c) => [c.id, c]));
  const camposFinal = camposLista;

  return deals.map((deal) => {
    const stored = parseScoreFactors(deal.scoreFactors);
    const conta = contaPorId.get(deal.contact.accountId);
    const atividades = porDeal.get(deal.id);
    const proximaAtividade = atividades
      ? {
          nome: nomeDaAtividade({
            title: atividades.primeira.title,
            type: atividades.primeira.type,
            tipoNome: atividades.primeira.kind?.name,
          }),
          dueAt: atividades.primeira.dueAt?.toISOString() ?? null,
        }
      : null;
    return {
      id: deal.id,
      stageId: deal.stageId,
      title: deal.title ?? contactName(deal.contact),
      score: deal.score,
      scoreSummary: stored.summary || describeScore(deal.score),
      scoreFactors: stored.factors,
      value: deal.value ? Number(deal.value) : null,
      contact: {
        id: deal.contact.id,
        name: contactName(deal.contact),
        phone: formatPhone(deal.contact.phone),
        profilePicUrl: deal.contact.profilePicUrl,
      },
      owner: deal.owner,
      account: {
        id: deal.contact.accountId,
        label: conta?.label ?? conta?.instanceName ?? "WhatsApp",
        color: conta?.color ?? "#64748b",
      },
      lastInboundAt: deal.lastInboundAt?.toISOString() ?? null,
      lastInteractionAt: deal.lastInteractionAt?.toISOString() ?? null,
      enteredStageAt: deal.enteredStageAt.toISOString(),
      daysInStage: daysSince(deal.enteredStageAt),
      lastMessagePreview: previews.get(deal.contactId) ?? null,
      openActivities: atividades?.total ?? 0,
      proximaAtividade,
      atrasadas: atividades?.atrasadas ?? 0,
      sinal: sinalDoLead(proximaAtividade, agora),
      fechado: deal.stage.isWon || deal.stage.isLost,
      customValues: lerValores(deal.customValues, camposFinal),
    };
  });
}

/**
 * Prévia da última mensagem de cada contato.
 *
 * DISTINCT ON é específico do Postgres e resolve "a linha mais recente por
 * grupo" numa passada só. A alternativa portável seria N queries ou uma window
 * function bem mais pesada.
 */
async function lastMessagePerActiveDeal(pipelineId?: string): Promise<Map<string, string>> {
  const rows = pipelineId
    ? await prisma.$queryRaw<{ contactId: string; body: string | null; fromMe: boolean; type: string }[]>`
        SELECT DISTINCT ON (m."contactId") m."contactId", m."body", m."fromMe", m."type"::text
        FROM "Message" m
        WHERE m."contactId" IN (
          SELECT d."contactId" FROM "Deal" d JOIN "Stage" s ON s."id" = d."stageId"
          WHERE d."archivedAt" IS NULL AND s."pipelineId" = ${pipelineId}
        )
        ORDER BY m."contactId", m."timestamp" DESC
      `
    : await prisma.$queryRaw<{ contactId: string; body: string | null; fromMe: boolean; type: string }[]>`
        SELECT DISTINCT ON (m."contactId") m."contactId", m."body", m."fromMe", m."type"::text
        FROM "Message" m
        WHERE m."contactId" IN (SELECT "contactId" FROM "Deal" WHERE "archivedAt" IS NULL)
        ORDER BY m."contactId", m."timestamp" DESC
      `;

  return new Map(
    rows.map((r) => {
      const text = r.body?.trim() || mediaLabel(r.type);
      return [r.contactId, r.fromMe ? `Você: ${text}` : text];
    }),
  );
}

function mediaLabel(type: string): string {
  const labels: Record<string, string> = {
    IMAGE: "📷 Foto",
    VIDEO: "🎥 Vídeo",
    AUDIO: "🎤 Áudio",
    DOCUMENT: "📄 Documento",
    STICKER: "Figurinha",
    LOCATION: "📍 Localização",
    CONTACT: "👤 Contato",
  };
  return labels[type] ?? "Mensagem";
}

/** Detalhe completo de um card: mensagens, notas e atividades. */
export async function getDealDetail(dealId: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    // Sao seis relacoes: sem JOIN, o painel do lead abriria em seis viagens.
    relationLoadStrategy: "join",
    include: {
      contact: {
        include: {
          messages: { orderBy: { timestamp: "desc" }, take: 100 },
          // Histórico de etiquetas: entra nas notas do lead, em ordem do mais novo.
          labelEvents: { orderBy: { createdAt: "desc" }, take: 300 },
        },
      },
      stage: { include: { pipeline: { select: { id: true, name: true } } } },
      notes: { orderBy: { createdAt: "desc" } },
      owner: { select: { id: true, name: true } },
      activities: {
        orderBy: { createdAt: "desc" },
        include: { createdBy: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } } },
      },
      transitions: {
        orderBy: { at: "desc" },
        include: { fromStage: true, toStage: true },
      },
    },
  });

  if (!deal) return null;

  const stored = parseScoreFactors(deal.scoreFactors);
  const { contact, ...resto } = deal;
  const { messages, labelEvents, ...contactSemMensagens } = contact;

  // As mensagens pertencem ao contato no banco, mas o painel do card trata
  // como se fossem do deal. Achatar aqui mantém a resposta da API igual ao que
  // o componente declara — foi a divergência entre as duas que quebrou a tela.
  return {
    ...resto,
    // O número do lead já formatado ("+55 11 98765-4321"); nulo quando o
    // WhatsApp só informou o código interno da pessoa (LID).
    contact: { ...contactSemMensagens, phone: formatPhone(contactSemMensagens.phone) },
    messages,
    labelEvents,
    displayName: contactName(contact),
    scoreSummary: stored.summary || describeScore(deal.score),
    scoreFactors: stored.factors,
    valueNumber: deal.value ? Number(deal.value) : null,
  };
}
