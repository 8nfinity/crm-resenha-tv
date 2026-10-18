import type Anthropic from "@anthropic-ai/sdk";

/**
 * As partes da IA de atendimento que não dependem de banco nem de rede: as
 * instruções, o histórico no formato da API e as ferramentas. Puras — testadas
 * em tests/ia.test.ts.
 */

export type ConfigTexto = {
  nome: string;
  empresa: string;
  qualificacao: string;
  agenda: string;
  regras: string;
  /** O horário de atendimento em uma frase (ver descreverRegra). Vazio: sem horário definido. */
  horario?: string;
};

/**
 * Instruções fixas da IA. Ficam iguais entre uma mensagem e outra (o que muda
 * — data, dados do lead — vai em contextoDoLead), para o cache do prompt
 * valer: só a conversa é cobrada inteira a cada resposta.
 */
export function instrucoes(c: ConfigTexto): string {
  const secao = (titulo: string, texto: string, vazio: string) =>
    `## ${titulo}\n${texto.trim() || vazio}`;

  return [
    `Você é ${c.nome || "a assistente"}, quem atende pelo WhatsApp os contatos que chegam para a empresa abaixo. ` +
      "Seu trabalho é QUALIFICAR o contato (entender quem é e o que precisa) e, se fizer sentido, AGENDAR uma reunião com a equipe. " +
      "Você não fecha negócio, não negocia preço e não promete nada que não esteja escrito aqui.",

    secao("A empresa", c.empresa, "(A empresa ainda não descreveu o que faz. Seja breve, pergunte do que a pessoa precisa e passe para um humano se ela quiser detalhes.)"),
    secao("Como qualificar", c.qualificacao, "Descubra, com naturalidade: quem é a pessoa (nome, empresa ou projeto), o que ela precisa, e se há interesse real em avançar."),
    c.horario
      ? secao(
          "Agenda de reuniões",
          [
            c.horario,
            "Os horários livres vêm do calendário da equipe: SEMPRE use ver_horarios_livres antes de oferecer qualquer horário, e ofereça só horários que ela devolveu. Nunca invente nem 'chute' um horário.",
            c.agenda.trim() ? `Como acontece a reunião: ${c.agenda.trim()}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          "",
        )
      : secao("Agenda de reuniões", "", "(Sem horário de atendimento definido. Não marque reunião: diga que a equipe vai propor um horário e use passar_para_humano.)"),
    c.regras.trim() ? secao("Regras da empresa", c.regras, "") : "",

    `## Como escrever no WhatsApp
- Português do Brasil, tom cordial e direto, como uma pessoa da equipe — nunca diga que é um robô ou uma IA, a não ser que perguntem diretamente; aí seja honesta.
- Mensagens curtas: 1 a 3 frases. Uma pergunta por vez.
- Sem markdown, sem listas com marcadores, sem negrito com asteriscos. No máximo um emoji, e só se combinar com a conversa.
- Para mandar mais de uma mensagem seguida, separe com uma linha em branco: cada parte vira uma mensagem.
- Nunca invente preço, prazo, condição, endereço ou link que não esteja nas instruções. Se não souber, diga que vai confirmar com a equipe e use passar_para_humano.`,

    `## Ferramentas
- registrar_qualificacao: assim que tiver as informações de qualificação (mesmo que a pessoa não esteja qualificada), registre um resumo. Use de novo se descobrir algo importante depois.
- ver_horarios_livres: consulta o calendário e devolve os horários livres. Use antes de oferecer horários (e de novo se a pessoa pedir outro dia). Ofereça 2 ou 3 opções, em dias diferentes quando der.
- agendar_reuniao: só depois que a pessoa CONFIRMAR um dos horários livres, usando o ISO exato que ver_horarios_livres devolveu. Se ela pedir um horário fora da lista, consulte de novo e ofereça o mais próximo. Depois de agendar, confirme o dia e a hora para a pessoa.
- passar_para_humano: quando a pessoa pedir para falar com alguém, reclamar, perguntar algo que você não sabe, quiser negociar ou fechar, ou quando a conversa não for de um possível cliente (fornecedor, candidato a vaga, engano). Avise a pessoa que alguém da equipe vai continuar o atendimento. Depois disso você não responde mais.
- Se a mensagem do contato não pede resposta (ex.: só "ok", "obrigado" depois de agendado), responda bem curto ou encerre com cordialidade.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** O que muda a cada resposta: data e hora, e o que o CRM já sabe do lead. */
export function contextoDoLead(p: {
  agora: Date;
  nome: string | null;
  telefone: string | null;
  coluna: string;
  qualificado: boolean;
  reunioes: { quando: Date }[];
}): string {
  const fmt = (d: Date) =>
    d.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return [
    "## Agora",
    `${fmt(p.agora)} (horário de Brasília, UTC-03:00).`,
    "## O contato",
    `Nome no WhatsApp: ${p.nome ?? "não informado"}. Telefone: ${p.telefone ?? "não informado"}.`,
    `No CRM: coluna "${p.coluna}"${p.qualificado ? ", já qualificado" : ""}.`,
    p.reunioes.length
      ? `Reunião já marcada: ${p.reunioes.map((r) => fmt(r.quando)).join("; ")}. Não marque outra, a não ser que a pessoa peça para remarcar.`
      : "Nenhuma reunião marcada ainda.",
  ].join("\n");
}

export type MensagemDoHistorico = {
  fromMe: boolean;
  porIA: boolean;
  type: string;
  body: string | null;
};

const ROTULO_MIDIA: Record<string, string> = {
  IMAGE: "[o contato mandou uma foto]",
  VIDEO: "[o contato mandou um vídeo]",
  AUDIO: "[o contato mandou um áudio — você não consegue ouvir; peça com gentileza para escrever]",
  DOCUMENT: "[o contato mandou um documento]",
  STICKER: "[figurinha]",
  LOCATION: "[localização]",
  CONTACT: "[cartão de contato]",
};

/**
 * A conversa do WhatsApp no formato da API: o contato é "user"; as mensagens
 * enviadas (pela IA ou por alguém da equipe) são "assistant". Mensagens
 * seguidas do mesmo lado viram um turno só, e a conversa precisa começar pelo
 * contato — o que vier antes da primeira mensagem dele fica de fora.
 */
export function historicoParaClaude(msgs: MensagemDoHistorico[]): Anthropic.MessageParam[] {
  const turnos: { role: "user" | "assistant"; partes: string[] }[] = [];
  for (const m of msgs) {
    const texto = m.body?.trim() || (m.fromMe ? "[mídia enviada]" : (ROTULO_MIDIA[m.type] ?? "[mensagem sem texto]"));
    const role = m.fromMe ? "assistant" : "user";
    if (turnos.length === 0 && role === "assistant") continue;
    const ultimo = turnos.at(-1);
    if (ultimo?.role === role) ultimo.partes.push(texto);
    else turnos.push({ role, partes: [texto] });
  }
  return turnos.map((t) => ({ role: t.role, content: t.partes.join("\n\n") }));
}

/**
 * A resposta vira mensagens separadas onde há linha em branco, como alguém
 * digitando no celular. No máximo 4: o resto vai junto na última.
 */
export function dividirEmMensagens(texto: string): string[] {
  const partes = texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length <= 4) return partes;
  return [...partes.slice(0, 3), partes.slice(3).join("\n\n")];
}

/** Tempo de "digitando…" de uma mensagem: proporcional ao tamanho, entre 1,5 e 6 s. */
export function tempoDigitando(texto: string): number {
  return Math.min(6000, Math.max(1500, texto.length * 45));
}

export const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: "ver_horarios_livres",
    description:
      "Consulta o calendário da equipe e devolve os horários livres para reunião (já descontando o que está marcado e respeitando o horário de atendimento).",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        data_inicial: {
          type: "string",
          description: "Primeiro dia a consultar, AAAA-MM-DD. Vazio (\"\") = hoje.",
        },
        quantos_dias: {
          type: "integer",
          description: "Quantos dias consultar a partir da data inicial (1 a 14). Use 5 se a pessoa não pediu um dia.",
        },
      },
      required: ["data_inicial", "quantos_dias"],
      additionalProperties: false,
    },
  },
  {
    name: "registrar_qualificacao",
    description:
      "Registra no CRM o que você descobriu sobre o contato. Use quando tiver as informações de qualificação, mesmo que a pessoa não esteja qualificada.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        qualificado: {
          type: "boolean",
          description: "true se a pessoa atende aos critérios de qualificação e tem interesse real.",
        },
        resumo: {
          type: "string",
          description: "Resumo curto para a equipe: quem é, o que precisa, orçamento/prazo se souber, e por que está (ou não) qualificado.",
        },
      },
      required: ["qualificado", "resumo"],
      additionalProperties: false,
    },
  },
  {
    name: "agendar_reuniao",
    description:
      "Marca a reunião no calendário do CRM. Só use depois que a pessoa confirmar um dia e horário específicos, dentro da agenda da empresa.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        inicio: {
          type: "string",
          description: "Data e hora da reunião no formato ISO 8601 com o fuso de Brasília, ex.: 2026-10-20T14:30:00-03:00.",
        },
        resumo: {
          type: "string",
          description: "Assunto da reunião e o que a equipe precisa saber antes dela.",
        },
      },
      required: ["inicio", "resumo"],
      additionalProperties: false,
    },
  },
  {
    name: "passar_para_humano",
    description:
      "Passa a conversa para alguém da equipe e você para de responder este contato. Avise a pessoa antes, na sua resposta.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Por que precisa de um humano, em uma frase, para a equipe." },
      },
      required: ["motivo"],
      additionalProperties: false,
    },
  },
];
