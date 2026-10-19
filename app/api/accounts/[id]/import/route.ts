import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { evolution } from "@/lib/evolution/client";
import { contactName } from "@/lib/queries";
import { isPersonJid, jidAlternativo, jidToPhone } from "@/lib/evolution/parse";
import { leadAutomatico, recalculateScore } from "@/lib/deals";
import { ingestMessages, upsertContact } from "@/lib/ingest";
import { avisarMudanca } from "@/lib/eventos";
import { etiquetasDoChat } from "@/lib/ignorar";
import type { EvolutionContact } from "@/lib/evolution/types";

export const runtime = "nodejs";
// Funções serverless são cortadas por tempo. O lote é pequeno de propósito e a
// tela de conexão chama esta rota várias vezes, mostrando o progresso.
export const maxDuration = 60;

const MAX_JIDS_POR_LOTE = 8;
const MENSAGENS_POR_CONVERSA = 300;
const IMPORTACOES_SIMULTANEAS = 4;

/**
 * A lista de conversas não traz nome nenhum — a agenda traz. Cruzar as duas é
 * a única forma de saber quem é cada lead, e vale ainda mais nos contatos
 * "@lid" (formato novo do WhatsApp), onde nem o telefone existe para cair como
 * alternativa.
 */
function indexarContatos(contacts: EvolutionContact[]) {
  const nomePorJid = new Map<string, string>();
  const fotoPorJid = new Map<string, string>();

  for (const c of contacts) {
    const jid = c.remoteJid ?? c.id;
    if (!jid) continue;
    if (nomeUtilizavel(c.pushName)) nomePorJid.set(jid, c.pushName!.trim());
    if (c.profilePicUrl) fotoPorJid.set(jid, c.profilePicUrl);
  }

  return { nomePorJid, fotoPorJid };
}

/**
 * O WhatsApp devolve lixo como nome com alguma frequência: "$", strings vazias
 * e o próprio identificador. Aceitar isso encheria o funil de cards ilegíveis.
 */
function nomeUtilizavel(nome: string | null | undefined): boolean {
  if (!nome) return false;
  const limpo = nome.trim();
  return limpo.length > 1 && !/^\$+$/.test(limpo) && !limpo.includes("@");
}

async function carregarConta(id: string) {
  return prisma.whatsAppAccount.findUnique({ where: { id } });
}

