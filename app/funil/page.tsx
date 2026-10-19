import Link from "next/link";
import { cookies } from "next/headers";
import { Board } from "@/components/kanban/board";
import { SeletorDeFunil } from "@/components/kanban/seletor-funil";
import { NovoLead } from "@/components/kanban/novo-lead";
import { getDealCards, getStages } from "@/lib/queries";
import { listarCampos } from "@/lib/custom-fields";
import { escolherFunil, listarFunis } from "@/lib/funis";
import { COOKIE_FUNIL } from "@/lib/funil-cookie";
import { formatCurrency } from "@/lib/utils";
import { prisma } from "@/lib/db";

// O funil muda a cada mensagem recebida; cache aqui mostraria dado velho.
export const dynamic = "force-dynamic";

export default async function FunilPage({
  searchParams,
}: {
  searchParams: Promise<{ funil?: string; lead?: string; busca?: string }>;
}) {
  // O funil vem do endereço; sem ele, o último aberto (cookie); sem os dois,
  // o primeiro. A lista de funis é uma consulta pequena e decide o resto.
  // `?lead=<id>` (o link da nota no Pipedrive) abre o funil DO lead, com o
  // painel dele aberto.
  const params = await searchParams;
  const [guardado, funis, doLead] = await Promise.all([
    cookies().then((c) => c.get(COOKIE_FUNIL)?.value),
    listarFunis(),
    params.lead
      ? prisma.deal.findUnique({ where: { id: params.lead }, select: { id: true, stage: { select: { pipelineId: true } } } })
      : null,
  ]);
  const funil = escolherFunil(funis, doLead?.stage.pipelineId ?? params.funil ?? guardado);

  if (!funil) {
    return (
      <EmptyState
        title="Nenhum funil configurado"
        body="Rode `npm run db:seed` para criar o funil inicial."
      />
    );
  }

  // Tudo em paralelo, de propósito.
  //
  // A versão "econômica" — buscar os campos e repassar para getDealCards —
  // parecia melhor por fazer uma consulta a menos, mas era pior na prática:
  // criava uma espera em série de ~200ms antes das outras começarem. Aqui os
  // campos são buscados duas vezes, só que ao mesmo tempo que o resto, então
  // custam zero de tempo adicional. Com o banco a 200ms de distância, o que
  // importa é o número de RODADAS, não o de consultas.
  const [stages, deals, campos, contas] = await Promise.all([
    getStages(funil.id),
    getDealCards(undefined, funil.id),
    listarCampos(),
    // Para o cadastro de lead: a qual número de WhatsApp ele pertence.
    prisma.whatsAppAccount.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, label: true, instanceName: true, phone: true } }),
  ]);

  const hot = deals.filter((d) => d.score >= 70).length;
  const stalled = deals.filter((d) => d.daysInStage >= 7).length;
  const total = deals.reduce((s, d) => s + (d.value ?? 0), 0);

  return (
    <>
      {/* Barra do funil, como a do Pipedrive: o funil, o total em R$ e quantos
          negócios; à direita os sinais de atenção. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 sm:px-6">
        <NovoLead
          colunas={stages}
          contas={contas.map((c) => ({ id: c.id, nome: c.label ?? (c.phone ? `+${c.phone}` : c.instanceName) }))}
        />
        <SeletorDeFunil atual={{ id: funil.id, name: funil.name }} />
        <p className="text-sm tabular-nums text-[var(--color-muted)]">
          <strong className="text-[var(--color-text)]">{formatCurrency(total) ?? "R$ 0"}</strong>
          {" · "}
          {deals.length} {deals.length === 1 ? "negócio" : "negócios"}
        </p>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="rounded-md border px-2.5 py-1 text-[var(--color-muted)]">
            Quentes <strong className={hot > 0 ? "text-[var(--color-accent)]" : "text-[var(--color-text)]"}>{hot}</strong>
          </span>
          <span className="rounded-md border px-2.5 py-1 text-[var(--color-muted)]">
            Parados 7d+ <strong className={stalled > 0 ? "text-[var(--color-hot)]" : "text-[var(--color-text)]"}>{stalled}</strong>
          </span>
        </div>
      </header>

      {stages.length === 0 ? (
        <EmptyState
          title="Este funil não tem colunas"
          body="Crie uma coluna para começar a receber leads aqui."
        />
      ) : deals.length === 0 && funis.length === 1 ? (
        <EmptyState
          title="Seu funil está vazio"
          body="Conecte o WhatsApp e importe seus contatos para começar."
          action={{ href: "/conexao", label: "Conectar WhatsApp" }}
        />
      ) : (
        // Com vários funis, um funil vazio ainda mostra as colunas: é nelas que
        // você arrasta, etiqueta ou move os leads para cá.
        <Board key={funil.id} pipelineId={funil.id} stages={stages} deals={deals} campos={campos} leadInicial={doLead?.id ?? null} buscaInicial={params.busca ?? ""} />
      )}
    </>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="grid flex-1 place-items-center px-4 pb-20 text-center sm:px-8">
      <div className="card max-w-md p-10">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{body}</p>
        {action && (
          <Link
            href={action.href}
            className="mt-5 inline-block rounded-full bg-[var(--color-ink)] px-5 py-2.5 text-sm font-medium text-[var(--color-on-ink)]"
          >
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}
