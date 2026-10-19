/**
 * Cadastro manual de lead (botão "Novo lead" do funil). Puro — testado em
 * tests/cadastro-lead.test.ts.
 */

/** Origens oferecidas no formulário; "Outro" deixa escrever. */
export const ORIGENS = ["Instagram", "Indicação", "Site", "Evento", "WhatsApp", "Ligação", "Facebook", "Google"] as const;

/**
 * O telefone digitado, no formato do WhatsApp: só dígitos, com o 55 do
 * Brasil quando a pessoa não pôs. Aceita "(51) 98540-9366", "51985409366",
 * "+55 51 98540-9366". Número de outro país precisa vir com o "+".
 * Inválido → null.
 */
export function normalizarTelefone(digitado: string): string | null {
  const texto = digitado.trim();
  const digitos = texto.replace(/\D/g, "");
  if (texto.startsWith("+")) return digitos.length >= 10 && digitos.length <= 15 ? digitos : null;
  // Brasil: DDD + 8 ou 9 dígitos, com ou sem o 55 na frente.
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;
  return null;
}

/** E-mail com cara de e-mail (o resto quem confere é quem manda o e-mail). */
export function emailValido(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

/** "R$ 2.500,50", "2500,50", "2.500" → 2500.5. Vazio → null; inválido → NaN. */
export function lerValor(digitado: string): number | null {
  const t = digitado.replace(/[R$\s]/g, "");
  if (!t) return null;
  // Formato brasileiro: ponto separa milhar, vírgula separa centavos.
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/\.(?=\d{3}(\D|$))/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}
