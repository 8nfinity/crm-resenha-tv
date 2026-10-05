import { prisma } from "@/lib/db";
import { evolution } from "@/lib/evolution/client";
import type { EvolutionMessage } from "@/lib/evolution/types";

/**
 * Quem é a pessoa por trás de um identificador do WhatsApp.
 *
 * A mesma pessoa chega por dois identificadores: o telefone
 * ("55…@s.whatsapp.net") e o LID ("…@lid"). Se o CRM não liga um ao outro,
 * ele cria um contato para cada: o lead DUPLICA, a etiqueta move a cópia e o
 * card que você estava vendo fica parado.
 *
 * Como a Evolution 2.3.7 trata os dois (conferido no código dela):
 *  - grava cada mensagem com o identificador por onde ela chegou em
 *    `key.remoteJid` e o outro em `key.remoteJidAlt`. Só as mensagens que
 *    chegam com a conexão aberta trazem o outro lado; as do histórico (as que
 *    vêm ao parear) não;
 *  - no aviso que manda ao CRM ela TROCA o LID pelo telefone: `remoteJid` e
 *    `remoteJidAlt` chegam iguais, os dois com o telefone. Fica só a pista
 *    `addressingMode: "lid"`. O LID se recupera relendo a mensagem pelo id
 *    (lidEscondidoNoAviso) — era isto que faltava: o lead importado ficava
 *    com o LID, a primeira mensagem nova chegava com o telefone e virava um
 *    segundo lead;
 *  - a busca de mensagens dela só filtra por `remoteJid`: procurar o LID acha
 *    as mensagens que chegaram pelo LID (e nelas o telefone);
 *  - o cache de números dela só liga LID → telefone na conversa que chega
 *    pelo telefone.
 */

/** O outro identificador que uma mensagem revela, dado o que procuramos. */
export function outroIdentificadorDaMensagem(raw: EvolutionMessage, jid: string): string | null {
  const key = raw.key;
  if (!key) return null;
  const candidatos =
    key.remoteJid === jid
      ? [key.remoteJidAlt, key.senderPn]
      : key.remoteJidAlt === jid || key.senderPn === jid
        ? [key.remoteJid]
        : [];
  return candidatos.find((c): c is string => typeof c === "string" && c.length > 0 && c !== jid) ?? null;
}

/**
 * As formas do mesmo celular brasileiro: com e sem o 9 da frente. Contas
 * antigas do WhatsApp mantêm o número sem o 9 ("551187654321"), e o mesmo
 * celular pode aparecer das duas formas. Só para celular (8 dígitos que
 * começam com 6 a 9) — telefone fixo não ganhou o 9.
 */
export function variantesDoTelefone(jid: string): string[] {
  const m = jid.match(/^55(\d{2})(\d{8,9})@s\.whatsapp\.net$/);
  if (!m) return [jid];
  const [, ddd, numero] = m;
  const semNove = numero.length === 9 && numero.startsWith("9") ? numero.slice(1) : numero.length === 8 ? numero : null;
  if (!semNove || !/^[6-9]/.test(semNove)) return [jid];
  return [`55${ddd}9${semNove}@s.whatsapp.net`, `55${ddd}${semNove}@s.whatsapp.net`];
}

const ehLid = (j: unknown): j is string => typeof j === "string" && j.endsWith("@lid");
const ehTelefone = (j: unknown): j is string => typeof j === "string" && j.endsWith("@s.whatsapp.net");

/**
 * O aviso de mensagem veio com o LID trocado pelo telefone?
 *
 * É o caso de quem escreve pelo LID: a Evolution põe o telefone nos dois
 * campos (`remoteJid` igual a `remoteJidAlt`) e deixa `addressingMode: "lid"`.
 * Se o aviso já mostra o LID, ou se a conversa é mesmo pelo telefone, não há
 * nada escondido.
 */
export function avisoEscondeOLid(raw: EvolutionMessage): boolean {
  const k = raw.key;
  const jid = k?.remoteJid;
  const alt = k?.remoteJidAlt ?? null;
  if (!ehTelefone(jid)) return false;
  if ([alt, k?.senderPn].some(ehLid)) return false;
  return alt === jid || k?.addressingMode === "lid";
}

/**
 * O LID que o aviso escondeu, lido da mensagem como a Evolution a gravou.
 *
 * Só vale se a mensagem gravada for da MESMA conversa — o telefone dela tem
 * que bater com o do aviso. Um id repetido em outra conversa juntaria duas
 * pessoas diferentes, que é pior que um duplicado.
 */
export async function lidEscondidoNoAviso(instanceName: string, raw: EvolutionMessage): Promise<string | null> {
  const id = raw.key?.id;
  const telefone = raw.key?.remoteJid;
  if (!id || !ehTelefone(telefone)) return null;
  try {
    const gravada = await evolution.mensagemPorId(instanceName, id);
    const lados = [gravada?.key?.remoteJid, gravada?.key?.remoteJidAlt];
    const lid = lados.find(ehLid);
    const fone = lados.find(ehTelefone);
    if (!lid || !fone || !variantesDoTelefone(telefone).includes(fone)) return null;
    return lid;
  } catch (error) {
    // Sem a Evolution agora: a varredura de cada minuto liga os dois depois.
    console.warn(`LID da mensagem ${id}:`, (error as Error).message);
    return null;
  }
}

