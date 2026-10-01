import { prisma } from "@/lib/db";
import { recalculateAllScores } from "@/lib/deals";
import { evolution } from "@/lib/evolution/client";
import { estaHospedado, urlDoWebhook } from "@/lib/url-publica";

/**
 * Rotinas que o próprio servidor executa — sem depender de cron externo.
 *
 * Na Railway o CRM é um processo que fica de pé o dia inteiro, então agendar
 * aqui dentro é o caminho mais simples. (Na Vercel, cada requisição é uma
 * função que morre logo; lá o agendamento ficava no vercel.json.)
 */

/** Hora local (fuso do servidor, Brasília) do recálculo diário de scores. */
const HORA_DO_RECALCULO = 6;

let iniciado = false;

export function iniciarRotinasDoServidor() {
  // O Next pode carregar a instrumentação mais de uma vez; as rotinas, não.
  if (iniciado) return;
  iniciado = true;

  agendarRecalculoDiario();

  if (estaHospedado()) {
    // Espera o servidor terminar de subir antes de falar com a Evolution.
    setTimeout(() => void apontarWebhooks(), 15_000).unref();
  }
}

/**
 * Recalcula todos os scores uma vez por dia.
 *
 * A passagem do tempo esfria um lead mesmo sem mensagem nova ("respondeu há
 * 6 dias" vira "há 7" amanhã). O webhook só recalcula quem mandou mensagem.
 */
function agendarRecalculoDiario() {
  const proxima = new Date();
  proxima.setHours(HORA_DO_RECALCULO, 0, 0, 0);
  if (proxima <= new Date()) proxima.setDate(proxima.getDate() + 1);

  setTimeout(async () => {
    try {
      const total = await recalculateAllScores();
      console.log(`Recálculo diário: ${total} scores atualizados`);
    } catch (error) {
      console.error("Recálculo diário falhou", error);
    }
    agendarRecalculoDiario();
  }, proxima.getTime() - Date.now()).unref();
}

/**
 * Aponta o webhook de cada conta para o endereço deste servidor.
 *
 * É o que faz a mudança para a hospedagem funcionar sem refazer o QR Code:
 * as instâncias já pareadas continuavam mandando eventos para o endereço
 * antigo (o localhost da máquina). Idempotente — se já estiver certo, nada muda.
 */
async function apontarWebhooks() {
  const segredo = process.env.WEBHOOK_SECRET;
  if (!segredo || !process.env.EVOLUTION_API_URL) return;

  const url = urlDoWebhook();
  try {
    const contas = await prisma.whatsAppAccount.findMany({ select: { instanceName: true } });
    for (const { instanceName } of contas) {
      try {
        await evolution.setWebhook(instanceName, url, segredo);
        console.log(`Webhook de ${instanceName} → ${url}`);
      } catch (error) {
        // Instância que ainda não existe na Evolution nova: é configurada ao
        // gerar o QR Code em Conexão.
        console.warn(`Webhook de ${instanceName} não configurado:`, (error as Error).message);
      }
    }
  } catch (error) {
    console.warn("Não deu para apontar os webhooks:", (error as Error).message);
  }
}
