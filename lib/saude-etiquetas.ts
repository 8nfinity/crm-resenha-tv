/**
 * Saúde das etiquetas — regras puras, usadas no servidor e na tela.
 *
 * As etiquetas e listas chegam por um canal separado das mensagens (os "dados
 * da conta" do WhatsApp), trancado por uma chave que o celular entrega ao
 * parear. A Evolution 2.3 guarda o login no BANCO, mas essa chave em ARQUIVO,
 * em /evolution/instances. Se ela reinicia sem um volume ali:
 *
 *   - a conexão continua "conectada" (o login estava no banco);
 *   - as mensagens continuam chegando;
 *   - mas nenhuma etiqueta, lista ou exclusão chega mais — nem à Evolution,
 *     nem ao CRM. Só volta pareando o número de novo.
 *
 * Por isso o problema parece "aleatório": tudo funciona até o próximo
 * reinício da Evolution. O CRM confere essa chave de tempos em tempos e
 * depois de cada reconexão, e mostra o resultado na tela de etiquetas.
 */

export type EstadoChave = "ok" | "chave_perdida" | "sem_chave" | "fora_do_ar" | "erro";

export const MINUTO = 60_000;
/** Conferência de rotina: a chave quase nunca muda sozinha. */
const ROTINA_MS = 6 * 60 * MINUTO;
/** Estados que costumam se resolver sozinhos (o WhatsApp manda a chave, a Evolution volta). */
const NOVA_TENTATIVA_MS = 10 * MINUTO;
/** Depois de uma reconexão: espera a sessão assentar e não confere mais que isso. */
const ESPERA_RECONEXAO_MS = MINUTO;
const INTERVALO_MINIMO_MS = 30 * MINUTO;

/**
 * Hora de conferir a chave de novo?
 *
 * `ultimaAbertura` é a última vez que o WhatsApp (re)conectou. Uma reconexão
 * depois da última conferência é justamente quando a chave pode ter sumido —
 * a Evolution reiniciou.
 */
export function precisaVerificar(
  conta: { labelKeyStatus: string | null; labelKeyCheckedAt: Date | null },
  ultimaAbertura: Date | null,
  agora: Date = new Date(),
): boolean {
  if (!conta.labelKeyCheckedAt) return true;
  const desde = agora.getTime() - conta.labelKeyCheckedAt.getTime();

  if (
    ultimaAbertura &&
    ultimaAbertura > conta.labelKeyCheckedAt &&
    agora.getTime() - ultimaAbertura.getTime() >= ESPERA_RECONEXAO_MS &&
    desde >= INTERVALO_MINIMO_MS
  ) {
    return true;
  }

  const passageiro = conta.labelKeyStatus === "sem_chave" || conta.labelKeyStatus === "fora_do_ar" || conta.labelKeyStatus === "erro";
  if (passageiro && desde >= NOVA_TENTATIVA_MS) return true;

  return desde >= ROTINA_MS;
}

/**
 * Traduz a resposta da leitura forçada em estado + frase para a tela.
 *
 * `status` e `corpo` vêm do erro da Evolution; `mensagem` é a do cliente.
 */
export function classificarFalha(mensagem: string, status: number | null, corpo: string): { estado: EstadoChave; texto: string } {
  const detalhe = `${mensagem} ${corpo}`;

  // A conexão sabe QUAL chave abre os dados da conta, mas o arquivo dela
  // sumiu: a Evolution reiniciou sem volume em /evolution/instances.
  if (/myAppStateKey .*not present/i.test(detalhe)) {
    return {
      estado: "chave_perdida",
      texto:
        "A Evolution perdeu a chave que abre as etiquetas e listas: ela reiniciou e os arquivos da sessão não " +
        "foram guardados. Enquanto isso, etiquetar ou apagar uma lista no celular não chega ao CRM. Confira o " +
        "volume da Evolution na Railway (montado em /evolution/instances) e conecte o número de novo — a " +
        "chave volta no pareamento.",
    };
  }
  if (/app state key not present/i.test(detalhe)) {
    return {
      estado: "sem_chave",
      texto:
        "O WhatsApp ainda não enviou a chave das etiquetas para esta conexão. Costuma chegar alguns minutos " +
        "depois de conectar; o CRM confere de novo sozinho. Se continuar por mais de uma hora, conecte o número de novo.",
    };
  }
  // Sem resposta da Evolution (ou a página de erro da hospedagem no lugar dela).
  const respostaDaApi = corpo.trim().startsWith("{") || corpo.trim().startsWith("[");
  if (status !== null && status >= 500 && !respostaDaApi) {
    return { estado: "fora_do_ar", texto: mensagem.trim().slice(0, 300) };
  }
  return { estado: "erro", texto: `A leitura das etiquetas falhou: ${detalhe.trim().slice(0, 300)}` };
}

/** Frase de cada linha da linha do tempo da conexão. */
export function descreverEvento(kind: string): string {
  switch (kind) {
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
    case "fora_do_ar":
      return "A Evolution não respondeu";
    default:
      return "A verificação das etiquetas falhou";
  }
}

/** O evento a registrar na linha do tempo para cada estado da chave. */
export function eventoDoEstado(estado: EstadoChave): string {
  return estado === "ok" ? "chave_ok" : estado;
}
