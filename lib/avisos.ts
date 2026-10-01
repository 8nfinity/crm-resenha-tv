import { prisma } from "@/lib/db";
import { contactName } from "@/lib/queries";
import { ordinalFollowUp, rotuloTipoNumerado } from "@/lib/atividades";
import { emailConfigurado, enviarEmail, escaparHtml, moldura } from "@/lib/email";
import { enviarPush, temAparelhos } from "@/lib/push";
import { numerosDeFollowUp } from "@/lib/follow-ups";
import { urlPublica } from "@/lib/url-publica";

/**
 * Avisos de atividades: notificação no aparelho (celular/computador) e e-mail.
 *
 * Dois tipos:
 *  - LEMBRETE: X minutos antes de cada atividade marcada (AVISO_MINUTOS_ANTES,
 *    padrão 30). Sai uma vez só por atividade — remarcar libera de novo.
 *  - RESUMO DO DIA: às AVISO_HORA_RESUMO (padrão 7h), o que vence hoje e o
 *    que está atrasado. Vendedor recebe o que ele marcou; administradores, o
 *    do time.
 *
 * Quem recebe o lembrete: quem marcou a atividade → os administradores.
 *  - Notificação: em todo aparelho que a pessoa ativou (ativar já é a escolha
 *    de receber).
 *  - E-mail: se o envio de e-mail estiver configurado e a pessoa não tiver
 *    desligado em "Minha conta".
 */

export type Pessoa = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  emailNotifications: boolean;
};

const SELECIONA_PESSOA = { id: true, name: true, email: true, active: true, emailNotifications: true } as const;

export function minutosAntes(): number {
  const n = Number(process.env.AVISO_MINUTOS_ANTES);
  return Number.isFinite(n) && n >= 5 && n <= 24 * 60 ? Math.round(n) : 30;
}

export function horaDoResumo(): number {
  const n = Number(process.env.AVISO_HORA_RESUMO);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 7;
}

/**
 * Responsáveis por uma atividade: quem marcou ou, sem autor ativo (marcada
 * pelo Claude, ou de alguém que saiu), os administradores.
 */
export function responsaveisDaAtividade({ criador, admins }: { criador: Pessoa | null; admins: Pessoa[] }): Pessoa[] {
  if (criador?.active) return [criador];
  return admins.filter((p) => p.active);
}

/**
 * Para quem vai o lembrete POR E-MAIL de uma atividade.
 *
 * O responsável é quem marcou. Se essa pessoa desligou os e-mails, a escolha
 * dela vale — o aviso não cai para os administradores. Atividade sem autor
 * ativo (marcada pelo Claude, ou de alguém que saiu) vai para os administradores.
 */
export function escolherDestinatarios({
  criador,
  admins,
}: {
  criador: Pessoa | null;
  admins: Pessoa[];
}): Pessoa[] {
  const recebe = (p: Pessoa) => p.active && p.emailNotifications && p.email.includes("@");
  if (criador?.active) return recebe(criador) ? [criador] : [];
  return admins.filter(recebe);
}

/**
 * Janela do lembrete: do que venceu há pouco (o servidor pode ter reiniciado
 * bem na hora) até X minutos à frente. O que venceu há mais tempo entra no
 * resumo do dia como atrasado — lembrete de algo de ontem não ajuda ninguém.
 */
export function janelaDoLembrete(agora: Date, minutos: number): { de: Date; ate: Date } {
  return {
    de: new Date(agora.getTime() - 15 * 60_000),
    ate: new Date(agora.getTime() + minutos * 60_000),
  };
}

/** Dia no fuso de Brasília, "2026-10-01" — independe do fuso da máquina. */
export function diaEmBrasilia(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

function horaEmBrasilia(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(d),
  ) % 24;
}

/**
 * Hora de mandar o resumo? A partir da hora marcada, uma vez por dia. Até o
 * meio-dia: se o servidor passou a manhã fora do ar, ainda manda; depois
 * disso, o "resumo do dia" já não serve e fica para amanhã.
 */
export function horaDoResumoChegou(agora: Date, ultimoDia: string | null, hora = horaDoResumo()): boolean {
  const h = horaEmBrasilia(agora);
  return h >= hora && h < Math.max(hora + 1, 12) && diaEmBrasilia(agora) !== ultimoDia;
}

/** "qua., 01/10 às 09:00", sempre no horário de Brasília. */
export function quando(d: Date): string {
  const tz = { timeZone: "America/Sao_Paulo" } as const;
  const dia = d.toLocaleDateString("pt-BR", { ...tz, weekday: "short", day: "2-digit", month: "2-digit" });
  const h = d.toLocaleTimeString("pt-BR", { ...tz, hour: "2-digit", minute: "2-digit" });
  return `${dia} às ${h}`;
}

