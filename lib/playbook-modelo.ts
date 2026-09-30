/**
 * Modelo inicial do playbook, oferecido quando ele está vazio.
 *
 * A tabela de avaliações vem do material de divulgação da Biomech (valores e
 * durações). O resto são tópicos-guia para o time substituir pelo próprio
 * texto — nada aqui é política da empresa até alguém revisar.
 */
export const MODELO_PLAYBOOK: { title: string; body: string }[] = [
  {
    title: "Como usar este playbook",
    body: `Este é o material de consulta do time comercial. Revise antes de começar o dia e sempre que tiver dúvida numa conversa.

- **Leia de cima para baixo** na primeira vez: a ordem segue o caminho do lead.
- **Use a busca** (à esquerda) para achar uma objeção ou um preço no meio de uma conversa.
- Viu algo desatualizado? Avise quem cuida do playbook — cada seção mostra quando foi alterada pela última vez.`,
  },
  {
    title: "Avaliações e valores",
    body: `Escolha a avaliação pelo que o paciente precisa. **Trate conosco e ganhe até 15% de desconto no valor das avaliações.**

| Avaliação | Duração | Para quem | Com Rodrigo | Com Henrique |
|---|---|---|---|---|
| **0** | até 1h15 | Muita dor ou edema, recém-operado, tratar 1 local. *Sem relatório.* | R$ 499 | R$ 250 |
| **1** | até 1h15 | Tratar 1 local, nunca teve lesões importantes, prevenção e desempenho. Relatório incluído. | R$ 499 | R$ 314 |
| **2** | até 1h45 | Até 2 locais de dor, já teve lesões importantes, prevenção e desempenho. Relatório incluído. | R$ 699 | R$ 524 |
| **3** | até 2h45 | Até 3 locais de dor, já teve lesões importantes, prevenção e desempenho. Relatório incluído. | R$ 1.099 | R$ 944 |

> A Avaliação 0 **não tem relatório** como as avaliações 1, 2 e 3 — deixe isso claro antes de fechar.`,
  },
  {
    title: "Primeiro contato",
    body: `Objetivo: entender a dor do lead e indicar a avaliação certa.

1. Cumprimente pelo nome e se apresente.
2. Pergunte **onde dói**, **há quanto tempo** e se **já operou ou teve lesão importante**.
3. Com as respostas, indique a avaliação pela tabela de *Avaliações e valores*.
4. Ofereça horários concretos (duas opções), não "quando você pode?".

*Substitua este roteiro pelo texto que o time usa.*`,
  },
  {
    title: "Objeções comuns",
    body: `### "Está caro"
- Explique o que está incluído (relatório, recomendações).
- Lembre o desconto de até 15% para quem trata conosco.

### "Vou pensar"
- Pergunte qual é a dúvida que ficou.
- Agende o follow-up no CRM antes de encerrar a conversa.

*Acrescente aqui as objeções que o time ouve.*`,
  },
  {
    title: "Follow-up",
    body: `- Todo lead que não fechou **sai da conversa com um follow-up agendado** no CRM (aba Atividades do lead ou Calendário).
- Primeiro retorno em até 24 h; depois em 3 e 7 dias.
- Ao fazer, marque como feito — é o que alimenta as métricas de follow-up.`,
  },
];
