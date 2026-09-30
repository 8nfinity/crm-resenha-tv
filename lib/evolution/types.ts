/**
 * Formatos devolvidos pela Evolution API.
 *
 * São tipos defensivos de propósito: quase tudo é opcional porque a Evolution
 * muda o shape entre versões menores e omite campos conforme o tipo de mensagem.
 * Confiar demais aqui quebraria a importação inteira por causa de um campo.
 */

export type EvolutionContact = {
  id: string; // JID: "5511999999999@s.whatsapp.net"
  pushName?: string | null;
  profilePicUrl?: string | null;
  remoteJid?: string | null;
};

export type EvolutionChat = {
  id?: string;
  remoteJid?: string | null;
  name?: string | null;
  pushName?: string | null;
  profilePicUrl?: string | null;
  updatedAt?: string | null;
  lastMessage?: EvolutionMessage | null;
};

export type EvolutionMessageKey = {
  id?: string | null;
  remoteJid?: string | null;
  fromMe?: boolean | null;
};

export type EvolutionMessage = {
  key?: EvolutionMessageKey | null;
  /** Segundos desde a época (às vezes vem como string). */
  messageTimestamp?: number | string | null;
  pushName?: string | null;
  messageType?: string | null;
  message?: Record<string, unknown> | null;
};

export type ConnectionState = {
  instance?: {
    instanceName?: string;
    state?: string; // "open" | "connecting" | "close"
  };
  state?: string;
};

/**
 * Da v2.2 em diante o findMessages devolve um envelope paginado em vez de um
 * array cru. O cliente aceita as duas formas — ver `unwrapList`.
 */
export type Paginated<T> = {
  total?: number;
  pages?: number;
  currentPage?: number;
  records?: T[];
};
