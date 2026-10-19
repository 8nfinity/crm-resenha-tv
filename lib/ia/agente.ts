import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { evolution } from "@/lib/evolution/client";
import { formatPhone } from "@/lib/evolution/parse";
import { contactName } from "@/lib/queries";
import { moveDealToStage } from "@/lib/deals";
import { avisarMudanca } from "@/lib/eventos";
import { enviarPush } from "@/lib/push";
import { emFila } from "@/lib/fila";
import {
  FERRAMENTAS,
  contextoDoLead,
  dividirEmMensagens,
  historicoParaClaude,
  instrucoes,
  tempoDigitando,
} from "@/lib/ia/prompt";
import {
  UM_DIA_MS,
  conferirHorario,
  descreverHorarios,
  descreverRegra,
  horariosLivres,
  inicioDoDia,
  lerRegra,
  type Intervalo,
} from "@/lib/ia/agenda";
import { custoUsd } from "@/lib/ia/custo";

/**
 * IA de atendimento: responde pelo WhatsApp os leads do funil escolhido,
 * qualifica e agenda reuniões.
 *
 * Quando ela age:
 *   - mensagem nova do contato (pelo webhook), com o lead no funil da IA, a
 *     IA ligada e a conversa não pausada. Espera alguns segundos para juntar
 *     mensagens seguidas ("oi" / "tudo bem?" / "queria saber...") numa
 *     resposta só.
 * Quando ela SAI da conversa (e não volta sozinha):
 *   - alguém da equipe responde pelo celular ou pelo WhatsApp Web;
 *   - ela mesma passa para um humano;
 *   - alguém pausa no painel do lead.
 *
 * Tudo que ela faz fica no lead: mensagens com 🤖, notas da qualificação, a
 * reunião no Calendário e a passagem para humano.
 */

/** Modelos oferecidos na tela da IA. */
export const MODELOS_IA = [
  { id: "claude-opus-5-5", nome: "Claude Opus 5.5 (melhor qualidade)" },
  { id: "claude-sonnet-5-5", nome: "Claude Sonnet 5.5 (mais barato)" },
] as const;

/** Modelos em que a API refaz uma resposta recusada em outro modelo, sozinha. */
const COM_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

/** Espera depois da última mensagem do contato antes de responder. */
const ESPERA_JUNTAR_MS = 7_000;
/** Conversa parada há mais tempo que isso não é respondida (ex.: mensagem antiga reentregue). */
const RECENTE_MS = 30 * 60_000;
/** Quantas mensagens da conversa a IA lê. */
const HISTORICO = 40;

export async function lerConfigIA() {
  return prisma.agenteIA.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } });
}

export function iaConfigurada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Cliente da Anthropic. Chave criada fora de um workspace (no nível da
 * organização) exige dizer o workspace em cada chamada: vem de
 * ANTHROPIC_WORKSPACE_ID. Chave criada dentro de um workspace não precisa.
 */
function clienteAnthropic(): Anthropic {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
}

// ─── Gatilhos do webhook ─────────────────────────────────────────────────────

const global_ = globalThis as unknown as {
  crmIaTimers?: Map<string, ReturnType<typeof setTimeout>>;
  crmIaIds?: Set<string>;
};
const timers = (global_.crmIaTimers ??= new Map());
/** Ids das mensagens que a própria IA enviou (o webhook devolve cada uma). */
const idsDaIA = (global_.crmIaIds ??= new Set<string>());

/** Mensagem nova do contato: responde depois de uns segundos sem ele escrever mais. */
export function iaMensagemRecebida(dealId: string): void {
  clearTimeout(timers.get(dealId));
  timers.set(
    dealId,
    setTimeout(() => {
      timers.delete(dealId);
      void emFila(`ia:${dealId}`, () => responderLead(dealId)).catch((e) =>
        console.error(`IA: falha respondendo o lead ${dealId}`, e),
      );
    }, ESPERA_JUNTAR_MS),
  );
}

/**
 * Mensagem enviada do celular da empresa. Se não foi a IA, foi alguém da
 * equipe — a IA sai da conversa para não falar por cima.
 */
