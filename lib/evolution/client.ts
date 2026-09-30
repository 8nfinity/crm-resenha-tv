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
      "EVOLUTION_API_URL e EVOLUTION_API_KEY precisam estar definidas no .env",
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

/** Nome da primeira conta, criada automaticamente se nenhuma existir. */
export function instanciaPadrao(): string {
  return process.env.EVOLUTION_INSTANCE ?? "crm";
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown } = { method: "GET" },
): Promise<T> {
  const { baseUrl, apiKey } = config();

  const res = await fetch(`${baseUrl}${path}`, {
    method: init.method,
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new EvolutionError(
      `Evolution API respondeu ${res.status} em ${path}`,
      res.status,
      body.slice(0, 500),
    );
  }

  return (await res.json()) as T;
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
  async findChats(instanceName: string): Promise<EvolutionChat[]> {
    const data = await comRetentativa(() =>
      request<EvolutionChat[] | Paginated<EvolutionChat>>(
        `/chat/findChats/${instanceName}`,
        { method: "POST", body: {} },
      ),
    );
    return unwrapList(data);
  },

  /**
   * Mensagens de uma conversa, da mais recente para a mais antiga.
   *
   * A Evolution 2.x ignora `limit` e pagina com `offset` (tamanho da página) e
   * `page`. Pedimos páginas de até 100 e paramos ao atingir o limite.
   */
  async findMessages(
    instanceName: string,
    remoteJid: string,
    limit = 200,
  ): Promise<EvolutionMessage[]> {
    const porPagina = Math.min(limit, 100);
    const todas: EvolutionMessage[] = [];

    for (let page = 1; todas.length < limit; page++) {
      const data = await comRetentativa(() =>
        request<
          | EvolutionMessage[]
          | Paginated<EvolutionMessage>
          | { messages?: Paginated<EvolutionMessage> }
        >(`/chat/findMessages/${instanceName}`, {
          method: "POST",
          body: { where: { key: { remoteJid } }, offset: porPagina, page, limit },
        }),
      );
      const { records, pages } = paginaDe(data);
      todas.push(...records);
      if (records.length < porPagina || page >= pages) break;
    }

    return todas.slice(0, limit);
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
    const data = await request<unknown>(`/label/findLabels/${instanceName}`);
    const bruto = Array.isArray(data) ? data : [];

    return bruto
      .map((item) => {
        const l = item as Record<string, unknown>;
        return {
          labelId: String(l.labelId ?? l.id ?? ""),
          name: String(l.name ?? ""),
          color: l.color != null ? String(l.color) : null,
        };
      })
      .filter((l) => l.labelId && l.name);
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
