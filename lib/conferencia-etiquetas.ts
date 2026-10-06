import { prisma } from "@/lib/db";
import { isPersonJid } from "@/lib/evolution/parse";
import { aplicarEtiqueta, naFilaDeEtiquetas, removerEtiqueta, type ResultadoEtiqueta } from "@/lib/labels";
import { anotarEtiquetagem } from "@/lib/etiquetagens-recebidas";

/**
 * Conferência das etiquetas: recupera a etiquetagem cujo aviso nunca chegou.
 *
 * Uma etiqueta só move o lead se o aviso da Evolution chegar ao CRM. Ele se
 * perde quando o CRM está reiniciando (toda publicação), quando a Evolution
 * esgota as tentativas de reenvio ou quando o endereço do webhook fica errado.
 * E o que não chegou nunca entra no histórico do CRM — para ele, a etiqueta
 * não existe, e nem o "Atualizar" recupera.
 *
 * Mas a Evolution guarda, para cada conversa, as etiquetas que ela tem agora
 * (coluna `labels` da tabela Chat, atualizada a cada aviso que ELA recebe do
 * WhatsApp). A rota findChats não devolve essa coluna (conferido no código da
 * 2.3.7), e perguntar conversa por conversa seria pesado — então a leitura é
 * direto no banco dela, que é o mesmo Supabase do CRM (esquema
 * evolution_api). Uma consulta só, e SÓ LEITURA: o CRM nunca escreve nas
 * etiquetas do WhatsApp (ver lib/labels.ts).
 *
 * A cada 5 minutos, compara o que a Evolution diz com o histórico do CRM e
 * aplica a diferença pelas regras de sempre (aplicarEtiqueta, origem
 * "conferencia": só para a frente, lead arquivado fica arquivado).
 *
 * Não cobre a falha entre o WhatsApp e a Evolution (ela reinicia sem os
 * arquivos da sessão e para de receber etiquetas): aí o banco dela também
 * fica parado, e só parear de novo resolve.
 */

export type ConversaNaEvolution = { jid: string; etiquetas: string[]; recente: boolean };
export type AcaoDaConferencia = { tipo: "aplicar" | "retirar"; chatId: string; labelId: string };
type Contato = { id: string; waJid: string; lid: string | null };

/**
 * O que corrigir — regra pura, testada em tests/labels.test.ts.
 *
 *   Evolution tem  + histórico "add"         → nada
 *   Evolution tem  + histórico vazio/"remove" → aplica (aviso perdido)
 *   Evolution não tem + histórico "add"       → retira (só a de "ignorar"
 *                                               importa: traz o contato de volta)
 *
 * Só etiquetas que fazem algo no CRM (`acionaveis`). Conversa mexida há pouco
 * (`recente`) fica para a próxima volta: o aviso dela pode estar a caminho.
 */
export function decidirConferencia(entrada: {
  conversas: ConversaNaEvolution[];
  acionaveis: Map<string, { ignorar: boolean }>;
  contatos: Contato[];
  /** Última ação do histórico por `${contactId}:${labelId}`. */
  ultimos: Map<string, string>;
}): AcaoDaConferencia[] {
  const { conversas, acionaveis, contatos, ultimos } = entrada;

  // Contato de cada identificador; o do telefone ganha do que só tem o LID.
  const porJid = new Map<string, Contato>();
  for (const c of contatos) {
    for (const jid of [c.waJid, c.lid]) {
      if (!jid) continue;
      const atual = porJid.get(jid);
      if (!atual || (!atual.waJid.endsWith("@s.whatsapp.net") && c.waJid.endsWith("@s.whatsapp.net"))) porJid.set(jid, c);
    }
  }

  const acoes: AcaoDaConferencia[] = [];
  const feitos = new Set<string>();
  const conversasDoContato = new Map<string, ConversaNaEvolution[]>();

  for (const conversa of conversas) {
    const contato = porJid.get(conversa.jid);
    if (contato) conversasDoContato.set(contato.id, [...(conversasDoContato.get(contato.id) ?? []), conversa]);
    if (conversa.recente) continue;
    for (const labelId of conversa.etiquetas) {
      if (!acionaveis.has(labelId)) continue;
      const chave = `${contato?.id ?? conversa.jid}:${labelId}`;
      if (feitos.has(chave)) continue;
      feitos.add(chave);
      if (contato && ultimos.get(`${contato.id}:${labelId}`) === "add") continue;
      acoes.push({ tipo: "aplicar", chatId: conversa.jid, labelId });
    }
  }

  for (const contato of contatos) {
    const suas = conversasDoContato.get(contato.id) ?? [];
    // Sem a conversa na Evolution, ou mexida agora há pouco: não dá para afirmar que saiu.
    if (suas.length === 0 || suas.some((c) => c.recente)) continue;
    for (const [labelId, { ignorar }] of acionaveis) {
      if (!ignorar || ultimos.get(`${contato.id}:${labelId}`) !== "add") continue;
      if (suas.some((c) => c.etiquetas.includes(labelId))) continue;
      acoes.push({ tipo: "retirar", chatId: contato.waJid, labelId });
    }
  }
  return acoes;
}

/** Ids das etiquetas da coluna `labels` (JSON) — já veio como lista de texto e de número. */
export function idsDasEtiquetas(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((l) => (typeof l === "string" || typeof l === "number" ? String(l) : "")).filter(Boolean);
}