/** GET — conversas desta conta disponíveis para importar. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conta = await carregarConta(id);
  if (!conta) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  try {
    const [chats, contacts, existentes, ignorados, etiquetasIgnorar] = await Promise.all([
      evolution.findChats(conta.instanceName),
      evolution.findContacts(conta.instanceName),
      prisma.contact.findMany({
        where: { accountId: conta.id, deals: { some: {} }, messages: { some: {} } },
        select: { waJid: true, lid: true },
      }),
      prisma.contact.findMany({
        where: { accountId: conta.id, ignoredAt: { not: null } },
        select: { waJid: true },
      }),
      prisma.whatsAppLabel.findMany({
        where: { accountId: conta.id, ignoreContact: true },
        select: { labelId: true },
      }),
    ]);

    // Fora da lista: quem foi marcado para ignorar e quem está com uma
    // etiqueta de "ignorar" no celular.
    const jidsIgnorados = new Set(ignorados.map((c) => c.waJid));
    const idsIgnorar = new Set(etiquetasIgnorar.map((e) => e.labelId));
    const ignorar = (chat: (typeof chats)[number], jid: string) =>
      jidsIgnorados.has(jid) || etiquetasDoChat(chat).some((id) => idsIgnorar.has(id));

    // "Já importado" significa ter virado lead nesta conta COM a conversa
    // dentro — não basta existir na agenda, nem ter um card vazio. O segundo
    // caso é o que sobra de uma importação que falhou no meio: sem esta
    // exigência, ela nunca seria refeita. Vale pelo telefone ou pelo LID: a
    // conversa listada pelo LID é a do lead que o CRM guardou pelo telefone.
    const jaImportados = new Set(existentes.flatMap((c) => (c.lid ? [c.waJid, c.lid] : [c.waJid])));
    const { nomePorJid, fotoPorJid } = indexarContatos(contacts);

    const itens = chats
      .filter((chat) => !ignorar(chat, chat.remoteJid ?? chat.id ?? ""))
      .map((chat) => {
        const jid = chat.remoteJid ?? chat.id ?? "";

        // O nome vem de três fontes, nesta ordem: a agenda (o nome que VOCÊ
        // salvou), a própria conversa, e a última mensagem recebida. A terceira
        // é a que salva os contatos "@lid" — mas só vale se a mensagem foi
        // DELE: se a última foi sua, o nome ali é o seu.
        const nomeDaUltimaMensagem =
          chat.lastMessage?.key?.fromMe === false ? chat.lastMessage.pushName : null;

        const nome =
          nomePorJid.get(jid) ??
          [chat.name, chat.pushName, nomeDaUltimaMensagem].find(nomeUtilizavel)?.trim() ??
          null;

        return {
          waJid: jid,
          nome,
          telefone: jidToPhone(jid),
          profilePicUrl: chat.profilePicUrl ?? fotoPorJid.get(jid) ?? null,
          atualizadoEm: chat.updatedAt ?? null,
          jaImportado: jaImportados.has(jid),
        };
      })
      .filter((item) => item.waJid && isPersonJid(item.waJid))
      .sort((a, b) => (b.atualizadoEm ?? "").localeCompare(a.atualizadoEm ?? ""));

    return NextResponse.json({ total: itens.length, itens });
  } catch (error) {
    console.error("Falha ao listar conversas", error);
    return NextResponse.json(
      {
        error:
          "Não consegui falar com a Evolution API. Confira se a instância está conectada.",
      },
      { status: 502 },
    );
  }
}

const bodySchema = z.object({
  jids: z.array(z.string()).min(1).max(MAX_JIDS_POR_LOTE),
});

/** POST — importa um lote de conversas desta conta. Idempotente. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conta = await carregarConta(id);
  if (!conta) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Envie de 1 a ${MAX_JIDS_POR_LOTE} jids por lote` },
      { status: 400 },
    );
  }

  const resultados: {
    waJid: string;
    nome: string;
    mensagensNovas: number;
    erro?: string;
  }[] = [];

  // Uma consulta à agenda para o lote inteiro. Sem isso, os contatos "@lid"
  // entrariam sem nome: o identificador novo não tem telefone para servir de
  // alternativa, e a conversa em si não carrega o nome.
  const { nomePorJid, fotoPorJid } = indexarContatos(
    await evolution.findContacts(conta.instanceName).catch(() => []),
  );

  // Cada conversa custa várias idas ao banco e à Evolution, quase todas
  // esperando rede. Processar algumas ao mesmo tempo corta o tempo do lote sem
  // estourar o pool de conexões (que é de 10).
  const { id: accountId, instanceName } = conta;
  const fila = [...parsed.data.jids];
  const trabalhadores = Array.from({ length: Math.min(IMPORTACOES_SIMULTANEAS, fila.length) }, async () => {
    for (let waJid = fila.shift(); waJid; waJid = fila.shift()) {
      resultados.push(await importarConversa(waJid));
    }
  });
  await Promise.all(trabalhadores);

  async function importarConversa(waJid: string): Promise<(typeof resultados)[number]> {
    if (!isPersonJid(waJid)) {
      return { waJid, nome: waJid, mensagensNovas: 0, erro: "não é um contato pessoal" };
    }

    try {
      // As mensagens vêm primeiro: elas trazem o outro identificador da pessoa
      // (telefone ↔ LID), que é o que evita criar o mesmo contato duas vezes.
      const mensagens = await evolution.findMessages(instanceName, waJid, MENSAGENS_POR_CONVERSA);
      const alt = mensagens.map(jidAlternativo).find(Boolean) ?? null;
      let contato = await upsertContact({
        accountId,
        waJid,
        alt,
        savedName: nomePorJid.get(waJid) ?? null,
        profilePicUrl: fotoPorJid.get(waJid) ?? null,
      });
      if (contato.ignoredAt) {
        return { waJid, nome: contactName(contato), mensagensNovas: 0, erro: "contato ignorado" };
      }

      const mensagensNovas = await ingestMessages(contato.id, mensagens);

      // As mensagens dele às vezes trazem um nome que a agenda não tem.
      const pushName = mensagens.find((m) => m.key?.fromMe === false)?.pushName;
      if (nomeUtilizavel(pushName)) {
        contato = await upsertContact({ accountId, waJid, alt, pushName });
      }

      // Número só com etiqueta: importa a conversa, mas só vira lead quem
      // estiver etiquetado (a etiqueta traz o lead).
      const deal = await leadAutomatico(contato.id);
      if (deal) await recalculateScore(deal.id);

      return { waJid, nome: contactName(contato), mensagensNovas };
    } catch (error) {
      // Uma conversa problemática não pode derrubar o lote inteiro.
      console.error(`Falha ao importar ${waJid}`, error);
      return {
        waJid,
        nome: waJid,
        mensagensNovas: 0,
        erro: error instanceof Error ? error.message : "erro desconhecido",
      };
    }
  }

  const totalMensagens = resultados.reduce((s, r) => s + r.mensagensNovas, 0);

  // Cada lote que termina já aparece no funil aberto em outra aba, sem
  // esperar a importação inteira acabar.
  avisarMudanca({ dealIds: [], motivo: "importacao" });

  await prisma.whatsAppAccount.update({
    where: { id: conta.id },
    data: { lastImportAt: new Date() },
  });

  return NextResponse.json({ resultados, totalMensagens });
}
