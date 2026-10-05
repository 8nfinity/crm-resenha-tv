/**
 * Filas na memória do processo: tarefas com a mesma chave rodam uma de cada
 * vez, na ordem em que chegaram.
 *
 * Existe por causa da etiquetagem em massa: selecionar 50 conversas e pôr a
 * mesma etiqueta faz o celular mandar 50 avisos de uma vez. Processados todos
 * juntos, eles disputavam as poucas conexões com o banco — parte estourava o
 * tempo de espera e só entrava minutos depois, no reenvio da Evolution. Em
 * fila, cada um leva uma fração de segundo e todos entram, na ordem certa
 * (pôr e tirar a etiqueta logo em seguida não se inverte).
 *
 * O CRM roda como um servidor só, então uma fila na memória basta.
 */

const global_ = globalThis as unknown as { crmFilas?: Map<string, Promise<unknown>> };
const filas = (global_.crmFilas ??= new Map<string, Promise<unknown>>());

export function emFila<T>(chave: string, tarefa: () => Promise<T>): Promise<T> {
  const anterior = filas.get(chave) ?? Promise.resolve();
  const atual = anterior.then(tarefa);
  // A cauda nunca falha: o erro de uma tarefa é de quem a pediu, não da fila.
  const cauda = atual.catch(() => {});
  filas.set(chave, cauda);
  void cauda.then(() => {
    if (filas.get(chave) === cauda) filas.delete(chave);
  });
  return atual;
}
