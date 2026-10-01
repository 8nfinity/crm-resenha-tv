import webpush from "web-push";
import { prisma } from "@/lib/db";
import { urlPublica } from "@/lib/url-publica";

/**
 * Notificações no aparelho (Web Push): o lembrete aparece no celular ou no
 * computador como notificação de aplicativo, mesmo com o CRM fechado.
 *
 * Ninguém configura nada: as chaves de envio (VAPID) são geradas pelo próprio
 * CRM na primeira vez e ficam no banco. Quem entrega é o serviço de
 * notificação do navegador (Google para Chrome/Edge/Android, Mozilla para
 * Firefox, Apple para iPhone/Mac) — sem conta em serviço de fora.
 */

export type Notificacao = {
  titulo: string;
  corpo: string;
  /** Página que abre ao tocar na notificação. */
  url?: string;
  /** Notificações com a mesma tag se substituem (não empilham repetidas). */
  tag?: string;
};

type Chaves = { publica: string; privada: string };

const global_ = globalThis as unknown as { crmChavesVapid?: Chaves };

/** Chaves de envio: lidas do banco ou, na primeira vez, geradas e guardadas. */
export async function chavesVapid(): Promise<Chaves> {
  if (global_.crmChavesVapid) return global_.crmChavesVapid;

  const ler = () =>
    prisma.systemState.findUnique({
      where: { id: "singleton" },
      select: { vapidPublicKey: true, vapidPrivateKey: true },
    });

  let estado = await ler();
  if (!estado?.vapidPublicKey || !estado.vapidPrivateKey) {
    const novas = webpush.generateVAPIDKeys();
    await prisma.systemState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
    });
    // Só grava se ninguém gravou antes (duas requisições ao mesmo tempo não
    // podem gerar pares diferentes — os aparelhos ficariam com a chave errada).
    await prisma.systemState.updateMany({
      where: { id: "singleton", vapidPublicKey: null },
      data: { vapidPublicKey: novas.publicKey, vapidPrivateKey: novas.privateKey },
    });
    estado = await ler();
  }

  global_.crmChavesVapid = { publica: estado!.vapidPublicKey!, privada: estado!.vapidPrivateKey! };
  return global_.crmChavesVapid;
}

/**
 * Serviços de notificação aceitos. O endereço vem do navegador, mas quem
 * chama é o servidor: sem esta lista, alguém logado poderia cadastrar um
 * endereço interno e fazer o CRM bater nele.
 */
const SERVICOS_DE_PUSH = ["googleapis.com", "mozilla.com", "mozaws.net", "push.apple.com", "notify.windows.com"];

export function endpointPermitido(endpoint: string, extras = process.env.PUSH_HOSTS_EXTRAS): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // PUSH_HOSTS_EXTRAS existe só para os testes automáticos (serviço simulado).
  const aceitos = [...SERVICOS_DE_PUSH, ...(extras ? extras.split(",").map((h) => h.trim()).filter(Boolean) : [])];
  const host = url.hostname.toLowerCase();
  return aceitos.some((d) => host === d || host.endsWith(`.${d}`));
}

/** "Chrome no Windows", "Safari no iPhone" — para a pessoa reconhecer o aparelho. */
export function descreverAparelho(ua: string | null | undefined): string {
  const u = ua ?? "";
  const navegador = /Edg\//.test(u)
    ? "Edge"
    : /OPR\/|Opera/.test(u)
      ? "Opera"
      : /SamsungBrowser/.test(u)
        ? "Samsung Internet"
        : /Firefox\//.test(u)
          ? "Firefox"
          : /Chrome\//.test(u)
            ? "Chrome"
            : /Safari\//.test(u)
              ? "Safari"
              : "Navegador";
  const sistema = /iPhone/.test(u)
    ? "iPhone"
    : /iPad/.test(u)
      ? "iPad"
      : /Android/.test(u)
        ? "Android"
        : /Windows/.test(u)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(u)
            ? "Mac"
            : /Linux/.test(u)
              ? "Linux"
              : "aparelho";
  return `${navegador} no ${sistema}`;
}

/** Quem assina os envios: o endereço público do CRM (ou um e-mail, rodando local). */
function assunto(): string {
  const url = urlPublica();
  return url.startsWith("https://") ? url : "mailto:crm-biomech@example.com";
}

/**
 * Manda a notificação para todos os aparelhos ativados dessas pessoas.
 * Aparelho que o serviço diz não existir mais (desinstalou, limpou o
 * navegador) sai da lista. Devolve quantos aparelhos receberam.
 */
export async function enviarPush(userIds: string[], n: Notificacao): Promise<number> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return 0;

  const aparelhos = await prisma.pushSubscription.findMany({ where: { userId: { in: ids } } });
  if (aparelhos.length === 0) return 0;

  const chaves = await chavesVapid();
  const carga = JSON.stringify({ title: n.titulo, body: n.corpo, url: n.url ?? "/hoje", tag: n.tag });

  const resultados = await Promise.all(
    aparelhos.map(async (a) => {
      try {
        await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, carga, {
          vapidDetails: { subject: assunto(), publicKey: chaves.publica, privateKey: chaves.privada },
          // Lembrete que chega uma hora depois já não serve.
          TTL: 3600,
          urgency: "high",
          timeout: 10_000,
        });
        await prisma.pushSubscription.update({ where: { id: a.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
        return true;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: a.id } }).catch(() => {});
        } else {
          console.warn(`Notificação para ${a.device ?? "aparelho"} não saiu:`, status ?? (error as Error).message);
        }
        return false;
      }
    }),
  );
  return resultados.filter(Boolean).length;
}

/** Alguém tem aparelho ativado? (Sem isso, nem vale procurar o que avisar.) */
export async function temAparelhos(): Promise<boolean> {
  return (await prisma.pushSubscription.count()) > 0;
}
