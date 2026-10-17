import { prisma } from "@/lib/db";
import { contactName } from "@/lib/queries";
import { formatPhone } from "@/lib/evolution/parse";
import type { LeadSemAtividade } from "@/lib/lista-atividades";
import { numerosDeFollowUp } from "@/lib/follow-ups";
import { chaveDoTipo } from "@/lib/atividades";

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
  /** "FOLLOW_UP" ou "k:<id>" (tipo criado por você) — ver chaveDoTipo. */
  tipo: string;
  /** Nome do tipo criado por você, quando a atividade tem um. */
  tipoNome: string | null;
  /** Cor do tipo criado por você; nula nos tipos fixos (a tela usa a cor fixa). */
  tipoCor: string | null;
  title: string | null;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
  /** Número do follow-up no lead (1º, 2º…); nulo para os outros tipos. */
  numero: number | null;
  deal: {
    id: string;
    nome: string;
    estagio: string;
    estagioCor: string;
    /** Telefone do lead já formatado; nulo quando o WhatsApp não informou. */
    telefone: string | null;
    funilId: string;
    funilNome: string;
  };
  /** Quem marcou a atividade. Nulo nas automáticas ou de usuário removido. */
  responsavel: { id: string; nome: string } | null;
};

const CAMPOS = {
  id: true,
  type: true,
  kindId: true,
  kind: { select: { name: true, color: true } },
  title: true,
  dueAt: true,
  doneAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
  deal: {
    select: {
      id: true,
      title: true,
      stage: { select: { name: true, color: true, pipeline: { select: { id: true, name: true } } } },
      contact: { select: { savedName: true, pushName: true, phone: true, waJid: true } },
    },
  },
} as const;

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
    select: CAMPOS,
  });
  return montar(linhas);
}

/**
 * Atividades da vista Lista: TUDO o que está em aberto, de qualquer data (as
 * atrasadas de meses atrás e as marcadas para longe), mais o que foi feito
 * nos últimos 60 dias. A lista filtra o período na tela, sem ir ao servidor.
 */
export async function atividadesParaLista(): Promise<AtividadeCalendario[]> {
  const desde = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const linhas = await prisma.activity.findMany({
    where: {
      deal: { archivedAt: null },
      OR: [{ doneAt: null }, { doneAt: { gte: desde } }],
    },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    relationLoadStrategy: "join",
    select: CAMPOS,
  });
  return montar(linhas);
}

type Linha = Awaited<ReturnType<typeof prisma.activity.findMany<{ select: typeof CAMPOS }>>>[number];

async function montar(linhas: Linha[]): Promise<AtividadeCalendario[]> {
  const numeros = await numerosDeFollowUp(linhas.filter((a) => a.type === "FOLLOW_UP").map((a) => a.deal.id));

  return linhas.map((a) => ({
    id: a.id,
    type: a.type,
    tipo: chaveDoTipo(a),
    tipoNome: a.kind?.name ?? null,
    tipoCor: a.kind?.color ?? null,
    title: a.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    doneAt: a.doneAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    numero: numeros.get(a.id) ?? null,
    deal: {
      id: a.deal.id,
      nome: a.deal.title ?? contactName(a.deal.contact),
      estagio: a.deal.stage.name,
      estagioCor: a.deal.stage.color,
      telefone: formatPhone(a.deal.contact.phone),
      funilId: a.deal.stage.pipeline.id,
      funilNome: a.deal.stage.pipeline.name,
    },
    responsavel: a.createdBy ? { id: a.createdBy.id, nome: a.createdBy.name } : null,
  }));
}

/** Quem pode ser responsável: os usuários ativos, para o filtro. */
export async function responsaveis(): Promise<{ id: string; nome: string }[]> {
  const usuarios = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return usuarios.map((u) => ({ id: u.id, nome: u.name }));
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

/**
 * Leads em andamento sem nenhuma atividade em aberto — o ⚠️ amarelo do funil.
 * Ganho e Perdido ficam de fora: negócio fechado não precisa de próximo passo.
 */
export async function leadsSemAtividade(): Promise<LeadSemAtividade[]> {
  const deals = await prisma.deal.findMany({
    where: { archivedAt: null, activities: { none: { doneAt: null } }, stage: { isWon: false, isLost: false } },
    relationLoadStrategy: "join",
    select: {
      id: true,
      title: true,
      lastInteractionAt: true,
      stage: { select: { name: true, color: true, pipeline: { select: { id: true, name: true } } } },
      contact: { select: { savedName: true, pushName: true, phone: true, waJid: true } },
    },
  });
  return deals.map((d) => ({
    id: d.id,
    nome: d.title ?? contactName(d.contact),
    telefone: formatPhone(d.contact.phone),
    funilId: d.stage.pipeline.id,
    funilNome: d.stage.pipeline.name,
    coluna: d.stage.name,
    colunaCor: d.stage.color,
    ultimaConversa: d.lastInteractionAt?.toISOString() ?? null,
  }));
}