export function iaMensagemEnviada(dealId: string, waMessageId: string): void {
  // O aviso da mensagem da própria IA pode chegar antes de ela anotar o id:
  // espera um pouco antes de concluir que foi um humano.
  setTimeout(() => {
    void (async () => {
      if (idsDaIA.has(waMessageId)) return;
      const daIA = await prisma.message.findFirst({ where: { waMessageId, porIA: true }, select: { id: true } });
      if (daIA) return;
      const [cfg, deal] = await Promise.all([
        lerConfigIA(),
        prisma.deal.findUnique({ where: { id: dealId }, select: { iaPausadaEm: true, stage: { select: { pipelineId: true } } } }),
      ]);
      if (!cfg.ativo || !deal || deal.iaPausadaEm || deal.stage.pipelineId !== cfg.pipelineId) return;
      await pausar(dealId, "Alguém da equipe respondeu pelo WhatsApp — a IA saiu da conversa.");
    })().catch((e) => console.error("IA: falha conferindo mensagem enviada", e));
  }, 5_000);
}

export async function pausar(dealId: string, motivo: string): Promise<void> {
  clearTimeout(timers.get(dealId));
  await prisma.$transaction([
    prisma.deal.update({ where: { id: dealId }, data: { iaPausadaEm: new Date(), iaMotivoPausa: motivo } }),
    prisma.note.create({ data: { dealId, body: `🤖 IA pausada: ${motivo}` } }),
  ]);
  avisarMudanca({ dealIds: [dealId], motivo: "funil" });
}

export async function retomar(dealId: string): Promise<void> {
  await prisma.$transaction([
    prisma.deal.update({ where: { id: dealId }, data: { iaPausadaEm: null, iaMotivoPausa: null } }),
    prisma.note.create({ data: { dealId, body: "🤖 IA retomada: volta a responder este contato." } }),
  ]);
  avisarMudanca({ dealIds: [dealId], motivo: "funil" });
}

// ─── A resposta ──────────────────────────────────────────────────────────────

type Acao =
  | { tipo: "horarios"; dataInicial: string; quantosDias: number }
  | { tipo: "qualificacao"; qualificado: boolean; resumo: string }
  | { tipo: "reuniao"; inicio: string; resumo: string }
  | { tipo: "humano"; motivo: string };

export type ResultadoIA = {
  mensagens: string[];
  acoes: Acao[];
  recusou: boolean;
  /** Quanto custou esta resposta (todas as chamadas dela), em dólares. */
  custoUsd: number;
};

/**
 * Pergunta ao Claude o que responder, com as ferramentas de qualificar,
 * agendar e passar para humano. `executar` aplica as ações no CRM; desligado
 * (o simulador da tela de configuração), elas só são descritas.
 */
