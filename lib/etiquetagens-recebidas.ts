/**
 * As últimas etiquetagens que chegaram do celular e o que o CRM fez com cada
 * uma — a tela de etiquetas mostra, para você conferir na hora:
 *
 *   - etiquetou e apareceu aqui com "Moveu para X": funcionou;
 *   - apareceu, mas com outro resultado: o motivo está escrito;
 *   - não apareceu nada: o aviso nem chegou ao CRM (o WhatsApp não mandou
 *     para a Evolution — ela reiniciou sem o volume da sessão — ou a Evolution
 *     não repassou).
 *
 * Fica na memória do processo (o CRM roda como um servidor só) e recomeça a
 * cada publicação: é um painel de conferência, não um histórico. O histórico
 * de verdade de cada lead fica no LabelEvent.
 */

export type Etiquetagem = {
  quando: string;
  acao: "add" | "remove";
  contato: string;
  etiqueta: string;
  resultado: string;
  /** O lead andou no funil (ou entrou nele). */
  moveu: boolean;
};

const LIMITE = 25;

const global_ = globalThis as unknown as { crmEtiquetagens?: Map<string, Etiquetagem[]> };
const porConta = (global_.crmEtiquetagens ??= new Map<string, Etiquetagem[]>());

export function anotarEtiquetagem(accountId: string, e: Omit<Etiquetagem, "quando">) {
  const lista = porConta.get(accountId) ?? [];
  lista.unshift({ ...e, quando: new Date().toISOString() });
  porConta.set(accountId, lista.slice(0, LIMITE));
}

export function etiquetagensRecentes(accountId: string): Etiquetagem[] {
  return porConta.get(accountId) ?? [];
}
