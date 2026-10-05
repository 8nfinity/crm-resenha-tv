/**
 * Linha do tempo da conexão — regras puras, usadas no servidor e na tela.
 *
 * As etiquetas e listas chegam por um canal separado das mensagens (os "dados
 * da conta" do WhatsApp), trancado por uma chave que o celular entrega ao
 * parear. A Evolution 2.3 guarda o login no BANCO, mas essa chave em ARQUIVO,
 * em /evolution/instances: se ela reinicia sem um volume ali, a conexão
 * continua de pé e as mensagens chegam, mas nenhuma etiqueta chega mais — só
 * volta pareando o número de novo. A linha do tempo mostra as reconexões, que
 * é onde isso aparece.
 *
 * O CRM já conferiu essa chave à força, retirando uma etiqueta inexistente de
 * uma conversa. Isso ESCREVE nos dados da conta do WhatsApp e foi o que fez as
 * etiquetas pararem de chegar minutos depois de conectar — saiu. Os tipos
 * "chave_*" abaixo ficam só para as linhas antigas da linha do tempo.
 */

export const MINUTO = 60_000;

/** Frase de cada linha da linha do tempo da conexão. */
export function descreverEvento(kind: string): string {
  switch (kind) {
    case "qr":
      return "QR Code gerado para conectar o número";
    case "open":
      return "WhatsApp conectou (ou reconectou)";
    case "close":
      return "WhatsApp desconectou";
    case "chave_ok":
      return "Chave das etiquetas OK";
    case "chave_perdida":
      return "Chave das etiquetas perdida — a Evolution voltou sem os arquivos da sessão";
    case "sem_chave":
      return "O WhatsApp ainda não enviou a chave das etiquetas";
    case "desconectado":
      return "O WhatsApp estava desconectado dentro da Evolution";
    case "fora_do_ar":
      return "A Evolution não respondeu";
    default:
      return "A verificação das etiquetas falhou";
  }
}
