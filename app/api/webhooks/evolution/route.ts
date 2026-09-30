import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { recalculateScore } from "@/lib/deals";
import { ingestLiveMessage, upsertContact } from "@/lib/ingest";
import { isPersonJid } from "@/lib/evolution/parse";
import { aplicarEtiqueta, sincronizarEtiquetas } from "@/lib/labels";
import { avisarMudanca } from "@/lib/eventos";
import type { EvolutionMessage } from "@/lib/evolution/types";

export const runtime = "nodejs";

/**
 * Recebe os eventos da Evolution API.
 *
 * Esta rota é pública por natureza — a Evolution precisa alcançá-la — então a
 * autenticação é um segredo compartilhado no header `apikey`.
 *
 * Com várias contas conectadas, cada evento traz o nome da instância, e é ele
 * que diz a qual número a mensagem pertence. Ignorar esse campo misturaria as
 * conversas de contas diferentes no mesmo lead.
 */

/** Comparação em tempo constante: `===` vaza o tamanho do prefixo correto. */
function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) {
    console.error("WEBHOOK_SECRET não configurada — webhook recusado");
    return NextResponse.json({ error: "não configurado" }, { status: 500 });
  }

  if (!secretMatches(request.headers.get("apikey"), expected)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as {
    event?: string;
    instance?: string;
    data?: unknown;
  } | null;

  if (!payload?.event) {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  // Sem instância não dá para saber de qual número veio. Descartar é melhor
  // que chutar uma conta e contaminar o funil dela.
  if (!payload.instance) {
    console.warn(`Webhook ${payload.event} sem instância — descartado`);
    return NextResponse.json({ ok: true, ignorado: "sem instância" });
  }

  const conta = await contaDaInstancia(payload.instance);

  if (!conta) {
    // Instância que o CRM não conhece: pode ser uma conta removida daqui mas
    // ainda viva na Evolution. Ignorar em silêncio é o certo.
    return NextResponse.json({ ok: true, ignorado: "conta desconhecida" });
  }

  // A Evolution normaliza o nome do evento de formas diferentes entre versões
  // ("messages.upsert" e "MESSAGES_UPSERT" circulam nas duas).
  const event = payload.event.toLowerCase().replace(/_/g, ".");

  try {
    switch (event) {
      case "messages.upsert":
        await handleMessages(conta.id, payload.data);
        break;
      case "contacts.upsert":
      case "contacts.update":
        await handleContacts(conta.id, payload.data);
        break;
      case "connection.update":
        await handleConnection(payload.instance, payload.data);
        break;
      case "labels.association":
        await handleLabelAssociation(conta.id, payload.data);
        break;
      case "labels.edit":
        // Uma etiqueta foi criada ou renomeada no celular. Ressincronizar
        // mantém a tela de mapeamento em dia sem você precisar pedir.
        await sincronizarEtiquetas(conta.id).catch(() => {});
        break;
      default:
        // Eventos que não assinamos chegam mesmo assim em algumas versões.
        break;
    }
  } catch (error) {
    // Erro aqui nunca devolve 500: a Evolution reenfileira o evento e insiste,
    // e um bug nosso viraria uma tempestade de retentativas.
    console.error(`Erro processando webhook ${payload.event}`, error);
  }

  return NextResponse.json({ ok: true });
}

/**
 * Conta de cada instância, guardada por um minuto.
 *
 * Toda mensagem precisa dessa resposta, e ela quase nunca muda: buscar no
 * banco a cada evento era uma ida de ~200 ms antes de começar o trabalho.
 * Instância desconhecida não é guardada — uma conta recém-criada passa a
 * valer na hora.
 */
const cacheContas = new Map<string, { id: string; ate: number }>();

async function contaDaInstancia(instanceName: string): Promise<{ id: string } | null> {
  const guardada = cacheContas.get(instanceName);
  if (guardada && guardada.ate > Date.now()) return { id: guardada.id };

  const conta = await prisma.whatsAppAccount.findUnique({
    where: { instanceName },
    select: { id: true },
  });
  if (conta) cacheContas.set(instanceName, { id: conta.id, ate: Date.now() + 60_000 });
  else cacheContas.delete(instanceName);
  return conta;
}

/** `data` vem como objeto único ou array, dependendo da versão. */
function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") return [data as T];
  return [];
}

async function handleMessages(accountId: string, data: unknown) {
  const messages = asArray<EvolutionMessage>(data);

  // Recalcula o score uma vez por deal, mesmo que um lote traga várias
  // mensagens do mesmo contato.
  const touched = new Set<string>();

  for (const message of messages) {
    const dealId = await ingestLiveMessage(accountId, message);
    if (dealId) touched.add(dealId);
  }
  if (touched.size === 0) return;

  // Avisa ASSIM que a mensagem está gravada: é o que faz a conversa e o lead
  // novo aparecerem na tela em menos de um segundo. O score leva mais uma
  // dúzia de idas ao banco — esperar por ele atrasava tudo em ~3 s.
  avisarMudanca({ dealIds: [...touched], motivo: "mensagem" });

  for (const dealId of touched) {
    await recalculateScore(dealId);
  }

  // Segundo aviso: o card troca de posição conforme o score novo.
  avisarMudanca({ dealIds: [...touched], motivo: "mensagem" });
}

async function handleContacts(accountId: string, data: unknown) {
  const contacts = asArray<{
    id?: string;
    remoteJid?: string;
    pushName?: string | null;
    profilePicUrl?: string | null;
  }>(data);

  for (const contact of contacts) {
    const waJid = contact.remoteJid ?? contact.id;
    if (!waJid || !isPersonJid(waJid)) continue;

    // Grava o contato, mas NÃO cria lead: a agenda inteira não é funil.
    // Ele serve para resolver nomes na importação e quando ele te escrever.
    await upsertContact({
      accountId,
      waJid,
      pushName: contact.pushName,
      profilePicUrl: contact.profilePicUrl,
    });
  }
}

/**
 * Uma etiqueta foi aplicada ou tirada de uma conversa no celular.
 *
 * O payload da Evolution: { type: "add" | "remove", chatId, labelId }
 */
async function handleLabelAssociation(accountId: string, data: unknown) {
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};

  const tipo = String(d.type ?? "");
  const chatId = typeof d.chatId === "string" ? d.chatId : null;
  const labelId = d.labelId != null ? String(d.labelId) : null;

  if (!chatId || !labelId) {
    console.warn("labels.association sem chatId ou labelId — descartado");
    return;
  }

  // Remocao nao move o lead: tirar "Reuniao marcada" nao diz para onde ele
  // deveria voltar, e adivinhar bagunçaria o historico de conversao.
  if (tipo !== "add") return;

  const r = await aplicarEtiqueta(accountId, chatId, labelId);
  if (r.acao === "movido") {
    console.log(`Etiqueta moveu lead para "${r.estagio}"`);
    avisarMudanca({ dealIds: [], motivo: "etiqueta" });
  }
}

async function handleConnection(instanceName: string, data: unknown) {
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const state = obj.state ? String(obj.state) : "unknown";

  // Ao conectar, a Evolution manda o número pareado. É a única chance de
  // saber qual número é esta conta.
  const numero =
    typeof obj.wuid === "string"
      ? obj.wuid.split("@")[0]
      : typeof obj.number === "string"
        ? obj.number
        : null;

  await prisma.whatsAppAccount.update({
    where: { instanceName },
    data: {
      status: state,
      ...(numero ? { phone: numero } : {}),
    },
  });
}
