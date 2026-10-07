import { naFilaDeEtiquetas } from "@/lib/labels";

/**
 * Entrada dos avisos de etiqueta do celular: o webhook responde NA HORA e o
 * aviso entra na fila das etiquetas para ser processado logo em seguida.
 *
 * Por que não esperar terminar para responder: depois de o WhatsApp
 * reconectar, o celular manda de novo as etiquetas de TODAS as conversas
 * (milhares). A fila processa uma de cada vez, e a Evolution só espera 30 s
 * pela resposta — passado isso, ela acha que falhou e manda o mesmo aviso de
 * novo, até 10 vezes. A fila crescia mais rápido do que andava, cada aviso
 * parado segurava memória, e em minutos o CRM caía sem memória (e ao voltar,
 * a enxurrada recomeçava). Foram ~19 mil avisos repetidos num dia.
 *
 * Duas travas, além de responder na hora:
 *   - aviso igual a um que já está na fila (mesma conversa, mesma etiqueta,
 *     mesma ação) é descartado: o da fila já vai fazer exatamente isso;
 *   - fila com mais de LIMITE_NA_FILA avisos não aceita mais nenhum. O que
 *     ficar de fora a conferência periódica recupera (conferencia-etiquetas.ts),
 *     lendo direto do banco da Evolution as etiquetas de cada conversa.
 *
 * A ordem de chegada continua valendo: pôr, tirar e pôr de novo a mesma
 * etiqueta entram os três (só a repetição consecutiva é descartada).
 */

export const LIMITE_NA_FILA = 5_000;

export type Etiquetagem = { accountId: string; tipo: "add" | "remove"; chatId: string; labelId: string };
export type Recebimento = "na-fila" | "repetida" | "fila-cheia";

type Estado = {
  /** Por conversa+etiqueta: a última ação enfileirada e quantas ainda não terminaram. */
  pendentes: Map<string, { tipo: Etiquetagem["tipo"]; n: number }>;
  /** Por conta: quantos avisos ainda não terminaram. */
  total: Map<string, number>;
  /** Contas cuja fila encheu (para avisar no log uma vez só por enxurrada). */
  cheias: Set<string>;
};

const global_ = globalThis as unknown as { crmRecebimentoEtiquetas?: Estado };
const estado = (global_.crmRecebimentoEtiquetas ??= { pendentes: new Map(), total: new Map(), cheias: new Set() });

const chaveDa = (e: Etiquetagem) => `${e.accountId}|${e.chatId}|${e.labelId}`;

/** Quantos avisos de etiqueta desta conta ainda não terminaram. */
export function avisosNaFila(accountId: string): number {
  return estado.total.get(accountId) ?? 0;
}

/**
 * Põe o aviso na fila sem esperar. `tarefa` faz o trabalho e cuida dos
 * próprios resultados; um erro dela vai para o log, nunca para quem chamou.
 * `rodar` é a fila (trocável nos testes).
 */
export function receberEtiquetagem(
  e: Etiquetagem,
  tarefa: () => Promise<void>,
  rodar: (accountId: string, tarefa: () => Promise<void>) => Promise<void> = naFilaDeEtiquetas,
): Recebimento {
  const chave = chaveDa(e);
  const pendente = estado.pendentes.get(chave);
  if (pendente && pendente.n > 0 && pendente.tipo === e.tipo) return "repetida";

  const total = avisosNaFila(e.accountId);
  if (total >= LIMITE_NA_FILA) {
    if (!estado.cheias.has(e.accountId)) {
      estado.cheias.add(e.accountId);
      console.warn(
        `Etiquetas: ${total} avisos na fila — os próximos ficam para a conferência periódica, que lê o estado direto da Evolution.`,
      );
    }
    return "fila-cheia";
  }

  estado.pendentes.set(chave, { tipo: e.tipo, n: (pendente?.n ?? 0) + 1 });
  estado.total.set(e.accountId, total + 1);

  const terminar = () => {
    const p = estado.pendentes.get(chave);
    if (p) {
      p.n -= 1;
      if (p.n <= 0) estado.pendentes.delete(chave);
    }
    const restante = avisosNaFila(e.accountId) - 1;
    if (restante <= 0) {
      estado.total.delete(e.accountId);
      estado.cheias.delete(e.accountId);
    } else {
      estado.total.set(e.accountId, restante);
    }
  };

  void rodar(e.accountId, tarefa)
    .catch((error) =>
      console.warn(`Etiqueta ${e.labelId} em ${e.chatId} (${e.tipo}) —`, (error as Error)?.message ?? error),
    )
    .finally(terminar);
  return "na-fila";
}
