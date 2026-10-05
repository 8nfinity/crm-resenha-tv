import type {
  ConnectionState,
  EvolutionChat,
  EvolutionContact,
  EvolutionMessage,
  Paginated,
} from "./types";

/**
 * Cliente da Evolution API.
 *
 * Toda conversa com o WhatsApp passa por aqui — nenhum outro arquivo chama a
 * Evolution direto. É o que torna possível trocar pela Cloud API oficial depois
 * mexendo só neste diretório.
 *
 * Todo método recebe o nome da instância: cada número conectado é uma instância
 * separada na Evolution, com sessão e QR Code próprios.
 */

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "EvolutionError";
  }
}

function config() {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "EVOLUTION_API_URL e EVOLUTION_API_KEY precisam estar definidas nas variáveis do CRM.",
    );
  }

  // Endereço que não é URL (ex.: o texto de exemplo esquecido no lugar do
  // endereço real) virava um "Failed to parse URL" que não diz nada a ninguém.
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(
      `A variável EVOLUTION_API_URL não é um endereço válido ("${baseUrl.slice(0, 60)}"). ` +
        "Coloque o endereço público da Evolution, ex.: https://evolution-api-production.up.railway.app",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("A variável EVOLUTION_API_URL precisa começar com https:// (ou http://).");
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

/** Nome da primeira conta, criada automaticamente se nenhuma existir. */
export function instanciaPadrao(): string {
  return process.env.EVOLUTION_INSTANCE ?? "crm";
}

/**
 * Quanto esperar a Evolution antes de desistir. Sem limite, um pedido preso
 * (a Evolution sobrecarregada) segurava por minutos quem esperava por ele —
 * inclusive a fila das etiquetas, e as etiquetagens seguintes paravam junto.
 */
const ESPERA_PADRAO_MS = 20_000;
/** Para consultas no meio de uma fila: melhor seguir sem a resposta que travar as outras. */
const ESPERA_RAPIDA_MS = 8_000;

/**
 * A lista de etiquetas como a Evolution devolve. Fica TODA etiqueta com id,
 * mesmo de nome vazio: a Evolution apaga do nome tudo que não é ASCII, e uma
 * etiqueta chamada só "🔥" chega sem nome. Descartá-la fazia a sincronização
 * achar que ela tinha sido apagada no celular — e o CRM apagava a etiqueta
 * junto com o estágio ligado a ela.
 */
export function lerEtiquetas(data: unknown): { labelId: string; name: string; color: string | null }[] {
  const bruto = Array.isArray(data) ? data : [];
  return bruto
    .map((item) => {
      const l = (item ?? {}) as Record<string, unknown>;
      return {
        labelId: String(l.labelId ?? l.id ?? ""),
        name: String(l.name ?? "").trim(),
        color: l.color != null ? String(l.color) : null,
      };
    })
    .filter((l) => l.labelId);
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown; esperaMs?: number } = { method: "GET" },
): Promise<T> {
  const { baseUrl, apiKey } = config();

  // Endereço da Evolution igual ao do próprio CRM: o pedido cairia no CRM,
  // que responde com a tela de login. Acontece fácil na Railway, onde os dois
  // serviços têm endereços parecidos (...up.railway.app).
  const hostEvolution = new URL(baseUrl).host;
  const hostsDoCrm = [process.env.RAILWAY_PUBLIC_DOMAIN, process.env.APP_URL && new URL(process.env.APP_URL).host];
  if (hostsDoCrm.includes(hostEvolution)) {
    throw new EvolutionError(
      `A variável EVOLUTION_API_URL está com o endereço do próprio CRM (${hostEvolution}). ` +
        "Coloque o endereço do serviço da EVOLUTION (Railway → serviço da Evolution → Settings → Networking).",
      400,
      "",
    );
  }

  const limite = AbortSignal.timeout(init.esperaMs ?? ESPERA_PADRAO_MS);
  let res: Response;
  let texto: string;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      // Sem seguir redirecionamento: a Evolution não redireciona; quem
      // redireciona é um site que não é ela (ex.: o CRM mandando para o login).
      redirect: "manual",
      signal: limite,
    });
    texto = await res.text();
  } catch {
    if (limite.aborted) {
      throw new EvolutionError(
        `A Evolution demorou mais de ${Math.round((init.esperaMs ?? ESPERA_PADRAO_MS) / 1000)} s para responder ` +
          `em ${path.split("/").slice(0, 3).join("/")} — ela está sobrecarregada ou reiniciando.`,
        504,
        "",
      );
    }
    throw new EvolutionError(
      `Não consegui alcançar a Evolution em ${hostEvolution}. Confira se o serviço dela está no ar ` +
        "(abrindo esse endereço no navegador deve aparecer “Welcome to the Evolution API”).",
      503,
      "",
    );
  }

  const ehPagina = /^\s*<(!doctype|html)/i.test(texto) || (res.status >= 300 && res.status < 400);

  if (ehPagina) {
    // Respondeu uma PÁGINA, não a API: endereço errado, ou a Railway mostrando
    // a página de erro dela porque a Evolution não subiu.
    throw new EvolutionError(
      res.status >= 500
        ? `O endereço ${hostEvolution} não está respondendo como a Evolution (erro ${res.status} da hospedagem). ` +
            "Confira se o serviço da Evolution subiu e se o domínio dele usa a porta 8080."
        : `O endereço ${hostEvolution} respondeu uma página de site, não a Evolution. ` +
            "Confira se a EVOLUTION_API_URL tem o endereço do serviço da EVOLUTION (e não o do CRM).",
      res.status,
      texto.slice(0, 200),
    );
  }

  if (!res.ok) {
    throw new EvolutionError(
      res.status === 401 || res.status === 403
        ? "A Evolution recusou a chave: a EVOLUTION_API_KEY do CRM precisa ser igual à AUTHENTICATION_API_KEY da Evolution."
        : `Evolution API respondeu ${res.status} em ${path}`,
      res.status,
      texto.slice(0, 500),
    );
  }

  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new EvolutionError(`A Evolution respondeu algo que não é JSON em ${path}.`, res.status, texto.slice(0, 200));
  }
}

