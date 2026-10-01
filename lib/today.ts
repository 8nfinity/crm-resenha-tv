import { prisma } from "@/lib/db";
import { contactName, daysSince } from "@/lib/queries";
import { describeScore } from "@/lib/scoring";
import { numerosDeFollowUp } from "@/lib/follow-ups";
import { ordinalFollowUp } from "@/lib/atividades";

/**
 * A agenda do dia.
 *
 * O funil mostra o ESTADO — 176 cards espalhados em sete colunas. Esta tela
 * responde outra pergunta: o que exige você agora. São listas curtas e
 * ordenadas por urgência, não um painel para interpretar.
 *
 * Cada bloco existe porque representa um jeito diferente de perder negócio:
 * esquecer um compromisso, deixar alguém no vácuo, ou abandonar um lead quente.
 */

const DIA = 1000 * 60 * 60 * 24;

export type ItemHoje = {
  dealId: string;
  nome: string;
  estagio: string;
  estagioCor: string;
  score: number;
  temperatura: string;
  /** A linha que explica por que este item está na lista. */
  detalhe: string;
  /** Quanto tempo passou, para ordenar e colorir. */
  dias: number;
};

export type AgendaHoje = {
  atrasados: ItemHoje[];
  hoje: ItemHoje[];
  responderam: ItemHoje[];
  esfriando: ItemHoje[];
  totalPendente: number;
};

const ROTULO_ATIVIDADE: Record<string, string> = {
  FOLLOW_UP: "Follow-up",
  MEETING: "Reunião",
  CALL: "Ligação",
  PROPOSAL: "Proposta",
  OTHER: "Tarefa",
};

type DealComRelacoes = {
  id: string;
  score: number;
  title: string | null;
  stage: { name: string; color: string };
  contact: { savedName: string | null; pushName: string | null; phone: string | null; waJid: string };
};

function paraItem(deal: DealComRelacoes, detalhe: string, dias: number): ItemHoje {
  return {
    dealId: deal.id,
    nome: deal.title ?? contactName(deal.contact),
    estagio: deal.stage.name,
    estagioCor: deal.stage.color,
    score: deal.score,
    temperatura: describeScore(deal.score),
    detalhe,
    dias,
  };
}

const INCLUDE = {
  stage: { select: { name: true, color: true } },
  contact: {
    select: { savedName: true, pushName: true, phone: true, waJid: true },
  },
} as const;

export async function agendaDeHoje(): Promise<AgendaHoje> {
  const agora = new Date();

  // "Hoje" termina à meia-noite local, não daqui a 24 horas. Uma reunião às
  // 9h de amanhã não é tarefa de hoje.
  const fimDoDia = new Date(agora);
  fimDoDia.setHours(23, 59, 59, 999);

  const ontem = new Date(agora.getTime() - DIA);

  const [pendentes, respostas, quentesParados] = await Promise.all([
    // Atividades em aberto com prazo até o fim do dia.
    prisma.activity.findMany({
      where: {
        doneAt: null,
        dueAt: { not: null, lte: fimDoDia },
        deal: { archivedAt: null },
      },
      relationLoadStrategy: "join",
      include: { deal: { include: INCLUDE } },
      orderBy: { dueAt: "asc" },
    }),

    // Quem te respondeu desde ontem. É a fila mais quente que existe: a pessoa
    // deu um sinal e está esperando.
    prisma.deal.findMany({
      where: {
        archivedAt: null,
        stage: { isWon: false, isLost: false },
        lastInboundAt: { gte: ontem },
      },
      relationLoadStrategy: "join",
      include: INCLUDE,
      orderBy: { lastInboundAt: "desc" },
      take: 20,
    }),

    // Leads quentes que estão esfriando por abandono. O score alto diz que
    // valia a pena; o silêncio diz que você parou no meio.
    prisma.deal.findMany({
      where: {
        archivedAt: null,
        stage: { isWon: false, isLost: false },
        score: { gte: 45 },
        OR: [
          { lastInteractionAt: { lt: new Date(agora.getTime() - 5 * DIA) } },
          { lastInteractionAt: null },
        ],
      },
      relationLoadStrategy: "join",
      include: INCLUDE,
      orderBy: { score: "desc" },
      take: 15,
    }),
  ]);

  const atrasados: ItemHoje[] = [];
  const hoje: ItemHoje[] = [];

  // "2º follow-up" em vez de só "Follow-up": diz em que ponto da insistência
  // você está com aquele lead.
  const numeros = await numerosDeFollowUp(pendentes.filter((a) => a.type === "FOLLOW_UP").map((a) => a.dealId));

  for (const a of pendentes) {
    const venceu = a.dueAt!;
    const dias = daysSince(venceu);
    const numero = numeros.get(a.id);
    const tipo = numero ? ordinalFollowUp(numero) : (ROTULO_ATIVIDADE[a.type] ?? "Tarefa");
    const rotulo = a.title ? (numero ? `${tipo}: ${a.title}` : a.title) : tipo;

    if (venceu < agora && dias >= 1) {
      atrasados.push(
        paraItem(a.deal, `${rotulo} · venceu há ${dias} ${dias === 1 ? "dia" : "dias"}`, dias),
      );
    } else {
      const hora = venceu.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      hoje.push(paraItem(a.deal, `${rotulo} · hoje às ${hora}`, 0));
    }
  }

  // Quem já aparece como resposta nova não precisa aparecer de novo como
  // esfriando: seria a mesma pessoa em duas listas, com conselhos opostos.
  const jaListados = new Set([
    ...atrasados.map((i) => i.dealId),
    ...hoje.map((i) => i.dealId),
    ...respostas.map((d) => d.id),
  ]);

  return {
    atrasados,
    hoje,
    responderam: respostas.map((d) =>
      paraItem(d, "Respondeu e está esperando você", 0),
    ),
    esfriando: quentesParados
      .filter((d) => !jaListados.has(d.id))
      .map((d) => {
        const dias = d.lastInteractionAt ? daysSince(d.lastInteractionAt) : 999;
        return paraItem(
          d,
          d.lastInteractionAt
            ? `Sem conversa há ${dias} dias`
            : "Nunca houve conversa registrada",
          dias,
        );
      }),
    totalPendente: atrasados.length + hoje.length + respostas.length,
  };
}