export async function pensarResposta(p: {
  cfg: Awaited<ReturnType<typeof lerConfigIA>>;
  historico: Anthropic.MessageParam[];
  contexto: string;
  executar: (acao: Acao) => Promise<string>;
  /** De quem é o consumo, para Métricas: o lead atendido, ou o simulador. */
  uso: { dealId: string | null; origem: "atendimento" | "simulador" };
}): Promise<ResultadoIA> {
  const client = clienteAnthropic();
  const mensagens: Anthropic.Beta.BetaMessageParam[] = [...p.historico];
  const textos: string[] = [];
  const acoes: Acao[] = [];
  let custoTotal = 0;

  for (let volta = 0; volta < 6; volta++) {
    const resposta = await client.beta.messages.create({
      model: p.cfg.modelo,
      max_tokens: 4000,
      ...(COM_FALLBACK.has(p.cfg.modelo)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      // Conversa de WhatsApp: esforço baixo responde mais rápido e basta.
      output_config: { effort: "low" },
      system: [
        // Fixo e em cache; o contexto do lead (data, coluna) vem depois.
        { type: "text", text: instrucoes({ ...p.cfg, horario: horarioDaConfig(p.cfg) }), cache_control: { type: "ephemeral" } },
        { type: "text", text: p.contexto },
      ],
      tools: FERRAMENTAS,
      messages: mensagens,
    });

    custoTotal += await registrarUso(p.cfg.modelo, resposta.usage, p.uso);

    if (resposta.stop_reason === "refusal") return { mensagens: [], acoes, recusou: true, custoUsd: custoTotal };

    for (const bloco of resposta.content) if (bloco.type === "text" && bloco.text.trim()) textos.push(bloco.text.trim());

    const usos = resposta.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (resposta.stop_reason !== "tool_use" || usos.length === 0) break;

    mensagens.push({ role: "assistant", content: resposta.content });
    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const uso of usos) {
      const entrada = uso.input as Record<string, unknown>;
      const acao: Acao | null =
        uso.name === "ver_horarios_livres"
          ? { tipo: "horarios", dataInicial: String(entrada.data_inicial ?? ""), quantosDias: Number(entrada.quantos_dias ?? 5) }
          : uso.name === "registrar_qualificacao"
          ? { tipo: "qualificacao", qualificado: Boolean(entrada.qualificado), resumo: String(entrada.resumo ?? "") }
          : uso.name === "agendar_reuniao"
            ? { tipo: "reuniao", inicio: String(entrada.inicio ?? ""), resumo: String(entrada.resumo ?? "") }
            : uso.name === "passar_para_humano"
              ? { tipo: "humano", motivo: String(entrada.motivo ?? "") }
              : null;
      if (!acao) {
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: "Ferramenta desconhecida.", is_error: true });
        continue;
      }
      try {
        const r = await p.executar(acao);
        // Consultar a agenda não é uma ação no CRM: não entra na lista.
        if (acao.tipo !== "horarios") acoes.push(acao);
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: r });
      } catch (e) {
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: (e as Error).message, is_error: true });
      }
    }
    mensagens.push({ role: "user", content: resultados });
  }

  return { mensagens: dividirEmMensagens(textos.join("\n\n")), acoes, recusou: false, custoUsd: custoTotal };
}

/**
 * Grava o consumo de uma chamada (tokens que a própria API informou) e
 * devolve o custo. Falhar ao gravar não pode atrapalhar o atendimento.
 */