/**
 * Aceita os três formatos que já circularam: array cru, o envelope paginado
 * `{ records: [...] }` e — na 2.3 — esse mesmo envelope embrulhado de novo em
 * `{ messages: { records: [...] } }`.
 *
 * O terceiro caso passou despercebido por um tempo: sem ele a lista vinha
 * vazia sem erro nenhum, e a importação criava os leads sem uma única mensagem.
 */
function unwrapList<T>(
  payload: T[] | Paginated<T> | { messages?: Paginated<T> } | null | undefined,
): T[] {
  return paginaDe(payload).records;
}

function paginaDe<T>(
  payload: T[] | Paginated<T> | { messages?: Paginated<T> } | null | undefined,
): { records: T[]; pages: number } {
  if (!payload) return { records: [], pages: 0 };
  if (Array.isArray(payload)) return { records: payload, pages: 1 };
  const envelope: Paginated<T> | undefined =
    "messages" in payload && payload.messages ? payload.messages : (payload as Paginated<T>);
  return {
    records: Array.isArray(envelope?.records) ? envelope.records : [],
    pages: Number(envelope?.pages ?? 1),
  };
}

/**
 * A Evolution grava tudo no próprio banco e, sob carga (sincronização do
 * histórico logo após parear), devolve 500 por timeout dele. É passageiro:
 * tentar de novo depois de um respiro resolve na maioria das vezes.
 */
async function comRetentativa<T>(fn: () => Promise<T>, tentativas = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      const passageiro = error instanceof EvolutionError && error.status >= 500;
      if (!passageiro || i >= tentativas) throw error;
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
}

