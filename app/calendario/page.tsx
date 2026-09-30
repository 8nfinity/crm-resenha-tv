import { atividadesEntre, contarAtrasadas, leadsParaAgendar } from "@/lib/calendario";
import { Calendario, type Visao } from "@/components/calendario";

// Atividades mudam a cada clique (e chegam de outras abas pelo "Ao vivo").
export const dynamic = "force-dynamic";

const VISOES: Visao[] = ["dia", "semana", "mes", "agenda"];

/** "2026-09-30" → Date local. Qualquer coisa inválida vira hoje. */
function lerData(valor: string | undefined): Date {
  const m = valor?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) return d;
  }
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ visao?: string; data?: string }>;
}) {
  const params = await searchParams;
  const visao: Visao = VISOES.includes(params.visao as Visao) ? (params.visao as Visao) : "semana";
  const data = lerData(params.data);

  // Busca o mês da data com folga (a grade do mês mostra até 6 semanas) e,
  // na Programação, os 60 dias seguintes. Um dia extra de cada lado cobre
  // diferença de fuso entre servidor e navegador.
  const inicio = new Date(data.getFullYear(), data.getMonth(), 1);
  inicio.setDate(inicio.getDate() - 8);
  const fimMes = new Date(data.getFullYear(), data.getMonth() + 1, 1);
  fimMes.setDate(fimMes.getDate() + 15);
  const fimAgenda = new Date(data);
  fimAgenda.setDate(fimAgenda.getDate() + 61);
  const fim = fimAgenda > fimMes ? fimAgenda : fimMes;

  const [atividades, atrasadas, leads] = await Promise.all([
    atividadesEntre(inicio, fim),
    contarAtrasadas(),
    leadsParaAgendar(),
  ]);

  return (
    <Calendario
      visao={visao}
      dataIso={`${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`}
      atividades={atividades}
      atrasadasTotal={atrasadas}
      leads={leads}
    />
  );
}
