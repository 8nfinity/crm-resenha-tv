import { EventEmitter } from "node:events";

/**
 * Avisos de "algo mudou" entre o webhook e as telas abertas.
 *
 * O webhook grava a mensagem no banco e publica aqui; a rota /api/eventos
 * repassa o aviso para cada navegador conectado, que recarrega os dados da
 * tela. Assim uma mensagem nova aparece no funil sem ninguém apertar F5.
 *
 * O canal vive na memória do processo — o que funciona porque o CRM roda
 * como um servidor só. Numa hospedagem com várias instâncias (serverless), o
 * aviso só chegaria a quem estivesse na mesma instância; por isso a tela
 * também recarrega ao voltar o foco, como rede de segurança.
 */

export type Mudanca = {
  /** Deals afetados. Vazio quando a mudança é ampla (ex.: importação). */
  dealIds: string[];
  motivo: "mensagem" | "etiqueta" | "importacao" | "atividade" | "funil" | "playbook" | "conexao";
};

// Um emissor por processo, mesmo que o Next carregue este módulo mais de uma
// vez (um por pacote de rota): sem isso, o webhook publicaria num emissor e a
// rota de eventos escutaria outro.
const globalBus = globalThis as unknown as { crmEventos?: EventEmitter; crmEventosJanela?: Janela };
const bus = globalBus.crmEventos ?? new EventEmitter();
bus.setMaxListeners(100); // uma aba aberta = um ouvinte
globalBus.crmEventos = bus;

/**
 * No máximo um aviso por segundo de cada tipo. Numa enxurrada (o celular
 * reenviando as etiquetas de todas as conversas ao reconectar), cada aviso
 * fazia cada aba aberta remontar o funil inteiro — centenas de vezes por
 * minuto. O primeiro sai na hora; os que chegam dentro do segundo seguinte
 * viram um só, no fim dele, com todos os leads afetados.
 */
const JANELA_MS = 1000;
type Janela = { ultimo: Map<Mudanca["motivo"], number>; pendente: Map<Mudanca["motivo"], Mudanca>; timers: Set<Mudanca["motivo"]> };
const janela = (globalBus.crmEventosJanela ??= { ultimo: new Map(), pendente: new Map(), timers: new Set() });

/** Dois avisos do mesmo tipo viram um: aviso amplo (sem leads) engole o específico. */
function juntar(a: Mudanca | undefined, b: Mudanca): Mudanca {
  if (!a) return b;
  if (a.dealIds.length === 0 || b.dealIds.length === 0) return { motivo: b.motivo, dealIds: [] };
  return { motivo: b.motivo, dealIds: [...new Set([...a.dealIds, ...b.dealIds])] };
}

export function avisarMudanca(mudanca: Mudanca): void {
  const { motivo } = mudanca;
  const agora = Date.now();
  const desde = agora - (janela.ultimo.get(motivo) ?? 0);
  if (!janela.timers.has(motivo) && desde >= JANELA_MS) {
    janela.ultimo.set(motivo, agora);
    bus.emit("mudou", mudanca);
    return;
  }
  janela.pendente.set(motivo, juntar(janela.pendente.get(motivo), mudanca));
  if (janela.timers.has(motivo)) return;
  janela.timers.add(motivo);
  setTimeout(() => {
    janela.timers.delete(motivo);
    const pendente = janela.pendente.get(motivo);
    janela.pendente.delete(motivo);
    if (!pendente) return;
    janela.ultimo.set(motivo, Date.now());
    bus.emit("mudou", pendente);
  }, JANELA_MS - desde).unref?.();
}

/** Devolve a função que cancela a inscrição. */
export function ouvirMudancas(ouvinte: (m: Mudanca) => void): () => void {
  bus.on("mudou", ouvinte);
  return () => bus.off("mudou", ouvinte);
}
