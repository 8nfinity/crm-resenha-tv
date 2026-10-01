/**
 * PDFs do playbook: conferência do arquivo e extração do texto.
 *
 * O texto extraído serve para a busca do playbook achar o que está DENTRO do
 * PDF ("objeção de preço" acha a página certa do material), não só o nome.
 */

/** 25 MB: um playbook com fotos cabe com folga; um vídeo exportado em PDF, não. */
export const LIMITE_PDF = 25 * 1024 * 1024;

/** Limite do texto guardado para a busca — sobra para centenas de páginas. */
const LIMITE_TEXTO = 500_000;

/**
 * É mesmo um PDF? Confere a assinatura "%PDF-" no começo do arquivo (a norma
 * aceita até 1 KB de lixo antes dela). O tipo informado pelo navegador não
 * vale: é só o que a extensão do arquivo sugere.
 */
export function ehPdf(bytes: Uint8Array): boolean {
  const inicio = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return inicio.includes("%PDF-");
}

/** Nome de arquivo apresentável: sem pasta, sem caracteres de controle, terminando em .pdf. */
export function nomeDoArquivo(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const limpo = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 150);
  const nome = limpo || "playbook.pdf";
  return /\.pdf$/i.test(nome) ? nome : `${nome}.pdf`;
}

/**
 * Texto do PDF, página por página. PDF só de imagem (digitalizado) não tem
 * texto — devolve vazio, e o documento continua legível, só não aparece na
 * busca pelo conteúdo.
 */
export async function extrairTexto(bytes: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    // Cópia: o leitor de PDF pode tomar posse do buffer original.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const limpo = text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
    return limpo ? limpo.slice(0, LIMITE_TEXTO) : null;
  } catch (error) {
    console.warn("Não consegui ler o texto do PDF:", (error as Error).message);
    return null;
  }
}

/** Content-Disposition com nome acentuado funcionando em todo navegador (RFC 5987). */
export function disposicao(tipo: "inline" | "attachment", nome: string): string {
  const ascii = nome.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "playbook.pdf";
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}
