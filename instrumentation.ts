/**
 * Roda uma vez quando o servidor sobe.
 *
 * Existe para tirar dois custos do primeiro clique e jogá-los para a
 * inicialização, onde ninguém está esperando:
 *
 *  1. Abrir conexões com o banco (mais de 1s cada, com ele em outra região).
 *  2. Preparar cada formato de consulta: o Prisma 7 compila a consulta na
 *     primeira vez que ela roda, e isso somava ~700ms à primeira abertura de
 *     cada tela.
 *
 * Nada aqui é aguardado: se o banco estiver fora do ar, o servidor sobe mesmo
 * assim e a tela mostra o erro de verdade, em vez de travar na inicialização.
 */
export async function register() {
  // O proxy (middleware) roda no runtime edge, que não tem `pg`.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Fuso de Brasília. Servidores de hospedagem rodam em UTC: sem isto, "hoje
  // desde 00:00", a agenda e o calendário virariam o dia às 21h. Definido
  // antes de qualquer data ser criada; a variável TZ da hospedagem, se
  // existir, tem precedência.
  process.env.TZ ||= "America/Sao_Paulo";

  const { aquecerBanco } = await import("@/lib/db");
  const { iniciarRotinasDoServidor } = await import("@/lib/rotinas");
  iniciarRotinasDoServidor();

  const aquecer = async () => {
    await aquecerBanco();

    const [
      { getDealCards, getStages },
      { agendaDeHoje },
      { funnelMetrics, activityReport, tempoDeResposta, followUpsFeitos },
      { atividadesEntre, contarAtrasadas, leadsParaAgendar },
    ] = await Promise.all([
      import("@/lib/queries"),
      import("@/lib/today"),
      import("@/lib/metrics"),
      import("@/lib/calendario"),
    ]);

    const agora = new Date();
    const umMes = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Só leitura: o resultado é descartado, o que importa é a consulta já
    // compilada e as conexões abertas.
    await Promise.all([
      getStages(),
      getDealCards(),
      agendaDeHoje(),
      funnelMetrics(30),
      activityReport(30),
      tempoDeResposta(30),
      followUpsFeitos(),
      atividadesEntre(agora, umMes),
      contarAtrasadas(),
      leadsParaAgendar(),
    ]);
  };

  aquecer().catch((error) => {
    console.warn("Aquecimento do banco falhou (o CRM segue funcionando):", error?.message);
  });

  // Mantém o pool vivo nas pausas longas. Oito conexões cobrem as consultas
  // paralelas de qualquer tela; `unref` não segura o processo aberto.
  setInterval(() => {
    aquecerBanco().catch(() => {});
  }, 4 * 60 * 1000).unref();
}