async function registrarUso(
  modelo: string,
  usage: Anthropic.Beta.BetaUsage,
  uso: { dealId: string | null; origem: string },
): Promise<number> {
  const tokens = {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
  const custo = custoUsd(modelo, tokens);
  await prisma.iaUso
    .create({ data: { dealId: uso.dealId, origem: uso.origem, modelo, ...tokens, custoUsd: custo } })
    .catch((e) => console.warn("IA: não deu para registrar o consumo", (e as Error).message));
  return custo;
}

/** Responde o lead, se for a vez da IA. Seguro de chamar a mais: confere tudo de novo. */
export async function responderLead(dealId: string): Promise<void> {
  if (!iaConfigurada()) return;
  const cfg = await lerConfigIA();
  if (!cfg.ativo || !cfg.pipelineId) return;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      stage: { select: { id: true, name: true, order: true, pipelineId: true } },
      contact: {
        include: {
          account: { select: { instanceName: true } },
          messages: { orderBy: { timestamp: "desc" }, take: HISTORICO },
        },
      },
      activities: { where: { type: "MEETING", doneAt: null, dueAt: { gte: new Date() } }, select: { dueAt: true } },
      notes: { where: { body: { startsWith: "🤖 Qualificação" } }, select: { id: true }, take: 1 },
    },
  });
  if (!deal || deal.archivedAt || deal.iaPausadaEm || deal.stage.pipelineId !== cfg.pipelineId) return;
  if (deal.contact.isGroup || deal.contact.ignoredAt) return;

  const msgs = [...deal.contact.messages].reverse();
  const ultima = msgs.at(-1);
  // Só responde se a última palavra é do contato, e recente.
  if (!ultima || ultima.fromMe || Date.now() - ultima.timestamp.getTime() > RECENTE_MS) return;

  const historico = historicoParaClaude(msgs);
  if (historico.length === 0) return;

  const nome = contactName(deal.contact);
  const resultado = await pensarResposta({
    cfg,
    historico,
    contexto: contextoDoLead({
      agora: new Date(),
      nome: deal.contact.savedName ?? deal.contact.pushName,
      telefone: formatPhone(deal.contact.phone),
      coluna: deal.stage.name,
      qualificado: deal.notes.length > 0,
      reunioes: deal.activities.filter((a) => a.dueAt).map((a) => ({ quando: a.dueAt! })),
    }),
    executar: (acao) => executarAcao(deal.id, nome, acao, cfg),
    uso: { dealId: deal.id, origem: "atendimento" },
  });

  if (resultado.recusou) {
    await pausar(deal.id, "A IA não conseguiu responder esta conversa — precisa de alguém da equipe.");
    await avisarEquipe(deal.id, nome, "A IA não conseguiu responder e passou a conversa para a equipe.");
    return;
  }

  // Alguém respondeu pelo celular enquanto a IA pensava: não fala por cima.
  const agora = await prisma.deal.findUnique({ where: { id: deal.id }, select: { iaPausadaEm: true } });
  const passou = resultado.acoes.some((a) => a.tipo === "humano");
  if (agora?.iaPausadaEm && !passou) return;

  const numero = deal.contact.phone ?? deal.contact.waJid;
  for (const texto of resultado.mensagens) {
    const { id } = await evolution.enviarTexto(deal.contact.account.instanceName, numero, texto, tempoDigitando(texto));
    if (!id) continue;
    idsDaIA.add(id);
    // Grava já como da IA. Se o aviso do webhook chegou antes, só marca.
    await prisma.message.upsert({
      where: { contactId_waMessageId: { contactId: deal.contactId, waMessageId: id } },
      update: { porIA: true },
      create: { contactId: deal.contactId, waMessageId: id, fromMe: true, porIA: true, type: "TEXT", body: texto, timestamp: new Date() },
    });
  }
  if (resultado.mensagens.length > 0) {
    await prisma.deal.update({ where: { id: deal.id }, data: { lastInteractionAt: new Date() } });
    avisarMudanca({ dealIds: [deal.id], motivo: "mensagem" });
  }
}

/** Aplica no CRM o que a IA decidiu. Devolve o texto que a IA lê como resultado. */
async function executarAcao(
  dealId: string,
  nome: string,
  acao: Acao,
  cfg: Awaited<ReturnType<typeof lerConfigIA>>,
): Promise<string> {
  if (acao.tipo === "horarios") return consultarHorarios(cfg, acao.dataInicial, acao.quantosDias);

  if (acao.tipo === "qualificacao") {
    await prisma.note.create({
      data: { dealId, body: `🤖 Qualificação (IA): ${acao.qualificado ? "QUALIFICADO" : "não qualificado"}\n${acao.resumo}` },
    });
    if (acao.qualificado && cfg.colunaQualificadoId) await avancarPara(dealId, cfg.colunaQualificadoId);
    avisarMudanca({ dealIds: [dealId], motivo: "funil" });
    return "Qualificação registrada no CRM.";
  }

  if (acao.tipo === "reuniao") {
    const inicio = new Date(acao.inicio);
    if (Number.isNaN(inicio.getTime())) throw new Error("Data inválida. Use ISO 8601 com fuso, ex.: 2026-10-20T14:30:00-03:00.");
    const regra = lerRegra(cfg);
    const ocupados = await ocupadosEntre(new Date(inicio.getTime() - UM_DIA_MS), new Date(inicio.getTime() + UM_DIA_MS), regra.duracaoMin);
    const conferido = conferirHorario(regra, { agora: new Date(), inicio, ocupados });
    // Não grava: a IA lê o motivo, consulta de novo e oferece outro horário.
    if (!conferido.ok) throw new Error(`${conferido.motivo} Use ver_horarios_livres e ofereça outro horário.`);
    await prisma.$transaction([
      prisma.activity.create({
        data: {
          dealId,
          type: "MEETING",
          title: `Reunião com ${nome}`,
          notes: `${acao.resumo}\n\n(agendada pela IA de atendimento)`,
          dueAt: inicio,
        },
      }),
      prisma.note.create({ data: { dealId, body: `🤖 Reunião agendada pela IA: ${quandoBr(inicio)}\n${acao.resumo}` } }),
    ]);
    if (cfg.colunaAgendadoId) await avancarPara(dealId, cfg.colunaAgendadoId);
    avisarMudanca({ dealIds: [dealId], motivo: "atividade" });
    return `Reunião marcada para ${quandoBr(inicio)}. Confirme com a pessoa.`;
  }

  await pausar(dealId, `A IA passou para um humano: ${acao.motivo}`);
  await avisarEquipe(dealId, nome, acao.motivo);
  return "Conversa passada para a equipe. Despeça-se avisando que alguém vai continuar o atendimento.";
}