export const evolution = {
  /** Instâncias que existem na Evolution, independente do que o CRM conhece. */
  async listInstances(): Promise<
    { instanceName: string; status?: string; number?: string }[]
  > {
    const data = await request<unknown>("/instance/fetchInstances");
    const bruto = Array.isArray(data) ? data : [];

    // O formato mudou entre versões: já veio aninhado em `instance` e já veio
    // plano. Aceitar os dois evita quebrar numa atualização da Evolution.
    return bruto.map((item) => {
      const i = item as Record<string, unknown>;
      const aninhado = (i.instance ?? i) as Record<string, unknown>;
      return {
        instanceName: String(aninhado.instanceName ?? aninhado.name ?? ""),
        status: aninhado.connectionStatus
          ? String(aninhado.connectionStatus)
          : aninhado.status
            ? String(aninhado.status)
            : undefined,
        number: aninhado.number ? String(aninhado.number) : undefined,
      };
    });
  },

  /** Cria uma instância nova. Idempotente: se já existe, não é erro. */
  async createInstance(instanceName: string): Promise<void> {
    try {
      await request("/instance/create", {
        method: "POST",
        body: {
          instanceName,
          integration: "WHATSAPP-BAILEYS",
          qrcode: false,
        },
      });
    } catch (error) {
      // 403/409 significa "já existe", que é exatamente o estado desejado.
      if (
        error instanceof EvolutionError &&
        (error.status === 403 || error.status === 409)
      ) {
        return;
      }
      throw error;
    }
  },

  /** Desconecta o celular, mas mantém a instância para reconectar depois. */
  async logout(instanceName: string): Promise<void> {
    await request(`/instance/logout/${instanceName}`, { method: "DELETE" });
  },

  /** Apaga a instância e a sessão. Reconectar exige QR Code novo. */
  async deleteInstance(instanceName: string): Promise<void> {
    try {
      await request(`/instance/delete/${instanceName}`, { method: "DELETE" });
    } catch (error) {
      // Já não existe do lado da Evolution: o objetivo está cumprido.
      if (error instanceof EvolutionError && error.status === 404) return;
      throw error;
    }
  },

  /** Estado da conexão: "open" quando o celular está pareado. */
  async connectionState(instanceName: string): Promise<string> {
    try {
      const data = await request<ConnectionState>(
        `/instance/connectionState/${instanceName}`,
      );
      return data.instance?.state ?? data.state ?? "unknown";
    } catch (error) {
      if (error instanceof EvolutionError && error.status === 404) {
        return "not_found";
      }
      throw error;
    }
  },

  /** Devolve o QR Code (base64) para parear o celular. */
  async connect(
    instanceName: string,
  ): Promise<{ base64?: string; code?: string; pairingCode?: string }> {
    return request(`/instance/connect/${instanceName}`);
  },

  /** Todos os contatos que a instância conhece. */
  async findContacts(instanceName: string): Promise<EvolutionContact[]> {
    const data = await comRetentativa(() =>
      request<EvolutionContact[] | Paginated<EvolutionContact>>(
        `/chat/findContacts/${instanceName}`,
        { method: "POST", body: { where: {} } },
      ),
    );
    return unwrapList(data);
  },

  /**
   * Todas as conversas. Mais útil que findContacts para o CRM: a agenda inteira
   * inclui gente com quem você nunca falou, e conversa aberta é sinal de lead.
   */
  async findChats(instanceName: string, janela?: { desde: Date; ate: Date }): Promise<EvolutionChat[]> {
    // A Evolution monta a lista varrendo TODAS as mensagens do número (a
    // tabela dela não tem índice por conversa): fica mais lenta a cada mês de
    // mensagens guardadas. Com a janela, ela só olha as mensagens do período —
    // a varredura de cada minuto só precisa das conversas que se mexeram.
    const body = janela
      ? { where: { messageTimestamp: { gte: janela.desde.toISOString(), lte: janela.ate.toISOString() } } }
      : {};
    const data = await comRetentativa(() =>
      request<EvolutionChat[] | Paginated<EvolutionChat>>(
        `/chat/findChats/${instanceName}`,
        { method: "POST", body, esperaMs: 60_000 },
      ),
    );
    return unwrapList(data);
  },

  /**
   * O telefone de um LID, pelo cache de números da Evolution — consulta leve
   * (uma linha por contato), sem varrer mensagens. Só ajuda num caso: a
   * conversa que chega pelo TELEFONE com o LID ao lado (a Evolution guarda o
   * par). Na que chega pelo LID ela guarda só o telefone, sem o LID — por isso
   * as mensagens são consultadas antes (ver descobrirPessoa). Devolve null
   * quando ela não sabe.
   */
  async telefoneDoLid(instanceName: string, lid: string): Promise<string | null> {
    const data = await request<unknown>(`/chat/whatsappNumbers/${instanceName}`, {
      method: "POST",
      body: { numbers: [lid] },
      esperaMs: ESPERA_RAPIDA_MS,
    });
    const lista = Array.isArray(data) ? (data as { jid?: unknown }[]) : [];
    const jid = lista.map((r) => (typeof r?.jid === "string" ? r.jid : "")).find((j) => j.endsWith("@s.whatsapp.net"));
    return jid ?? null;
  },

  /**
   * Mensagens de uma conversa, da mais recente para a mais antiga.
   *
   * A Evolution 2.x ignora `limit` e pagina com `offset` (tamanho da página) e
   * `page`. Pedimos páginas de até 100 e paramos ao atingir o limite.
   *
   * A busca é só pelo `remoteJid` gravado — o identificador por onde a
   * conversa chegou. A Evolution 2.3 NÃO filtra por `remoteJidAlt` (o filtro
   * dela só conhece id, fromMe, remoteJid e participants): pedir o outro lado
   * devolvia a conversa inteira sem filtro nenhum aplicado a ele.
   */
  async findMessages(
    instanceName: string,
    remoteJid: string,
    limit = 200,
    opcoes: {
      /** Só mensagens a partir de quando (a Evolution filtra antes de varrer). */
      desde?: Date;
      /**
       * Uma tentativa só e pouca espera: para quem está no meio de uma fila
       * (etiquetas, avisos de mensagem) e não pode ficar segurando as outras.
       */
      rapido?: boolean;
    } = {},
  ): Promise<EvolutionMessage[]> {
    const porPagina = Math.min(limit, 100);
    const todas: EvolutionMessage[] = [];
    const where = {
      key: { remoteJid },
      // A Evolution só aplica o período com as duas pontas.
      ...(opcoes.desde
        ? {
            messageTimestamp: {
              gte: opcoes.desde.toISOString(),
              lte: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            },
          }
        : {}),
    };

    for (let page = 1; todas.length < limit; page++) {
      const data = await comRetentativa(
        () =>
          request<
            | EvolutionMessage[]
            | Paginated<EvolutionMessage>
            | { messages?: Paginated<EvolutionMessage> }
          >(`/chat/findMessages/${instanceName}`, {
            method: "POST",
            body: { where, offset: porPagina, page, limit },
            ...(opcoes.rapido ? { esperaMs: ESPERA_RAPIDA_MS } : {}),
          }),
        opcoes.rapido ? 1 : 3,
      );
      const { records, pages } = paginaDe(data);
      todas.push(...records);
      if (records.length < porPagina || page >= pages) break;
    }

    return todas.slice(0, limit);
  },

  /**
   * Uma mensagem pelo id, como a Evolution GUARDOU — com a chave original.
   *
   * O aviso que ela manda ao CRM troca o LID pelo telefone (remoteJid e
   * remoteJidAlt chegam iguais), mas no banco dela a mensagem fica com o LID
   * em `remoteJid` e o telefone em `remoteJidAlt`. É daqui que o CRM tira o
   * LID de quem acabou de escrever.
   */
  async mensagemPorId(instanceName: string, id: string): Promise<EvolutionMessage | null> {
    const data = await request<
      EvolutionMessage[] | Paginated<EvolutionMessage> | { messages?: Paginated<EvolutionMessage> }
    >(`/chat/findMessages/${instanceName}`, {
      method: "POST",
      body: { where: { key: { id } }, offset: 1, page: 1 },
      esperaMs: ESPERA_RAPIDA_MS,
    });
    return paginaDe(data).records.find((m) => m.key?.id === id) ?? null;
  },

  /**
   * Etiquetas do WhatsApp Business.
   *
   * Num WhatsApp pessoal devolve lista vazia: etiquetas simplesmente nao
   * existem fora do Business. Nao e erro, e ausencia do recurso.
   */
  async findLabels(
    instanceName: string,
  ): Promise<{ labelId: string; name: string; color: string | null }[]> {
    // A Evolution responde 500 aqui enquanto o número ainda não carregou na
    // memória dela (reiniciando, reconectando): tentar de novo resolve.
    return lerEtiquetas(await comRetentativa(() => request<unknown>(`/label/findLabels/${instanceName}`)));
  },

  /**
   * A foto de perfil de alguém, pelo telefone ou pelo LID — só leitura, como o
   * WhatsApp Web faz ao abrir uma conversa. Null se a pessoa não tem foto ou a
   * privacidade dela esconde.
   *
   * (Não existe aqui nada que aplique ou retire etiqueta: escrever nos dados
   * da conta trava a chegada das etiquetas — ver lib/labels.ts.)
   */
  async fotoDePerfil(instanceName: string, jid: string): Promise<string | null> {
    const data = await request<{ profilePictureUrl?: unknown }>(`/chat/fetchProfilePictureUrl/${instanceName}`, {
      method: "POST",
      body: { number: jid },
      esperaMs: ESPERA_RAPIDA_MS,
    });
    return typeof data?.profilePictureUrl === "string" && data.profilePictureUrl ? data.profilePictureUrl : null;
  },

  /** Para onde a instância está mandando os eventos hoje (null se nada configurado). */
  async findWebhook(instanceName: string): Promise<{ url: string; enabled: boolean } | null> {
    const data = await request<{ url?: string; enabled?: boolean } | null>(`/webhook/find/${instanceName}`);
    return data?.url ? { url: data.url, enabled: data.enabled !== false } : null;
  },

  /**
   * Aponta a instância para o webhook do CRM. Chamado ao gerar o QR Code;
   * evita configurar isso na mão no painel da Evolution.
   */
  async setWebhook(
    instanceName: string,
    url: string,
    secret: string,
  ): Promise<unknown> {
    return request(`/webhook/set/${instanceName}`, {
      method: "POST",
      body: {
        webhook: {
          enabled: true,
          url,
          headers: { apikey: secret, "Content-Type": "application/json" },
          byEvents: false,
          base64: false,
          events: [
            "MESSAGES_UPSERT",
            "CONTACTS_UPSERT",
            "CONNECTION_UPDATE",
            // Dispara quando voce etiqueta uma conversa no celular. E o
            // gatilho que move o lead no funil sozinho.
            "LABELS_ASSOCIATION",
            "LABELS_EDIT",
          ],
        },
      },
    });
  },
};
