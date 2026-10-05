/**
 * Juntar à mão dois cards da mesma pessoa — regra pura, testada em
 * tests/identidade-contato.test.ts.
 */

type Lado = { dealId: string; waJid: string; mensagens: number };

/**
 * Qual dos dois cards fica.
 *
 * Fica o do TELEFONE: é ele que mostra o número e que recebe as mensagens
 * novas (o aviso da Evolution chega pelo telefone). Entre dois do mesmo tipo,
 * o que tem mais conversa; empatados, o que você abriu.
 *
 * O estágio não depende disto: na junção vale o de quem andou por último no
 * funil (ver copiaDecideOEstagio) — o card que a etiqueta moveu não volta.
 */
export function qualFica(aberto: Lado, outro: Lado): string {
  const doTelefone = (l: Lado) => l.waJid.endsWith("@s.whatsapp.net");
  if (doTelefone(aberto) !== doTelefone(outro)) return doTelefone(aberto) ? aberto.dealId : outro.dealId;
  if (aberto.mensagens !== outro.mensagens) return aberto.mensagens > outro.mensagens ? aberto.dealId : outro.dealId;
  return aberto.dealId;
}
