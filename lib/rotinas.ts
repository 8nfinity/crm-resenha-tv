import { prisma } from "@/lib/db";
import { recalculateAllScores } from "@/lib/deals";
import { evolution } from "@/lib/evolution/client";
import { estaHospedado, urlDoWebhook } from "@/lib/url-publica";
import { varrerTudo } from "@/lib/sincronizacao";
import { emailConfigurado } from "@/lib/email";
import { enviarLembretes, enviarResumoDiario } from "@/lib/avisos";

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
  void criarAdministradorInicial();

  if (process.env.EVOLUTION_API_URL) {
    // Varredura de segurança: a primeira logo depois de subir (recupera o que
    // chegou enquanto o CRM estava fora do ar), depois a cada minuto.
    setTimeout(() => void varrerTudo().catch(() => {}), 20_000).unref();
    setInterval(() => void varrerTudo().catch(() => {}), INTERVALO_VARREDURA_MS).unref();
  }

  if (emailConfigurado()) {
    // Avisos de atividades: confere a cada minuto se há lembrete a mandar e
    // se chegou a hora do resumo do dia.
    setInterval(() => void conferirAvisos(), INTERVALO_AVISOS_MS).unref();
    setTimeout(() => void conferirAvisos(), 30_000).unref();
  } else {
    console.log("Avisos por e-mail desligados: defina RESEND_API_KEY e EMAIL_REMETENTE para ligar.");
  }

  if (estaHospedado()) {
    // Espera o servidor terminar de subir antes de falar com a Evolution, e
    // depois confere de tempos em tempos: se a Evolution for reinstalada ou
    // alguém mexer no painel dela, o webhook volta a apontar para cá sozinho.
    setTimeout(() => void apontarWebhooks(), 15_000).unref();
    setInterval(() => void apontarWebhooks(), INTERVALO_WEBHOOK_MS).unref();
  }
}

/** A cada minuto: atraso máximo de uma mensagem quando o webhook falhar. */
const INTERVALO_VARREDURA_MS = 60_000;
const INTERVALO_WEBHOOK_MS = 10 * 60_000;
const INTERVALO_AVISOS_MS = 60_000;

async function conferirAvisos() {
  try {
    const lembretes = await enviarLembretes();
    if (lembretes) console.log(`Avisos: ${lembretes} lembrete(s) por e-mail enviados`);
    const resumos = await enviarResumoDiario();
    if (resumos) console.log(`Avisos: resumo do dia enviado para ${resumos} pessoa(s)`);
  } catch (error) {
    console.warn("Avisos por e-mail falharam:", (error as Error).message);
  }
}

/**
 * Primeiro administrador a partir das variáveis ADMIN_EMAIL, ADMIN_NOME e
 * ADMIN_SENHA — o caminho para quem só tem o painel da Railway, sem terminal.
 *
 * Só age com o banco SEM nenhum usuário. Depois que existe alguém, as
 * variáveis são ignoradas: deixá-las lá não permite tomar conta do CRM nem
 * resetar a senha de ninguém. Ainda assim, apague-as depois do primeiro login.
 */
async function criarAdministradorInicial() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const senha = process.env.ADMIN_SENHA;
  if (!email || !senha) return;

  try {
    if ((await prisma.user.count()) > 0) return;
    const { gerarHash, senhaFraca } = await import("@/lib/auth/senha");
    const fraca = senhaFraca(senha);
    if (fraca) {
      console.warn(`ADMIN_SENHA recusada: ${fraca}`);
      return;
    }
    await prisma.user.create({
      data: {
        email,
        name: process.env.ADMIN_NOME?.trim() || "Administrador",
        // O primeiro acesso é o dono do CRM.
        role: "MASTER",
        passwordHash: await gerarHash(senha),
      },
    });
    console.log(`Administrador inicial criado: ${email}. Apague ADMIN_SENHA das variáveis.`);
  } catch (error) {
    console.warn("Não deu para criar o administrador inicial:", (error as Error).message);
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
        // Só reconfigura se estiver errado: na conferência periódica, o
        // normal é já estar certo.
        const atual = await evolution.findWebhook(instanceName).catch(() => null);
        if (atual?.enabled && atual.url === url) continue;
        await evolution.setWebhook(instanceName, url, segredo);
        console.log(`Webhook de ${instanceName} → ${url}${atual ? ` (estava em ${atual.url})` : ""}`);
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
