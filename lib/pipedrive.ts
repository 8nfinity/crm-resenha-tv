import { prisma } from "@/lib/db";
import { contactName } from "@/lib/queries";
import { formatPhone } from "@/lib/evolution/parse";
import { urlPublica } from "@/lib/url-publica";

/**
 * Integração com o Pipedrive: o lead do CRM vira, lá, uma PESSOA (nome e
 * telefone) e um NEGÓCIO no funil e etapa escolhidos, com uma nota resumindo
 * a conversa e o link de volta para o CRM.
 *
 * Só no sentido CRM → Pipedrive. O lead guarda o id do negócio criado:
 * enviar de novo atualiza título e valor em vez de duplicar, e antes de criar
 * a pessoa o CRM procura alguém com o mesmo telefone.
 *
 * API v2 do Pipedrive (a v1 de negócios e pessoas está sem suporte desde
 * 01/08/2026). Autenticação pelo token pessoal no cabeçalho `x-api-token`, no
 * domínio da empresa (empresa.pipedrive.com). Notas e "quem sou eu" ainda são
 * v1, que não tem substituta para elas.
 */

export class ErroPipedrive extends Error {}

export type ConfigPipedrive = {
  token: string;
  dominio: string;
  pipelineId: number | null;
  stageId: number | null;
  /** Coluna do CRM que envia sozinha ao receber um lead. */
  autoStageId: string | null;
};

export async function lerConfig(): Promise<ConfigPipedrive | null> {
  const s = await prisma.systemState.findUnique({
    where: { id: "singleton" },
    select: {
      pipedriveToken: true,
      pipedriveDomain: true,
      pipedrivePipelineId: true,
      pipedriveStageId: true,
      pipedriveAutoStageId: true,
    },
  });
  if (!s?.pipedriveToken || !s.pipedriveDomain) return null;
  return {
    token: s.pipedriveToken,
    dominio: s.pipedriveDomain,
    pipelineId: s.pipedrivePipelineId,
    stageId: s.pipedriveStageId,
    autoStageId: s.pipedriveAutoStageId,
  };
}

// ─── Chamadas ────────────────────────────────────────────────────────────────

/** O que o Pipedrive diz quando algo dá errado, em português. */
export function mensagemDeErro(status: number, detalhe?: string): string {
  if (status === 401) return "O Pipedrive recusou o token. Confira o token em Configurações → Pipedrive.";
  if (status === 403) return "O usuário dono do token não tem permissão para isso no Pipedrive.";
  if (status === 404) return "Não encontrado no Pipedrive (o funil, a etapa ou o negócio pode ter sido apagado lá).";
  if (status === 429) return "O Pipedrive pediu para esperar (muitas chamadas seguidas). Tente de novo em um minuto.";
  return `O Pipedrive respondeu com erro ${status}${detalhe ? `: ${detalhe}` : ""}.`;
}

