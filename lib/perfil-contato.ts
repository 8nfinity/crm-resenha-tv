import { prisma } from "@/lib/db";
import { evolution } from "@/lib/evolution/client";
import { avisarMudanca } from "@/lib/eventos";

/**
 * Nome e foto dos leads que chegam sem eles.
 *
 * O WhatsApp esconde o telefone de muita gente atrás do LID, e o nome só vem
 * nas mensagens que a PESSOA manda. Conversa só com mensagens suas, ou do
 * histórico, vira um card "Sem nome (…2093)". Mas a Evolution costuma saber
 * mais: o nome que está na sua agenda (ou o que a pessoa usa) e a foto, pelo
 * LID ou pelo telefone. Aqui o CRM pergunta a ela — só leitura.
 *
 * O telefone, esse não: se o WhatsApp escondeu, ninguém sabe até a pessoa
 * voltar a conversar (ou você informar no card).
 */

/**
 * Nome que serve para mostrar: o WhatsApp devolve lixo com frequência — "$",
 * o próprio número ou código, endereços.
 */
export function nomeUtilizavel(nome: string | null | undefined, jid?: string): string | null {
  const limpo = nome?.trim();
  if (!limpo || limpo.length < 2) return null;
  if (/^\$+$/.test(limpo) || limpo.includes("@")) return null;
  if (/^[\d\s+()-]+$/.test(limpo)) return null; // só dígitos: é número ou código, não nome
  if (jid && limpo === jid.split("@")[0]) return null;
  return limpo;
}

/**
 * O número que você digitou no card, no formato do WhatsApp:
 * "(51) 98540-9366" → "5551985409366@s.whatsapp.net". Com "+" na frente vale
 * o código do país digitado; sem, entende como Brasil (DDD + número, com ou
 * sem o 55). Null se não parece um telefone.
 */
export function telefoneDigitado(texto: string): string | null {
  const internacional = texto.trim().startsWith("+");
  const digitos = texto.replace(/\D/g, "").replace(/^0+/, "");
  if (internacional) return digitos.length >= 10 && digitos.length <= 15 ? `${digitos}@s.whatsapp.net` : null;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}@s.whatsapp.net`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return `${digitos}@s.whatsapp.net`;
  return null;
}

type ContatoParaCompletar = {
  id: string;
  waJid: string;
  lid: string | null;
  savedName: string | null;
  pushName: string | null;
  profilePicUrl: string | null;
};

/** Pergunta à Evolution nome e foto do que falta. Devolve se completou algo. */
export async function completarPerfil(instanceName: string, c: ContatoParaCompletar): Promise<boolean> {
  const faltaNome = !nomeUtilizavel(c.savedName, c.waJid) && !nomeUtilizavel(c.pushName, c.waJid);
  const faltaFoto = !c.profilePicUrl;
  if (!faltaNome && !faltaFoto) return false;

  const dados: { savedName?: string; profilePicUrl?: string } = {};
  for (const jid of [...new Set([c.waJid, c.lid].filter((j): j is string => Boolean(j)))]) {
    const naEvolution = await evolution.contatoNaEvolution(instanceName, jid).catch(() => null);
    const nome = nomeUtilizavel(naEvolution?.pushName, jid);
    if (faltaNome && !dados.savedName && nome) dados.savedName = nome;
    if (faltaFoto && !dados.profilePicUrl) {
      const foto = naEvolution?.profilePicUrl || (await evolution.fotoDePerfil(instanceName, jid).catch(() => null));
      if (foto) dados.profilePicUrl = foto;
    }
    if ((!faltaNome || dados.savedName) && (!faltaFoto || dados.profilePicUrl)) break;
  }
  if (!dados.savedName && !dados.profilePicUrl) return false;
  await prisma.contact.update({ where: { id: c.id }, data: dados });
  return true;
}

/** Quando cada contato foi conferido (memória do processo): sem nome na Evolution hoje, tenta de novo depois. */
const global_ = globalThis as unknown as { crmPerfisConferidos?: Map<string, number>; crmPerfisRodando?: boolean };
const conferidos = (global_.crmPerfisConferidos ??= new Map<string, number>());
const RECONFERIR_MS = 6 * 60 * 60 * 1000;
const POR_VOLTA = 25;

/**
 * Rotina do servidor: completa nome e foto dos leads ativos que estão sem.
 * Poucos por volta (cada um custa até duas consultas à Evolution) e cada um
 * no máximo a cada 6 h.
 */
export async function completarPerfisDosLeads(): Promise<void> {
  if (global_.crmPerfisRodando) return;
  global_.crmPerfisRodando = true;
  try {
    const contas = await prisma.whatsAppAccount.findMany({
      where: { status: "open" },
      select: { id: true, instanceName: true },
    });
    for (const conta of contas) {
      const candidatos = await prisma.contact.findMany({
        where: {
          accountId: conta.id,
          ignoredAt: null,
          deals: { some: { archivedAt: null } },
          OR: [{ savedName: null }, { profilePicUrl: null }],
        },
        orderBy: { updatedAt: "desc" },
        take: 400,
        select: { id: true, waJid: true, lid: true, savedName: true, pushName: true, profilePicUrl: true },
      });
      const agora = Date.now();
      const pendentes = candidatos
        .filter((c) => {
          const faltaNome = !nomeUtilizavel(c.savedName, c.waJid) && !nomeUtilizavel(c.pushName, c.waJid);
          return (faltaNome || !c.profilePicUrl) && agora - (conferidos.get(c.id) ?? 0) > RECONFERIR_MS;
        })
        .slice(0, POR_VOLTA);

      let completos = 0;
      for (const c of pendentes) {
        conferidos.set(c.id, agora);
        try {
          if (await completarPerfil(conta.instanceName, c)) completos++;
        } catch (error) {
          console.warn(`Perfil de ${c.waJid}:`, (error as Error).message);
        }
      }
      if (conferidos.size > 20_000) conferidos.clear();
      if (completos) {
        console.log(`Perfis: ${completos} lead(s) de ${conta.instanceName} ganharam nome ou foto`);
        avisarMudanca({ dealIds: [], motivo: "mensagem" });
      }
    }
  } finally {
    global_.crmPerfisRodando = false;
  }
}
