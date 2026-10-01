/**
 * Quem pode o quê. Regras puras, sem banco — testadas em tests/papeis.test.ts.
 *
 *   MASTER   o dono do CRM. Gerencia administradores e vendedores. Ninguém
 *            além dele mesmo mexe na conta dele.
 *   ADMIN    configura o CRM (WhatsApp, colunas, campos, playbook) e
 *            gerencia VENDEDORES.
 *   VENDEDOR trabalha os leads: conversa, move no funil, anota, agenda.
 */

export type Papel = "MASTER" | "ADMIN" | "VENDEDOR";

export const NOME_PAPEL: Record<Papel, string> = {
  MASTER: "Master",
  ADMIN: "Administrador",
  VENDEDOR: "Vendedor",
};

const NIVEL: Record<Papel, number> = { MASTER: 3, ADMIN: 2, VENDEDOR: 1 };

/** Configura o CRM: conexões do WhatsApp, colunas, campos, playbook, segredos. */
export function ehAdministrador(papel: Papel | null | undefined): boolean {
  return papel === "MASTER" || papel === "ADMIN";
}

/** Papéis que este ator pode dar a alguém (ao criar ou alterar). */
export function papeisQuePodeAtribuir(ator: Papel): Papel[] {
  if (ator === "MASTER") return ["MASTER", "ADMIN", "VENDEDOR"];
  if (ator === "ADMIN") return ["VENDEDOR"];
  return [];
}

/**
 * Pode alterar (nome, papel, senha, ativo) a conta `alvo`?
 *
 * Só quem está ACIMA do alvo — e o master pode tudo, inclusive em outros
 * masters. Ninguém altera a própria conta por aqui: a própria senha se troca
 * em "Minha conta", com a senha atual; o próprio papel não se muda.
 */
export function podeAlterar(ator: { id: string; papel: Papel }, alvo: { id: string; papel: Papel }): boolean {
  if (ator.id === alvo.id) return false;
  if (ator.papel === "MASTER") return true;
  return NIVEL[ator.papel] > NIVEL[alvo.papel];
}
