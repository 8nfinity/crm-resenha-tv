/**
 * Nomes de etiquetas e listas do WhatsApp — regras puras, usadas no servidor
 * e na tela.
 *
 * Para o WhatsApp, LISTA e ETIQUETA são a mesma coisa por dentro: a lista
 * "Follow up" chega igual a uma etiqueta do Business, e colocar a conversa
 * na lista dispara o mesmo evento. O CRM trata as duas do mesmo jeito.
 */

function normalizar(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Listas automáticas do WhatsApp: ele mesmo decide quem aparece nelas (quem
 * não leu, os grupos, as comunidades). Ninguém coloca uma conversa ali, então
 * ligá-las a um estágio nunca faria nada — a tela esconde.
 */
const FILTROS_AUTOMATICOS = new Set(["nao lidas", "no lidas", "unread", "grupos", "groups", "comunidades", "communities"]);

export function ehFiltroAutomatico(nome: string): boolean {
  return FILTROS_AUTOMATICOS.has(normalizar(nome));
}

/** O WhatsApp manda "Não lidas" sem o "ã" ("No lidas"): devolve o nome certo. */
export function corrigirNomeEtiqueta(nome: string): string {
  return normalizar(nome) === "no lidas" ? "Não lidas" : nome;
}
