import type { EvolutionMessage } from "./types";
import { MessageType } from "@/lib/generated/prisma/client";

/**
 * Tradução do formato do WhatsApp para o nosso modelo.
 *
 * O protocolo do WhatsApp guarda o conteúdo num objeto cuja ÚNICA chave indica
 * o tipo (`conversation`, `imageMessage`, `audioMessage`...). Não existe campo
 * "type" confiável, então o tipo é inferido de qual chave apareceu.
 */

type ParsedMessage = {
  waMessageId: string;
  remoteJid: string;
  /** O outro identificador da pessoa (telefone ↔ LID), quando veio. */
  alt: string | null;
  fromMe: boolean;
  type: MessageType;
  body: string | null;
  timestamp: Date;
};

/** Normaliza o timestamp: a Evolution manda segundos, às vezes como string. */
function parseTimestamp(raw: number | string | null | undefined): Date {
  if (raw === null || raw === undefined) return new Date();
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  if (!Number.isFinite(n)) return new Date();
  // Acima de 1e12 já está em milissegundos; abaixo disso está em segundos.
  return new Date(n > 1e12 ? n : n * 1000);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readString(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Extrai tipo e texto legível. Para mídia, devolve a legenda quando existe —
 * uma foto com "segue a proposta em anexo" é conteúdo relevante para o Claude.
 */
function extractContent(
  message: Record<string, unknown> | null,
): { type: MessageType; body: string | null } {
  if (!message) return { type: MessageType.OTHER, body: null };

  // Mensagens efêmeras e "view once" embrulham o conteúdo real numa camada extra.
  const unwrapped =
    asRecord(asRecord(message.ephemeralMessage)?.message) ??
    asRecord(asRecord(message.viewOnceMessage)?.message) ??
    asRecord(asRecord(message.viewOnceMessageV2)?.message) ??
    message;

  if (typeof unwrapped.conversation === "string") {
    return { type: MessageType.TEXT, body: unwrapped.conversation };
  }

  const extended = asRecord(unwrapped.extendedTextMessage);
  if (extended) {
    return { type: MessageType.TEXT, body: readString(extended, "text") };
  }

  const media: [string, MessageType][] = [
    ["imageMessage", MessageType.IMAGE],
    ["videoMessage", MessageType.VIDEO],
    ["audioMessage", MessageType.AUDIO],
    ["documentMessage", MessageType.DOCUMENT],
    ["documentWithCaptionMessage", MessageType.DOCUMENT],
    ["stickerMessage", MessageType.STICKER],
  ];

  for (const [key, type] of media) {
    const node = asRecord(unwrapped[key]);
    if (node) {
      const caption = readString(node, "caption") ?? readString(node, "fileName");
      return { type, body: caption };
    }
  }

  if (asRecord(unwrapped.locationMessage) || asRecord(unwrapped.liveLocationMessage)) {
    return { type: MessageType.LOCATION, body: null };
  }

  const contactMsg =
    asRecord(unwrapped.contactMessage) ?? asRecord(unwrapped.contactsArrayMessage);
  if (contactMsg) {
    return { type: MessageType.CONTACT, body: readString(contactMsg, "displayName") };
  }

  return { type: MessageType.OTHER, body: null };
}

/**
 * Converte uma mensagem da Evolution para o nosso formato.
 * Devolve `null` quando falta o essencial (id ou destinatário) — mensagem sem
 * id não dá para deduplicar, e guardar duplicata suja todas as métricas.
 */
export function parseMessage(raw: EvolutionMessage): ParsedMessage | null {
  const waMessageId = raw.key?.id;
  const remoteJid = raw.key?.remoteJid;
  if (!waMessageId || !remoteJid) return null;

  const { type, body } = extractContent(asRecord(raw.message));

  return {
    waMessageId,
    remoteJid,
    alt: jidAlternativo(raw),
    fromMe: raw.key?.fromMe === true,
    type,
    body,
    timestamp: parseTimestamp(raw.messageTimestamp),
  };
}

/** O identificador alternativo da conversa (telefone ↔ LID), se a mensagem trouxe. */
export function jidAlternativo(raw: EvolutionMessage): string | null {
  const alt = raw.key?.remoteJidAlt ?? raw.key?.senderPn ?? null;
  return alt && alt !== raw.key?.remoteJid ? alt : null;
}

/**
 * Separa as duas identidades de uma pessoa a partir do JID da conversa e do
 * alternativo: o telefone ("@s.whatsapp.net") e o LID ("@lid"). Qualquer um
 * dos dois pode faltar.
 */
export function identidades(jid: string, alt?: string | null): { pn: string | null; lid: string | null } {
  const todos = [jid, alt].filter((j): j is string => Boolean(j));
  return {
    pn: todos.find((j) => j.endsWith("@s.whatsapp.net")) ?? null,
    lid: todos.find((j) => j.endsWith("@lid")) ?? null,
  };
}

/**
 * O WhatsApp identifica pessoas de duas formas hoje:
 *
 *   "5511999999999@s.whatsapp.net"  formato antigo, contém o telefone
 *   "62194827364@lid"               formato novo (Linked ID), opaco
 *
 * O LID é uma medida de privacidade: os dígitos NÃO são um telefone e não há
 * como derivar um a partir dele. Em contas recentes ele já é a maioria.
 */
export function isLidJid(jid: string): boolean {
  return jid.endsWith("@lid");
}

/**
 * "5511999999999@s.whatsapp.net" -> "5511999999999"
 *
 * Devolve null para qualquer outro formato. Isso é deliberado: um LID como
 * "62194827364@lid" casaria com um regex de dígitos e viraria um telefone
 * falso com cara de verdadeiro — e você só descobriria ao ligar para ele.
 * Sem telefone é melhor que telefone errado.
 */
export function jidToPhone(jid: string): string | null {
  if (!jid.endsWith("@s.whatsapp.net")) return null;
  const match = jid.match(/^(\d+)@/);
  return match ? match[1] : null;
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

/**
 * Descarta JIDs que não são pessoas: grupos, status/stories, newsletters,
 * transmissões e bots. Sem isso o funil nasce entupido de ruído.
 */
export function isPersonJid(jid: string): boolean {
  if (jid.startsWith("status@")) return false;
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

/** Formata para leitura: "5511987654321" -> "+55 11 98765-4321" */
export function formatPhone(phone: string | null): string | null {
  if (!phone) return null;
  const br = phone.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`;
  return `+${phone}`;
}
