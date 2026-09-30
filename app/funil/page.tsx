import Link from "next/link";
import { Board } from "@/components/kanban/board";
import { getDealCards, getStages } from "@/lib/queries";
import { listarCampos } from "@/lib/custom-fields";
import { Kpi, PageHeader } from "@/components/ui";

// O funil muda a cada mensagem recebida; cache aqui mostraria dado velho.
export const dynamic = "force-dynamic";

export default async function FunilPage() {
  // Tudo em paralelo, de propósito.
  //
  // A versão "econômica" — buscar os campos e repassar para getDealCards —
  // parecia melhor por fazer uma consulta a menos, mas era pior na prática:
  // criava uma espera em série de ~200ms antes das outras começarem. Aqui os
  // campos são buscados duas vezes, só que ao mesmo tempo que o resto, então
  // custam zero de tempo adicional. Com o banco a 200ms de distância, o que
  // importa é o número de RODADAS, não o de consultas.
  const [stages, deals, campos] = await Promise.all([
    getStages(),
    getDealCards(),
    listarCampos(),
  ]);

  const hot = deals.filter((d) => d.score >= 70).length;
  const stalled = deals.filter((d) => d.daysInStage >= 7).length;

  return (
    <>
      <PageHeader title={"Funil\nde vendas"}>
        <div className="flex gap-8">
          <Kpi label="Leads" value={deals.length} />
          <Kpi label="Quentes" value={hot} tone={hot > 0 ? "accent" : undefined} />
          <Kpi label="Parados 7d+" value={stalled} tone={stalled > 0 ? "hot" : undefined} />
        </div>
      </PageHeader>

      {stages.length === 0 ? (
        <EmptyState
          title="Nenhum estágio configurado"
          body="Rode `npm run db:seed` para criar as colunas iniciais do funil."
        />
      ) : deals.length === 0 ? (
        <EmptyState
          title="Seu funil está vazio"
          body="Conecte o WhatsApp e importe seus contatos para começar."
          action={{ href: "/conexao", label: "Conectar WhatsApp" }}
        />
      ) : (
        <Board stages={stages} deals={deals} campos={campos} />
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
