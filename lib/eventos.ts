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
const globalBus = globalThis as unknown as { crmEventos?: EventEmitter };
const bus = globalBus.crmEventos ?? new EventEmitter();
bus.setMaxListeners(100); // uma aba aberta = um ouvinte
globalBus.crmEventos = bus;

export function avisarMudanca(mudanca: Mudanca): void {
  bus.emit("mudou", mudanca);
}

/** Devolve a função que cancela a inscrição. */
export function ouvirMudancas(ouvinte: (m: Mudanca) => void): () => void {
  bus.on("mudou", ouvinte);
  return () => bus.off("mudou", ouvinte);
}
