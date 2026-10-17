import {
  activityReport,
  followUpsFeitos,
  funnelMetrics,
  JANELAS_FOLLOW_UP,
  tempoDeResposta,
  type FollowUpsFeitos,
  type RelatorioTempoResposta,
} from "@/lib/metrics";
import { descreverPeriodo, PERIODOS, rotuloJanela } from "@/lib/periodo";
import { formatarMinutos, SILENCIO_QUE_ABRE_CONVERSA_H } from "@/lib/tempo-resposta";
import { ExportarPdf } from "@/components/exportar-pdf";
import { CardHeader, Kpi, PageHeader, Pill } from "@/components/ui";
import { escolherFunil, listarFunis } from "@/lib/funis";

export const dynamic = "force-dynamic";

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function horas(h: number | null): string {
  if (h === null) return "—";
  if (h < 24) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; funil?: string }>;
}) {
  const params = await searchParams;
  const dias = Math.min(Math.max(Number(params.dias) || 30, 1), 730);
  const funis = await listarFunis();
  const escolhido = escolherFunil(funis, params.funil);
  // Os links de período mantêm o funil, e os de funil mantêm o período.
  const link = (d: number, f?: string) => `/metricas?dias=${d}${f ? `&funil=${encodeURIComponent(f)}` : ""}`;

  const [funil, atividades, resposta, followUps] = await Promise.all([
    funnelMetrics(dias, escolhido?.id),
    activityReport(dias),
    tempoDeResposta(dias),
    followUpsFeitos(),
  ]);

  // Estágio "perdido" não é um passo adiante: a taxa dele não é conversão.
  const conversoes = funil.estagios.filter((e) => e.conversao !== null && !e.isLost);
  const ativosAgora = funil.estagios
    .filter((e) => !e.isWon && !e.isLost)
    .reduce((s, e) => s + e.agora, 0);

  return (
    <div className="scroll-thin flex-1 overflow-y-auto pb-10">
      <PageHeader title={"Visão geral\ndo funil"} subtitle={descreverPeriodo(dias)}>
        {PERIODOS.map((d) => (
          <Pill key={d} href={link(d, params.funil)} active={d === dias}>
            {d === 1 ? "Hoje" : `${d} dias`}
          </Pill>
        ))}
        <ExportarPdf funil={funil} atividades={atividades} resposta={resposta} followUps={followUps} />
      </PageHeader>

      <div className="flex flex-col gap-5 px-4 sm:px-8">
        {funis.length > 1 && (
          // Conversão, ganhos e perdidos são de um funil; atividades, tempo de
          // resposta e follow-ups abaixo valem para o CRM inteiro.
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wide text-[var(--color-muted)]">Funil</span>
            {funis.map((f) => (
              <Pill key={f.id} href={link(dias, f.id)} active={f.id === escolhido?.id}>
                {f.name}
              </Pill>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
          <Kpi
            label="Novos leads"
            value={funil.novos}
            caption="entraram no funil"
            href={escolhido ? `/funil?funil=${encodeURIComponent(escolhido.id)}` : "/funil"}
          />
          <Kpi label="Ganhos" value={funil.ganhos} caption="negócios fechados" tone="accent" />
          <Kpi label="Perdidos" value={funil.perdidos} caption="saíram do funil" />
          <Kpi
            label="Conversão geral"
            value={pct(funil.conversaoGeral)}
            caption="ganhos ÷ novos leads"
          />
        </div>

        <FollowUps f={followUps} />

        <TempoDeResposta r={resposta} />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
          <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
            <section className="card p-6">
              <CardHeader
                title="Conversão entre estágios"
                description="Quantos dos que chegaram ao estágio anterior também chegaram a este."
              />
              {conversoes.length === 0 ? (
                <p className="mt-6 text-sm text-[var(--color-muted)]">
                  Ainda não há passagens entre estágios no período.
                </p>
              ) : (
                <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
                  {conversoes.map((e) => (
                    <Gauge
                      key={e.id}
                      valor={e.conversao ?? 0}
                      rotulo={e.nome}
                      total={e.chegaram}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="card p-6">
              <CardHeader
                title="Atividades"
                description={
                  atividades.temRegistro
                    ? `${atividades.leadsComReuniao} leads distintos tiveram reunião no período.`
                    : undefined
                }
              />
              {!atividades.temRegistro ? (
                <p className="mt-4 text-sm text-[var(--color-muted)]">
                  Nenhuma atividade registrada. Marque follow-ups e reuniões na aba
                  &quot;atividades&quot; de cada card — sem esse registro não há o que
                  medir aqui.
                </p>
              ) : (
                <>
                  <div className="mt-6 grid grid-cols-5 gap-3">
                    {atividades.porTipo.map((t) => {
                      const parte =
                        atividades.totalFeitas > 0 ? t.feitas / atividades.totalFeitas : 0;
                      return (
                        <div key={t.tipo} className="min-w-0" title={`${t.feitas} feitas · ${t.abertas} em aberto`}>
                          <p className="text-xl font-semibold tabular-nums">
                            {Math.round(parte * 100)}%
                          </p>
                          <p className="truncate text-xs text-[var(--color-muted)]">
                            {t.label}
                          </p>
                          <div className="hatch relative mt-3 h-28 overflow-hidden rounded-full">
                            <div
                              className="absolute inset-x-0 bottom-0 rounded-full bg-[var(--color-accent)]"
                              style={{ height: `${Math.max(parte * 100, t.feitas > 0 ? 18 : 0)}%` }}
                            />
                          </div>
                          <p className="mt-2 text-center text-[11px] tabular-nums text-[var(--color-muted)]">
                            {t.feitas} · {t.abertas} abertas
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  {atividades.atrasadas > 0 && (
                    <p className="mt-4 rounded-md bg-[color-mix(in_srgb,var(--color-hot)_12%,transparent)] px-4 py-2.5 text-xs">
                      {atividades.atrasadas} atividades atrasadas.
                    </p>
                  )}
                </>
              )}
            </section>
          </div>

          <FunilEscuro
            estagios={funil.estagios}
            novos={funil.novos}
            ativos={ativosAgora}
            ganhos={funil.ganhos}
            gargalo={funil.gargalo}
          />
        </div>

        <section className="card p-6">
          <CardHeader
            title="Detalhe por estágio"
            description="“Passaram” conta leads distintos que cruzaram o estágio no período, não quem está parado lá agora — quem passou por Reunião e já avançou continua contando."
          />
          {funil.estagios.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-muted)]">
              Nenhum estágio configurado.
            </p>
          ) : (
            <div className="scroll-thin mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--color-muted)]">
                    <th className="pb-3 font-normal">Estágio</th>
                    <th className="pb-3 text-right font-normal">Passaram</th>
                    <th className="pb-3 text-right font-normal">Conversão</th>
                    <th className="pb-3 text-right font-normal">Agora</th>
                    <th className="pb-3 text-right font-normal">Tempo médio</th>
                  </tr>
                </thead>
                <tbody>
                  {funil.estagios.map((e) => (
                    <tr key={e.id} className="border-t">
                      <td className="py-3">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: e.cor }}
                          />
                          {e.nome}
                        </span>
                      </td>
                      <td className="py-3 text-right tabular-nums">{e.chegaram}</td>
                      <td className="py-3 text-right tabular-nums">{pct(e.conversao)}</td>
                      <td className="py-3 text-right tabular-nums text-[var(--color-muted)]">
                        {e.agora}
                      </td>
                      <td className="py-3 text-right tabular-nums text-[var(--color-muted)]">
                        {horas(e.horasMedias)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Meio anel com agulha: a taxa de conversão de um estágio. */
function Gauge({ valor, rotulo, total }: { valor: number; rotulo: string; total: number }) {
  const p = Math.min(Math.max(valor, 0), 1);
  const ang = Math.PI * (1 - p);
  const x = 50 + 40 * Math.cos(ang);
  const y = 50 - 40 * Math.sin(ang);

  return (
    <div className="min-w-0" title={`${rotulo}: ${Math.round(p * 100)}% · ${total} leads`}>
      <p className="text-xl font-semibold tabular-nums">{Math.round(p * 100)}%</p>
      <p className="truncate text-xs text-[var(--color-muted)]">{total} leads</p>
      <svg viewBox="0 0 100 58" className="mt-2 w-full" aria-hidden>
        <defs>
          <linearGradient id="gauge-fill" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#8a3a0c" />
            <stop offset="100%" stopColor="var(--color-accent)" />
          </linearGradient>
        </defs>
        <path
          d="M10 50 A40 40 0 0 1 90 50"
          fill="none"
          stroke="var(--color-surface-2)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {p > 0 && (
          <path
            d="M10 50 A40 40 0 0 1 90 50"
            fill="none"
            stroke="url(#gauge-fill)"
            strokeWidth="14"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${p * 100} 100`}
          />
        )}
        <line x1="50" y1="50" x2={x} y2={y} stroke="var(--color-text)" strokeWidth="1.2" />
        <circle cx="50" cy="50" r="2.2" fill="var(--color-text)" />
        <circle cx={x} cy={y} r="3" fill="var(--color-yellow)" stroke="var(--color-panel)" strokeWidth="1" />
      </svg>
      <p className="mt-1 truncate text-center text-xs text-[var(--color-muted)]">{rotulo}</p>
    </div>
  );
}

/** O card preto: números-chave e uma barra por estágio. */
function FunilEscuro({
  estagios,
  novos,
  ativos,
  ganhos,
  gargalo,
}: {
  estagios: Awaited<ReturnType<typeof funnelMetrics>>["estagios"];
  novos: number;
  ativos: number;
  ganhos: number;
  gargalo: { nome: string; horas: number } | null;
}) {
  const max = Math.max(1, ...estagios.map((e) => e.chegaram));

  return (
    <section className="flex min-w-0 flex-col card bg-[var(--color-panel)] p-6 xl:col-span-3">
      <CardHeader
        dark
        title="Fluxo do funil"
        description="Leads distintos que passaram por cada estágio no período."
      />

      <div className="mt-6 grid grid-cols-3 gap-4">
        <Numero valor={novos} rotulo="Entraram" />
        <Numero valor={ativos} rotulo="Em andamento agora" />
        <Numero valor={ganhos} rotulo="Ganhos" destaque />
      </div>

      {estagios.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--color-muted)]">Nenhum estágio configurado.</p>
      ) : (
        <div className="mt-8 flex min-h-64 flex-1 items-end gap-2 sm:gap-3">
          {estagios.map((e) => {
            const h = (e.chegaram / max) * 100;
            return (
              <div key={e.id} className="group flex h-full min-w-0 flex-1 flex-col items-center">
                <div className="hatch-dark relative w-full flex-1 overflow-hidden rounded-full">
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-full transition-opacity group-hover:opacity-80"
                    style={{
                      height: `${Math.max(h, e.chegaram > 0 ? 8 : 0)}%`,
                      background: e.isLost
                        ? "rgb(255 59 69 / 0.55)"
                        : "linear-gradient(to top, #5c280a, var(--color-accent))",
                    }}
                  />
                  <span className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-0.5 text-[11px] tabular-nums opacity-0 transition-opacity group-hover:opacity-100">
                    {e.agora} agora
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold tabular-nums">{e.chegaram}</p>
                <p className="w-full truncate text-center text-[11px] text-[var(--color-muted)]">{e.nome}</p>
              </div>
            );
          })}
        </div>
      )}

      {gargalo && (
        <p className="mt-6 rounded-md border border-[var(--color-yellow)]/40 bg-[color-mix(in_srgb,var(--color-yellow)_8%,transparent)] px-4 py-3 text-xs">
          Gargalo: <strong className="text-[var(--color-yellow)]">{gargalo.nome}</strong> — os leads
          ficam em média {horas(gargalo.horas)} nesse estágio antes de avançar.
        </p>
      )}
    </section>
  );
}

function Numero({ valor, rotulo, destaque }: { valor: number; rotulo: string; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <p
        className={`text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl ${
          destaque ? "text-[var(--color-accent)]" : ""
        }`}
      >
        {valor.toLocaleString("pt-BR")}
      </p>
      <p className="mt-1 truncate text-xs text-[var(--color-muted)]">{rotulo}</p>
    </div>
  );
}

/**
 * Tempo de resposta do vendedor.
 *
 * O destaque é a PRIMEIRA resposta — quanto o lead espera quando chega. A
 * resposta no meio do papo aparece ao lado, menor: é rápida por natureza
 * ("Sim", "Beleza") e, misturada, esconderia a espera que perde venda.
 */
function TempoDeResposta({ r }: { r: RelatorioTempoResposta }) {
  const p = r.primeira;
  const maxFaixa = Math.max(1, ...r.faixasPrimeira.map((f) => f.quantidade));

  return (
    <section className="card p-6">
      <CardHeader
        title="Tempo de resposta do vendedor"
        description={`Quanto o lead espera pela sua resposta. "Primeira resposta" é quando ele começa uma conversa ou volta depois de ${SILENCIO_QUE_ABRE_CONVERSA_H} h de silêncio.`}
      />

      {p.conversas === 0 && r.duranteConversa.conversas === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Nenhuma mensagem de lead no período. Importe as conversas em Conexão.
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
            <Kpi
              label="Primeira resposta"
              value={formatarMinutos(p.medianaMin)}
              caption={`mediana de ${p.respondidas} respostas`}
              tone="accent"
            />
            <Kpi
              label="Em até 5 minutos"
              value={pct(p.ate5Min)}
              caption={`em até 1 h: ${pct(p.ate1h)}`}
            />
            <Kpi
              label="Sem resposta"
              value={p.semResposta}
              caption={
                p.maiorEsperaMin !== null
                  ? `o mais antigo espera há ${formatarMinutos(p.maiorEsperaMin)}`
                  : "nenhum lead esperando"
              }
              tone={p.semResposta > 0 ? "hot" : undefined}
            />
            <Kpi
              label="Durante a conversa"
              value={formatarMinutos(r.duranteConversa.medianaMin)}
              caption="mediana no meio do papo"
            />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-5">
            <div className="min-w-0 xl:col-span-2">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">
                Primeiras respostas por faixa de tempo
              </p>
              <div className="mt-4 flex h-44 items-end gap-2">
                {r.faixasPrimeira.map((f) => {
                  const h = (f.quantidade / maxFaixa) * 100;
                  return (
                    <div
                      key={f.rotulo}
                      className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                      title={`${f.rotulo}: ${f.quantidade} ${f.quantidade === 1 ? "resposta" : "respostas"}`}
                    >
                      <span className="mb-1 text-xs font-bold tabular-nums">{f.quantidade}</span>
                      <div className="hatch relative w-full flex-1 overflow-hidden rounded-t-xl rounded-b-md">
                        <div
                          className="absolute inset-x-0 bottom-0 rounded-t-xl rounded-b-md bg-[var(--color-accent)] transition-opacity group-hover:opacity-80"
                          style={{ height: `${Math.max(h, f.quantidade > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                      <span className="mt-2 w-full truncate text-center text-[10px] text-[var(--color-muted)]">
                        {f.rotulo}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="scroll-thin min-w-0 overflow-x-auto xl:col-span-3">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--color-muted)]">
                    <th className="pb-3 font-normal">Vendedor (número)</th>
                    <th className="pb-3 text-right font-normal">1ª resposta</th>
                    <th className="pb-3 text-right font-normal">Até 5 min</th>
                    <th className="pb-3 text-right font-normal">90% em até</th>
                    <th className="pb-3 text-right font-normal">Sem resposta</th>
                    <th className="pb-3 text-right font-normal">No papo</th>
                  </tr>
                </thead>
                <tbody>
                  {r.porVendedor.map((v) => (
                    <tr key={v.id} className="border-t">
                      <td className="py-3">
                        <span className="inline-flex items-center gap-2 font-semibold">
                          <span className="size-2 rounded-full" style={{ backgroundColor: v.cor }} />
                          {v.nome}
                        </span>
                      </td>
                      <td className="py-3 text-right font-bold tabular-nums text-[var(--color-accent)]">
                        {formatarMinutos(v.primeira.medianaMin)}
                      </td>
                      <td className="py-3 text-right tabular-nums">{pct(v.primeira.ate5Min)}</td>
                      <td className="py-3 text-right tabular-nums">{formatarMinutos(v.primeira.p90Min)}</td>
                      <td className="py-3 text-right tabular-nums">
                        {v.primeira.semResposta > 0 ? (
                          <span className="text-[var(--color-hot)]">{v.primeira.semResposta}</span>
                        ) : (
                          0
                        )}
                      </td>
                      <td className="py-3 text-right tabular-nums text-[var(--color-muted)]">
                        {formatarMinutos(v.duranteConversa.medianaMin)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                Cada número de WhatsApp conectado conta como um vendedor — renomeie em
                Conexão para aparecer o nome da pessoa. Mediana, e não média: uma resposta
                dada dias depois não distorce o retrato do dia a dia.
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Follow-ups feitos em janelas fixas (hoje, 7, 15 e 30 dias), lado a lado.
 *
 * Não segue o período do topo de propósito: a pergunta aqui é "o ritmo está
 * subindo ou caindo?", e isso só se lê comparando as janelas entre si.
 */
function FollowUps({ f }: { f: FollowUpsFeitos }) {
  const max = Math.max(1, ...f.janelas.map((j) => j.feitos));
  return (
    <section className="card p-6">
      <CardHeader
        title="Follow-ups feitos"
        description="Concluídos em cada janela, pela data em que foram marcados como feitos. Hoje conta desde a meia-noite."
      >
        <a
          href="/calendario"
          className="rounded-full border px-3 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          Ver no calendário
        </a>
      </CardHeader>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        {f.janelas.map((j) => (
          <div key={j.dias} className="rounded-md bg-[var(--color-surface-2)] p-4">
            <p className="text-xs text-[var(--color-muted)]">{rotuloJanela(j.dias)}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-[var(--color-accent)]">{j.feitos}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface)]">
              <div
                className="h-full rounded-full bg-[var(--color-accent)]"
                style={{ width: `${(j.feitos / max) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">
              {j.dias === 1 ? "desde 00:00" : `≈ ${(j.feitos / j.dias).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia`}
            </p>
          </div>
        ))}
        <div className="rounded-md border border-[var(--color-border)] p-4">
          <p className="text-xs text-[var(--color-muted)]">Agendados</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{f.agendados}</p>
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">em aberto, com data</p>
        </div>
        <div className="rounded-md border border-[var(--color-border)] p-4">
          <p className="text-xs text-[var(--color-muted)]">Atrasados</p>
          <p className={`mt-1 text-3xl font-bold tabular-nums ${f.atrasados > 0 ? "text-[var(--color-hot)]" : ""}`}>
            {f.atrasados}
          </p>
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">prazo passou e não foi feito</p>
        </div>
      </div>

      {f.porVendedor.length > 0 && (
        <div className="scroll-thin mt-6 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-muted)]">
                <th className="pb-3 font-normal">Vendedor (número)</th>
                {JANELAS_FOLLOW_UP.map((d) => (
                  <th key={d} className="pb-3 text-right font-normal">{rotuloJanela(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {f.porVendedor.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="py-3">
                    <span className="inline-flex items-center gap-2 font-semibold">
                      <span className="size-2 rounded-full" style={{ backgroundColor: v.cor }} />
                      {v.nome}
                    </span>
                  </td>
                  {v.feitos.map((n, i) => (
                    <td key={i} className="py-3 text-right tabular-nums">{n}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