function horaCurta(d: Date): string {
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------- consultas

const INCLUI_ATIVIDADE = {
  createdBy: { select: SELECIONA_PESSOA },
  deal: {
    select: {
      id: true,
      title: true,
      contact: { select: { savedName: true, pushName: true, phone: true, waJid: true } },
    },
  },
} as const;

type AtividadeComLead = {
  id: string;
  type: string;
  title: string | null;
  dueAt: Date | null;
  createdById: string | null;
  createdBy: Pessoa | null;
  /** Número do follow-up no lead (1º, 2º…), preenchido depois da busca. */
  numero?: number;
  deal: {
    id: string;
    title: string | null;
    contact: { savedName: string | null; pushName: string | null; phone: string | null; waJid: string };
  };
};

function nomeDoLead(a: AtividadeComLead): string {
  return a.deal.title ?? contactName(a.deal.contact);
}

function descricao(a: AtividadeComLead): string {
  const titulo = a.title?.trim();
  if (titulo) return a.numero ? `${ordinalFollowUp(a.numero)}: ${titulo}` : titulo;
  return rotuloTipoNumerado(a.type, a.numero);
}

/** Preenche o número de cada follow-up (1º, 2º…) contando todos os do lead. */
async function numerar(atividades: AtividadeComLead[]) {
  const numeros = await numerosDeFollowUp(atividades.filter((a) => a.type === "FOLLOW_UP").map((a) => a.deal.id));
  for (const a of atividades) a.numero = numeros.get(a.id);
}

/** Há por onde avisar? E-mail configurado ou alguém com aparelho ativado. */
async function haCanal(): Promise<{ email: boolean; push: boolean }> {
  return { email: emailConfigurado(), push: await temAparelhos() };
}

/** Atividades só de leads visíveis: arquivados e contatos ignorados não avisam. */
const LEAD_VISIVEL = { archivedAt: null, contact: { ignoredAt: null } } as const;

async function administradores(): Promise<Pessoa[]> {
  return prisma.user.findMany({
    where: { role: { in: ["MASTER", "ADMIN"] }, active: true },
    select: SELECIONA_PESSOA,
  });
}

// ---------------------------------------------------------------- lembretes

let lembrando = false;

/**
 * Manda os lembretes que venceram a janela: notificação nos aparelhos e
 * e-mail. Devolve quantos avisos saíram (aparelhos + e-mails).
 */
export async function enviarLembretes(agora = new Date()): Promise<number> {
  if (lembrando) return 0;
  const canal = await haCanal();
  if (!canal.email && !canal.push) return 0;
  lembrando = true;
  try {
    const { de, ate } = janelaDoLembrete(agora, minutosAntes());
    const atividades = (await prisma.activity.findMany({
      where: { doneAt: null, reminderSentAt: null, dueAt: { gte: de, lte: ate }, deal: LEAD_VISIVEL },
      include: INCLUI_ATIVIDADE,
      orderBy: { dueAt: "asc" },
      take: 200,
    })) as unknown as AtividadeComLead[];
    if (atividades.length === 0) return 0;

    const admins = await administradores();
    await numerar(atividades);

    const avisadas = new Set<string>();
    let enviados = 0;

    // Notificação: uma por atividade, em cada aparelho dos responsáveis.
    const semAparelho = new Set<string>();
    if (canal.push) {
      for (const a of atividades) {
        const pessoas = responsaveisDaAtividade({ criador: a.createdBy, admins });
        const n = await enviarPush(
          pessoas.map((p) => p.id),
          {
            titulo: `${descricao(a)} às ${horaCurta(a.dueAt!)}`,
            corpo: `Com ${nomeDoLead(a)} · daqui a pouco`,
            url: "/hoje",
            tag: `atividade-${a.id}`,
          },
        );
        enviados += n;
        if (n > 0) avisadas.add(a.id);
        else semAparelho.add(a.id);
      }
    }

    // E-mail: um por pessoa, com todas as atividades dela na janela.
    const porPessoa = new Map<string, { pessoa: Pessoa; itens: AtividadeComLead[] }>();
    for (const a of atividades) {
      const destinos = canal.email ? escolherDestinatarios({ criador: a.createdBy, admins }) : [];
      // Ninguém para avisar por canal nenhum: marca para não procurar de novo.
      if (destinos.length === 0 && (!canal.push || semAparelho.has(a.id))) avisadas.add(a.id);
      for (const p of destinos) {
        const grupo = porPessoa.get(p.id) ?? { pessoa: p, itens: [] };
        grupo.itens.push(a);
        porPessoa.set(p.id, grupo);
      }
    }

    for (const { pessoa, itens } of porPessoa.values()) {
      const r = await enviarEmail(emailDeLembrete(pessoa, itens));
      if (r.ok) {
        enviados++;
        for (const a of itens) avisadas.add(a.id);
      } else {
        // Sem marcar (se a notificação também não chegou): tenta de novo no
        // próximo minuto, enquanto a atividade estiver na janela.
        console.warn(`Lembrete para ${pessoa.email} não saiu: ${r.erro}`);
      }
    }

    if (avisadas.size > 0) {
      await prisma.activity.updateMany({
        where: { id: { in: [...avisadas] } },
        data: { reminderSentAt: agora },
      });
    }
    return enviados;
  } finally {
    lembrando = false;
  }
}

function emailDeLembrete(pessoa: Pessoa, itens: AtividadeComLead[]) {
  const primeira = itens[0];
  const assunto =
    itens.length === 1
      ? `Lembrete: ${descricao(primeira)} com ${nomeDoLead(primeira)} às ${horaCurta(primeira.dueAt!)}`
      : `Lembrete: ${itens.length} atividades chegando`;

  const linhas = itens.map((a) => ({
    html: `<tr><td style="padding:10px 0;border-bottom:1px solid #1d3a2b"><strong style="color:#ffffff">${escaparHtml(descricao(a))}</strong> · ${escaparHtml(nomeDoLead(a))}<br><span style="color:#f2d417">${escaparHtml(quando(a.dueAt!))}</span></td></tr>`,
    texto: `- ${descricao(a)} · ${nomeDoLead(a)} — ${quando(a.dueAt!)}`,
  }));

  const url = `${urlPublica()}/calendario`;
  return {
    para: pessoa.email,
    assunto,
    html: moldura({
      titulo: itens.length === 1 ? "Sua atividade está chegando" : "Suas atividades estão chegando",
      corpoHtml: `Olá, ${escaparHtml(pessoa.name.split(" ")[0])}. Daqui a pouco:<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">${linhas.map((l) => l.html).join("")}</table>`,
      botao: { texto: "Abrir a agenda", url },
    }),
    texto: `Olá, ${pessoa.name}. Daqui a pouco:\n${linhas.map((l) => l.texto).join("\n")}\n\nAgenda: ${url}`,
  };
}

// ---------------------------------------------------------------- resumo do dia

let resumindo = false;

/**
 * Resumo diário. `forcar` ignora a hora e o "já mandei hoje" (botão de teste).
 * Devolve quantos e-mails saíram.
 */
export async function enviarResumoDiario({ agora = new Date(), forcar = false } = {}): Promise<number> {
  if (resumindo) return 0;
  const canal = await haCanal();
  if (!canal.email && !canal.push) return 0;
  resumindo = true;
  try {
    const hoje = diaEmBrasilia(agora);
    if (!forcar) {
      const estado = await prisma.systemState.findUnique({ where: { id: "singleton" } });
      if (!horaDoResumoChegou(agora, estado?.lastDigestOn ?? null)) return 0;
      // Marca ANTES de enviar: se o envio cair no meio, perder um resumo é
      // melhor que mandar o mesmo resumo a cada minuto.
      await prisma.systemState.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", lastDigestOn: hoje },
        update: { lastDigestOn: hoje },
      });
    }

    // Fim do dia em Brasília (o Brasil não tem mais horário de verão: -03:00).
    const fimDoDia = new Date(`${hoje}T23:59:59.999-03:00`);

    const [atividades, pessoas] = await Promise.all([
      prisma.activity.findMany({
        where: { doneAt: null, dueAt: { lte: fimDoDia }, deal: LEAD_VISIVEL },
        include: INCLUI_ATIVIDADE,
        orderBy: { dueAt: "asc" },
        take: 1000,
      }) as unknown as Promise<AtividadeComLead[]>,
      prisma.user.findMany({
        where: { active: true },
        select: { ...SELECIONA_PESSOA, role: true },
      }),
    ]);
    await numerar(atividades);

    let enviados = 0;
    for (const pessoa of pessoas) {
      const time = pessoa.role !== "VENDEDOR";
      const minhas = time
        ? atividades
        : atividades.filter(
            (a) => a.createdById === pessoa.id,
          );
      if (minhas.length === 0) continue;

      const atrasadas = minhas.filter((a) => a.dueAt! < agora);
      const deHoje = minhas.filter((a) => !atrasadas.includes(a));

      if (canal.push) {
        enviados += await enviarPush([pessoa.id], {
          titulo: time ? "Seu dia no CRM (time)" : "Seu dia no CRM",
          corpo: resumoCurto(deHoje.length, atrasadas.length),
          url: "/hoje",
          tag: `resumo-${hoje}`,
        });
      }
      if (canal.email && pessoa.emailNotifications) {
        const r = await enviarEmail(emailDeResumo(pessoa, deHoje, atrasadas, time));
        if (r.ok) enviados++;
        else console.warn(`Resumo para ${pessoa.email} não saiu: ${r.erro}`);
      }
    }
    return enviados;
  } finally {
    resumindo = false;
  }
}