/** O horário de atendimento em uma frase, ou vazio quando não há dias/faixas definidos. */
function horarioDaConfig(cfg: Awaited<ReturnType<typeof lerConfigIA>>): string {
  const regra = lerRegra(cfg);
  return regra.dias.length && regra.janelas.length ? descreverRegra(regra) : "";
}

/**
 * O que já está no calendário entre duas datas: toda atividade com prazo
 * (reunião, ligação, follow-up…), ocupando a duração de uma reunião. É o
 * calendário da equipe inteira — a IA não marca por cima de nada.
 */
async function ocupadosEntre(de: Date, ate: Date, duracaoMin: number): Promise<Intervalo[]> {
  const atividades = await prisma.activity.findMany({
    where: { dueAt: { gte: new Date(de.getTime() - duracaoMin * 60_000), lt: ate }, deal: { archivedAt: null } },
    select: { dueAt: true },
  });
  return atividades.map((a) => ({ inicio: a.dueAt!, fim: new Date(a.dueAt!.getTime() + duracaoMin * 60_000) }));
}

/** Horários livres para a IA ler (ferramenta ver_horarios_livres). Só lê: serve ao simulador também. */
export async function consultarHorarios(
  cfg: Awaited<ReturnType<typeof lerConfigIA>>,
  dataInicial: string,
  quantosDias: number,
): Promise<string> {
  const regra = lerRegra(cfg);
  if (!regra.dias.length || !regra.janelas.length) {
    return "A empresa não definiu horário de atendimento. Não marque: passe para um humano.";
  }
  const agora = new Date();
  const de = inicioDoDia(dataInicial, agora);
  const dias = Math.min(Math.max(Math.round(quantosDias) || 5, 1), 14);
  const ocupados = await ocupadosEntre(de, new Date(de.getTime() + (dias + 1) * UM_DIA_MS), regra.duracaoMin);
  return descreverHorarios(horariosLivres(regra, { agora, de, quantosDias: dias, ocupados }));
}

/** Move só para frente: um lead que já está adiante no funil não volta. */
async function avancarPara(dealId: string, stageId: string): Promise<void> {
  const [deal, destino] = await Promise.all([
    prisma.deal.findUnique({ where: { id: dealId }, select: { stage: { select: { order: true, pipelineId: true } }, stageId: true } }),
    prisma.stage.findUnique({ where: { id: stageId }, select: { order: true, pipelineId: true } }),
  ]);
  if (!deal || !destino || deal.stageId === stageId) return;
  if (deal.stage.pipelineId === destino.pipelineId && deal.stage.order > destino.order) return;
  await moveDealToStage(dealId, stageId);
}

/** Notificação no celular de administradores e master: tem lead esperando um humano. */
async function avisarEquipe(dealId: string, nome: string, motivo: string): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { active: true, role: { in: ["MASTER", "ADMIN"] } },
    select: { id: true },
  });
  await enviarPush(
    admins.map((a) => a.id),
    { titulo: `🤖 ${nome} precisa de você`, corpo: motivo, url: `/funil?lead=${dealId}`, tag: `ia-${dealId}` },
  ).catch(() => 0);
}

function quandoBr(d: Date): string {
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
