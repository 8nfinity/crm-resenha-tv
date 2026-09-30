/** Períodos oferecidos na tela de métricas. 1 = hoje, desde a meia-noite. */
export const PERIODOS = [1, 7, 15, 30, 90, 365] as const;

export function descreverPeriodo(dias: number): string {
  return dias === 1 ? "Hoje, desde 00:00" : `Últimos ${dias} dias`;
}

/** Rótulo curto de uma janela: "Hoje", "7 dias"... */
export function rotuloJanela(dias: number): string {
  return dias === 1 ? "Hoje" : `${dias} dias`;
}