async function chamar<T>(url: string, token: string, init?: { method?: string; corpo?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        "x-api-token": token,
        Accept: "application/json",
        ...(init?.corpo ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.corpo ? JSON.stringify(init.corpo) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ErroPipedrive("Não deu para falar com o Pipedrive (sem conexão ou demorou demais).");
  }
  const corpo = (await res.json().catch(() => null)) as { data?: T; error?: string } | null;
  if (!res.ok) throw new ErroPipedrive(mensagemDeErro(res.status, corpo?.error));
  return corpo?.data as T;
}

const base = (dominio: string) => `https://${dominio}.pipedrive.com`;

/**
 * Confere o token e descobre a empresa. É o "quem sou eu" do Pipedrive — o
 * único endereço que funciona sem saber o domínio da empresa ainda.
 */
export async function conferirToken(token: string): Promise<{ nome: string; empresa: string; dominio: string }> {
  const eu = await chamar<{ name?: string; company_name?: string; company_domain?: string }>(
    "https://api.pipedrive.com/v1/users/me",
    token,
  );
  if (!eu?.company_domain) throw new ErroPipedrive("O Pipedrive aceitou o token mas não informou a empresa.");
  return { nome: eu.name ?? "", empresa: eu.company_name ?? eu.company_domain, dominio: eu.company_domain };
}

export type FunilPipedrive = { id: number; nome: string; etapas: { id: number; nome: string }[] };

export async function funisDoPipedrive(cfg: { token: string; dominio: string }): Promise<FunilPipedrive[]> {
  const [funis, etapas] = await Promise.all([
    chamar<{ id: number; name: string }[]>(`${base(cfg.dominio)}/api/v2/pipelines?limit=500`, cfg.token),
    chamar<{ id: number; name: string; pipeline_id: number; order_nr?: number }[]>(
      `${base(cfg.dominio)}/api/v2/stages?limit=500`,
      cfg.token,
    ),
  ]);
  return (funis ?? []).map((f) => ({
    id: f.id,
    nome: f.name,
    etapas: (etapas ?? [])
      .filter((e) => e.pipeline_id === f.id)
      .sort((a, b) => (a.order_nr ?? 0) - (b.order_nr ?? 0))
      .map((e) => ({ id: e.id, nome: e.name })),
  }));
}

// ─── Montagem (pura, testada) ────────────────────────────────────────────────

/** Só os dígitos, com o DDI: "5551985409366". */
export function digitos(telefone: string | null | undefined): string {
  return (telefone ?? "").replace(/\D/g, "");
}

/**
 * A pessoa do Pipedrive tem este telefone? Compara os últimos 8 dígitos: o
 * mesmo número aparece como "+55 51 98540-9366", "(51) 98540-9366" ou com
 * e sem o nono dígito, e o final é o que não muda.
 */
export function mesmoTelefone(fonesDoPipedrive: unknown[], telefone: string): boolean {
  const final = digitos(telefone).slice(-8);
  if (final.length < 8) return false;
  return fonesDoPipedrive.some((f) => {
    const valor = typeof f === "string" ? f : (f as { value?: string } | null)?.value;
    return digitos(valor).endsWith(final);
  });
}

export function montarPessoa(nome: string, telefone: string | null) {
  const d = digitos(telefone);
  return {
    name: nome,
    ...(d ? { phones: [{ value: `+${d}`, primary: true, label: "mobile" }] } : {}),
  };
}

export function montarNegocio(p: {
  titulo: string;
  valor: number | null;
  personId: number;
  pipelineId: number | null;
  stageId: number | null;
}) {
  return {
    title: p.titulo,
    person_id: p.personId,
    ...(p.valor !== null ? { value: p.valor, currency: "BRL" } : {}),
    ...(p.pipelineId ? { pipeline_id: p.pipelineId } : {}),
    ...(p.stageId ? { stage_id: p.stageId } : {}),
  };
}

function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Nota do negócio: de onde veio, o fim da conversa e o link para o CRM. */
export function montarNota(p: {
  telefone: string | null;
  funil: string;
  coluna: string;
  mensagens: { fromMe: boolean; body: string | null; timestamp: Date }[];
  link: string;
}): string {
  const linhas = p.mensagens
    .filter((m) => m.body?.trim())
    .map((m) => {
      const quando = m.timestamp.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return `<li><b>${m.fromMe ? "Você" : "Lead"}</b> (${quando}): ${escapar(m.body!.trim().slice(0, 300))}</li>`;
    });
  return [
    `<p><b>Enviado pelo CRM Resenha TV</b></p>`,
    `<p>WhatsApp: ${escapar(p.telefone ?? "não informado")}<br>No CRM: ${escapar(p.funil)} · ${escapar(p.coluna)}</p>`,
    linhas.length ? `<p><b>Últimas mensagens</b></p><ul>${linhas.join("")}</ul>` : "",
    `<p><a href="${escapar(p.link)}">Abrir o lead no CRM</a></p>`,
  ].join("");
}

export function urlDoNegocio(dominio: string, dealId: number): string {
  return `${base(dominio)}/deal/${dealId}`;
}

// ─── Envio ───────────────────────────────────────────────────────────────────

export type ResultadoEnvio = { pipedriveDealId: number; url: string; novo: boolean };

/**
 * Envia (ou atualiza) um lead no Pipedrive. Lança ErroPipedrive com a
 * mensagem para mostrar na tela quando algo não dá certo.
 */
export async function enviarParaPipedrive(dealId: string): Promise<ResultadoEnvio> {
  const cfg = await lerConfig();
  if (!cfg) throw new ErroPipedrive("O Pipedrive ainda não foi conectado. Um administrador configura em Configurações → Pipedrive.");

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      contact: {
        include: { messages: { orderBy: { timestamp: "desc" }, take: 8, select: { fromMe: true, body: true, timestamp: true } } },
      },
      stage: { include: { pipeline: { select: { name: true } } } },
    },
  });
  if (!deal) throw new ErroPipedrive("Lead não encontrado.");

  const nome = deal.title ?? contactName(deal.contact);
  const telefone = deal.contact.phone;
  const valor = deal.value ? Number(deal.value) : null;
  const url = (caminho: string) => `${base(cfg.dominio)}${caminho}`;

  // Pessoa: a que já ligamos antes, ou alguém com o mesmo telefone, ou nova.
  let personId = deal.pipedrivePersonId;
  if (!personId && digitos(telefone).length >= 8) {
    const achados = await chamar<{ items?: { item?: { id: number; phones?: unknown[] } }[] }>(
      url(`/api/v2/persons/search?term=${digitos(telefone).slice(-8)}&fields=phone&limit=10`),
      cfg.token,
    );
    personId = achados?.items?.find((i) => i.item && mesmoTelefone(i.item.phones ?? [], telefone!))?.item?.id ?? null;
  }
  if (!personId) {
    const pessoa = await chamar<{ id: number }>(url("/api/v2/persons"), cfg.token, {
      method: "POST",
      corpo: montarPessoa(nome, telefone),
    });
    personId = pessoa.id;
  }

  // Negócio: atualiza o que já existe; se foi apagado lá, cria outro.
  let pipedriveDealId = deal.pipedriveDealId;
  let novo = false;
  if (pipedriveDealId) {
    try {
      await chamar(url(`/api/v2/deals/${pipedriveDealId}`), cfg.token, {
        method: "PATCH",
        corpo: { title: nome, ...(valor !== null ? { value: valor, currency: "BRL" } : {}) },
      });
    } catch (e) {
      if (!(e instanceof ErroPipedrive) || !e.message.startsWith("Não encontrado")) throw e;
      pipedriveDealId = null;
    }
  }
  if (!pipedriveDealId) {
    const negocio = await chamar<{ id: number }>(url("/api/v2/deals"), cfg.token, {
      method: "POST",
      corpo: montarNegocio({ titulo: nome, valor, personId, pipelineId: cfg.pipelineId, stageId: cfg.stageId }),
    });
    pipedriveDealId = negocio.id;
    novo = true;

    // A nota só no primeiro envio: reenviar não enche o negócio de notas iguais.
    await chamar(url("/api/v1/notes"), cfg.token, {
      method: "POST",
      corpo: {
        deal_id: pipedriveDealId,
        person_id: personId,
        content: montarNota({
          telefone: formatPhone(telefone),
          funil: deal.stage.pipeline.name,
          coluna: deal.stage.name,
          mensagens: [...deal.contact.messages].reverse(),
          link: `${urlPublica()}/funil?lead=${deal.id}`,
        }),
      },
    }).catch((e) => console.warn("Pipedrive: negócio criado, mas a nota falhou —", (e as Error).message));
  }

  await prisma.deal.update({
    where: { id: deal.id },
    data: { pipedriveDealId, pipedrivePersonId: personId, pipedriveSentAt: new Date() },
  });

  return { pipedriveDealId, url: urlDoNegocio(cfg.dominio, pipedriveDealId), novo };
}