/** "3 para hoje e 1 atrasada" */
export function resumoCurto(hoje: number, atrasadas: number): string {
  return [
    hoje ? `${hoje} para hoje` : null,
    atrasadas ? `${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" e ");
}

const MAX_ITENS = 40;

function emailDeResumo(pessoa: Pessoa, deHoje: AtividadeComLead[], atrasadas: AtividadeComLead[], time: boolean) {
  const bloco = (titulo: string, cor: string, itens: AtividadeComLead[], comDia: boolean) => {
    if (itens.length === 0) return { html: "", texto: "" };
    const mostrar = itens.slice(0, MAX_ITENS);
    const resto = itens.length - mostrar.length;
    const linha = (a: AtividadeComLead) => {
      const momento = comDia ? quando(a.dueAt!) : horaCurta(a.dueAt!);
      const vendedor = time && a.createdBy ? ` · marcada por ${a.createdBy.name}` : "";
      return {
        html: `<tr><td style="padding:8px 0;border-bottom:1px solid #1d3a2b"><span style="color:${cor};font-weight:700">${escaparHtml(momento)}</span> · <strong style="color:#ffffff">${escaparHtml(descricao(a))}</strong> · ${escaparHtml(nomeDoLead(a))}<span style="color:#7f9a8c">${escaparHtml(vendedor)}</span></td></tr>`,
        texto: `- ${momento} · ${descricao(a)} · ${nomeDoLead(a)}${vendedor}`,
      };
    };
    const linhas = mostrar.map(linha);
    const mais = resto > 0 ? `e mais ${resto}…` : "";
    return {
      html: `<p style="margin:18px 0 4px;color:${cor};font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:1px">${titulo} (${itens.length})</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${linhas.map((l) => l.html).join("")}</table>${mais ? `<p style="color:#7f9a8c;font-size:12px">${mais}</p>` : ""}`,
      texto: `${titulo} (${itens.length}):\n${linhas.map((l) => l.texto).join("\n")}${mais ? `\n${mais}` : ""}`,
    };
  };

  const hoje = bloco("Para hoje", "#2fe38c", deHoje, false);
  const atrasos = bloco("Atrasadas", "#ff7a59", atrasadas, true);
  const url = `${urlPublica()}/hoje`;
  const quem = time ? "do time" : "suas";
  const resumo = resumoCurto(deHoje.length, atrasadas.length);

  return {
    para: pessoa.email,
    assunto: `Seu dia no CRM: ${resumo}`,
    html: moldura({
      titulo: "Resumo do dia",
      corpoHtml: `Bom dia, ${escaparHtml(pessoa.name.split(" ")[0])}! Atividades ${quem}: ${escaparHtml(resumo)}.${hoje.html}${atrasos.html}`,
      botao: { texto: "Abrir o CRM", url },
    }),
    texto: `Bom dia, ${pessoa.name}! Atividades ${quem}: ${resumo}.\n\n${hoje.texto}\n\n${atrasos.texto}\n\n${url}`,
  };
}

// ---------------------------------------------------------------- teste

/** E-mail de teste para o próprio usuário (botão em Configurações). */
export async function enviarEmailDeTeste(pessoa: { name: string; email: string }) {
  const url = urlPublica();
  return enviarEmail({
    para: pessoa.email,
    assunto: "Teste de aviso do CRM Biomech",
    html: moldura({
      titulo: "Os avisos por e-mail estão funcionando",
      corpoHtml: `Olá, ${escaparHtml(pessoa.name.split(" ")[0])}. Se este e-mail chegou, o CRM já consegue mandar os lembretes ${minutosAntes()} minutos antes de cada atividade e o resumo do dia às ${horaDoResumo()}h.`,
      botao: { texto: "Abrir o CRM", url },
    }),
    texto: `Olá, ${pessoa.name}. Os avisos por e-mail do CRM estão funcionando. ${url}`,
  });
}