/**
 * O arquivo da foto de perfil, sem o servidor e sem a assinatura temporária
 * ("?oh=…&oe=…"): "/v/t61.24694-24/7612…_n.jpg". O WhatsApp devolve o MESMO
 * arquivo pelo telefone e pelo LID da mesma pessoa (conferido em contatos
 * reais em 05/10/2026), e cada foto enviada ganha um arquivo próprio.
 */
export function arquivoDaFoto(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const caminho = new URL(url).pathname;
    return /\.(jpe?g|png|webp)$/i.test(caminho) ? caminho : null;
  } catch {
    return null;
  }
}

/** Quantos leads, no máximo, ganham uma consulta de foto por vez. */
const MAX_CONSULTAS_DE_FOTO = 12;

/**
 * O lead do telefone dono de um LID que nada mais liga a um telefone — pela
 * foto de perfil.
 *
 * Caso real (Helena, 05/10/2026): a conversa veio do histórico pelo
 * TELEFONE, e a etiqueta chegou pelo LID. Nem as mensagens nem o cache da
 * Evolution ligam os dois, e o CRM criava um segundo card. Os candidatos são
 * os leads do telefone que ainda não têm o LID guardado — poucos, porque
 * quase toda conversa já vem pelo LID. Só vale se UM candidato tiver
 * exatamente a mesma foto; sem foto (ou escondida pela privacidade), null.
 */
export async function pessoaPelaFoto(
  conta: { id: string; instanceName: string },
  lid: string,
): Promise<{ id: string; waJid: string } | null> {
  const candidatos = (
    await prisma.contact.findMany({
      where: { accountId: conta.id, waJid: { endsWith: "@s.whatsapp.net" }, lid: null, ignoredAt: null, deals: { some: {} } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, waJid: true, profilePicUrl: true },
    })
  ).filter((c) => !c.waJid.startsWith("0@"));
  if (candidatos.length === 0) return null;

  const daFoto = arquivoDaFoto(await evolution.fotoDePerfil(conta.instanceName, lid).catch(() => null));
  if (!daFoto) return null;

  // Primeiro pelas fotos já guardadas, sem perguntar nada ao WhatsApp.
  const pelaGuardada = candidatos.filter((c) => arquivoDaFoto(c.profilePicUrl) === daFoto);
  if (pelaGuardada.length > 0) return pelaGuardada.length === 1 ? pelaGuardada[0] : null;

  // Depois, a foto atual de cada um (a guardada pode ser antiga ou faltar).
  const iguais: { id: string; waJid: string }[] = [];
  for (const c of candidatos.slice(0, MAX_CONSULTAS_DE_FOTO)) {
    const url = await evolution.fotoDePerfil(conta.instanceName, c.waJid).catch(() => null);
    if (url && url !== c.profilePicUrl) {
      await prisma.contact.update({ where: { id: c.id }, data: { profilePicUrl: url } }).catch(() => {});
    }
    if (arquivoDaFoto(url) === daFoto) iguais.push(c);
  }
  return iguais.length === 1 ? iguais[0] : null;
}

/**
 * O telefone na forma que o CRM já usa (com ou sem o 9), se ele já conhece
 * esse celular — para não criar um segundo contato do mesmo número.
 */
export async function formaConhecidaDoTelefone(accountId: string, pnJid: string): Promise<string> {
  const variantes = variantesDoTelefone(pnJid);
  if (variantes.length === 1) return pnJid;
  const existente = await prisma.contact.findFirst({
    where: { accountId, waJid: { in: variantes } },
    select: { waJid: true },
  });
  return existente?.waJid ?? pnJid;
}

/**
 * O outro identificador (telefone ↔ LID) e o nome da pessoa, perguntando à
 * Evolution. Vazio se ela não souber ou não responder — nunca chuta.
 *
 * `rapido`: uma tentativa e pouca espera, para quem está numa fila (a das
 * etiquetas) e não pode segurar as próximas.
 */
export async function descobrirPessoa(
  instanceName: string,
  jid: string,
  opcoes: { rapido?: boolean } = {},
): Promise<{ alt: string | null; pushName: string | null }> {
  let alt: string | null = null;
  let pushName: string | null = null;

  // 1. As mensagens da conversa: as que chegaram com a conexão aberta trazem
  //    o outro identificador. Também trazem o nome que a pessoa usa.
  try {
    const mensagens = await evolution.findMessages(instanceName, jid, 10, { rapido: opcoes.rapido });
    alt = mensagens.map((m) => outroIdentificadorDaMensagem(m, jid)).find(Boolean) ?? null;
    // O nome vem de uma mensagem DELA (a sua traria o seu próprio nome).
    pushName = mensagens.find((m) => m.key?.fromMe === false && m.pushName)?.pushName ?? null;
  } catch {
    // Sem as mensagens, tenta o cache.
  }

  // 2. LID → telefone pelo cache de números: só conhece a conversa que chega
  //    pelo telefone com o LID ao lado.
  if (!alt && jid.endsWith("@lid")) {
    alt = await evolution.telefoneDoLid(instanceName, jid).catch(() => null);
  }

  return { alt, pushName };
}
