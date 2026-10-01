import { agendaDeHoje } from "@/lib/today";
import { TodayList } from "@/components/today-list";
import { Kpi, PageHeader } from "@/components/ui";
import { ConviteNotificacoes } from "@/components/notificacoes";

// A agenda muda a cada mensagem recebida; cache aqui mostraria dado velho.
export const dynamic = "force-dynamic";

export default async function HojePage() {
  const agenda = await agendaDeHoje();

  const data = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div className="scroll-thin flex flex-1 flex-col overflow-y-auto pb-10">
      <PageHeader
        title={"Agenda\nde hoje"}
        subtitle={
          <span className="capitalize">
            {data}
            {agenda.totalPendente > 0 && (
              <span className="normal-case">
                {" "}
                · {agenda.totalPendente}{" "}
                {agenda.totalPendente === 1 ? "item exige" : "itens exigem"} você
              </span>
            )}
          </span>
        }
      />

      <ConviteNotificacoes />

      <div className="flex flex-1 flex-col gap-6 px-4 sm:px-8">
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
          <Kpi
            label="Atrasados"
            value={agenda.atrasados.length}
            caption="venceram em aberto"
            tone={agenda.atrasados.length > 0 ? "hot" : undefined}
          />
          <Kpi label="Para hoje" value={agenda.hoje.length} caption="prazo até o fim do dia" />
          <Kpi
            label="Responderam"
            value={agenda.responderam.length}
            caption="nas últimas 24h"
            tone={agenda.responderam.length > 0 ? "accent" : undefined}
          />
          <Kpi
            label="Esfriando"
            value={agenda.esfriando.length}
            caption="leads bons parados"
            href="/funil"
          />
        </div>

        <TodayList agenda={agenda} />
      </div>
    </div>
  );
}