/** Configuração lida há pouco: cada movimento de card não vai ao banco por ela. */
let configGuardada: { cfg: ConfigPipedrive | null; ate: number } | null = null;

export function esquecerConfigGuardada() {
  configGuardada = null;
}

/**
 * Regra automática: o lead que entra na coluna escolhida vai sozinho para o
 * Pipedrive (uma vez — se já foi, não reenvia). Roda depois do movimento e
 * nunca o atrapalha: um erro no Pipedrive só vai para o log.
 */
export async function envioAutomatico(dealId: string, toStageId: string): Promise<void> {
  try {
    if (!configGuardada || configGuardada.ate < Date.now()) {
      configGuardada = { cfg: await lerConfig(), ate: Date.now() + 30_000 };
    }
    const cfg = configGuardada.cfg;
    if (!cfg?.autoStageId || cfg.autoStageId !== toStageId) return;

    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { pipedriveDealId: true } });
    if (!deal || deal.pipedriveDealId) return;

    const r = await enviarParaPipedrive(dealId);
    console.log(`Pipedrive: lead ${dealId} enviado automaticamente → negócio ${r.pipedriveDealId}`);
  } catch (e) {
    console.warn(`Pipedrive: envio automático do lead ${dealId} falhou —`, (e as Error).message);
  }
}