/** Por volta, no máximo: o que sobrar vai na próxima, sem segurar a fila das etiquetas ao vivo. */
const MAX_POR_VOLTA = 40;

async function conferirConta(conta: { id: string; instanceName: string }): Promise<number> {
  const acionaveis = new Map(
    (
      await prisma.whatsAppLabel.findMany({
        where: {
          accountId: conta.id,
          removedAt: null,
          OR: [{ stageId: { not: null } }, { ignoreContact: true }, { isSeller: true }],
        },
        select: { labelId: true, ignoreContact: true },
      })
    ).map((e) => [e.labelId, { ignorar: e.ignoreContact }]),
  );
  if (acionaveis.size === 0) return 0;

  // Conversa mexida há menos de 2 minutos: o aviso dela pode estar a caminho.
  const linhas = await prisma.$queryRaw<{ remoteJid: string; labels: unknown; recente: boolean }[]>`
    SELECT c."remoteJid", c.labels,
           c."updatedAt" > (now() AT TIME ZONE 'UTC') - interval '2 minutes' AS recente
    FROM evolution_api."Chat" c
    JOIN evolution_api."Instance" i ON i.id = c."instanceId"
    WHERE i.name = ${conta.instanceName}
      AND (c."remoteJid" LIKE '%@lid' OR c."remoteJid" LIKE '%@s.whatsapp.net')
  `;
  const conversas = linhas
    .filter((l) => isPersonJid(l.remoteJid))
    .map((l) => ({ jid: l.remoteJid, etiquetas: idsDasEtiquetas(l.labels), recente: Boolean(l.recente) }));
  if (conversas.length === 0) return 0;

  const jids = conversas.map((c) => c.jid);
  const contatos = await prisma.contact.findMany({
    where: { accountId: conta.id, OR: [{ waJid: { in: jids } }, { lid: { in: jids } }] },
    select: { id: true, waJid: true, lid: true },
  });
  const eventos = contatos.length
    ? await prisma.labelEvent.findMany({
        where: { contactId: { in: contatos.map((c) => c.id) }, labelId: { in: [...acionaveis.keys()] } },
        orderBy: { createdAt: "desc" },
        distinct: ["contactId", "labelId"],
        select: { contactId: true, labelId: true, action: true },
      })
    : [];
  const ultimos = new Map(eventos.map((e) => [`${e.contactId}:${e.labelId}`, e.action]));

  const acoes = decidirConferencia({ conversas, acionaveis, contatos, ultimos }).slice(0, MAX_POR_VOLTA);
  let recuperadas = 0;
  for (const acao of acoes) {
    let r: ResultadoEtiqueta;
    try {
      // A mesma fila dos avisos ao vivo: os dois nunca se atropelam.
      r = await naFilaDeEtiquetas(conta.id, () =>
        acao.tipo === "aplicar"
          ? aplicarEtiqueta(conta.id, acao.chatId, acao.labelId, "conferencia")
          : removerEtiqueta(conta.id, acao.chatId, acao.labelId),
      );
    } catch (error) {
      console.warn(`Conferência: etiqueta ${acao.labelId} em ${acao.chatId} —`, (error as Error).message);
      continue;
    }
    if (r.acao === "ignorado" && r.motivo === "o aviso chegou antes da conferência") continue;
    recuperadas++;
    anotarEtiquetagem(conta.id, {
      acao: acao.tipo === "aplicar" ? "add" : "remove",
      contato: r.contato ?? acao.chatId.split("@")[0],
      etiqueta: r.etiqueta ?? `Etiqueta ${acao.labelId}`,
      resultado:
        r.acao === "movido" ? `Moveu para ${r.estagio}` : r.acao === "atendente" ? `Registrou: ${r.atendente} atendeu` : r.motivo,
      moveu: r.acao === "movido",
      recuperada: true,
    });
  }
  return recuperadas;
}

/** O banco da Evolution não está ao alcance (ela foi para outro banco): desliga, sem insistir. */
function semBancoDaEvolution(error: unknown): boolean {
  return /evolution_api|does not exist|42P01|3F000/i.test(String((error as Error)?.message ?? error));
}

const global_ = globalThis as unknown as { crmConferenciaEtiquetas?: { rodando: boolean; desligada: boolean } };
const estado = (global_.crmConferenciaEtiquetas ??= { rodando: false, desligada: false });

/** Rotina do servidor: confere cada número conectado. Nunca roda duas voltas ao mesmo tempo. */
export async function conferirEtiquetas(): Promise<void> {
  if (estado.rodando || estado.desligada) return;
  estado.rodando = true;
  try {
    const contas = await prisma.whatsAppAccount.findMany({
      where: { status: "open" },
      select: { id: true, instanceName: true },
    });
    for (const conta of contas) {
      try {
        const n = await conferirConta(conta);
        if (n) console.log(`Conferência de etiquetas (${conta.instanceName}): ${n} etiquetagem(ns) recuperada(s)`);
      } catch (error) {
        if (semBancoDaEvolution(error)) {
          estado.desligada = true;
          console.warn(
            "Conferência de etiquetas desligada: o CRM não alcança o banco da Evolution (esquema evolution_api). " +
              "As etiquetas continuam chegando pelo aviso do celular.",
          );
          return;
        }
        console.warn(`Conferência de etiquetas de ${conta.instanceName} falhou —`, (error as Error).message);
      }
    }
  } finally {
    estado.rodando = false;
  }
}
