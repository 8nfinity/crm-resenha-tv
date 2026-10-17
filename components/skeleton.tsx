/**
 * Esqueletos de carregamento.
 *
 * Existem por causa da latência até o banco: ele está em Oregon e cada consulta
 * custa cerca de 200ms de rede. Sem isso, o navegador segura a tela anterior
 * enquanto espera, e a troca de aba parece travamento.
 *
 * Com um `loading.tsx` por rota, o Next manda o cabeçalho e o esqueleto na
 * hora e preenche o conteúdo quando os dados chegam. O tempo total é o mesmo;
 * o que muda é que a interface responde de imediato.
 */

export function Bloco({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[var(--color-surface-2)] ${className}`}
    />
  );
}

export function CabecalhoSkeleton() {
  return (
    <header className="px-4 pb-5 pt-6 sm:px-8 sm:pt-8">
      <Bloco className="h-10 w-56 rounded-md" />
      <Bloco className="mt-2 h-10 w-40 rounded-md" />
      <Bloco className="mt-2 h-3 w-56" />
    </header>
  );
}

/** Lista de linhas — serve para a agenda e para as tabelas de métricas. */
export function ListaSkeleton({ linhas = 5 }: { linhas?: number }) {
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      {Array.from({ length: linhas }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 card px-4 py-3"
        >
          <Bloco className="size-2 shrink-0 rounded-full" />
          <div className="flex-1">
            <Bloco className="h-3.5 w-40" />
            <Bloco className="mt-1.5 h-2.5 w-56" />
          </div>
          <Bloco className="h-4 w-8 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Colunas do kanban com cards vazios. */
export function KanbanSkeleton() {
  return (
    <div className="flex flex-1 gap-3 overflow-hidden px-4 pb-6 sm:px-8">
      {Array.from({ length: 5 }).map((_, col) => (
        <div key={col} className="flex w-76 shrink-0 flex-col">
          <div className="mb-2 flex items-center gap-2 px-1">
            <Bloco className="size-2.5 rounded-full" />
            <Bloco className="h-3.5 w-24" />
          </div>
          <div className="flex flex-col gap-2 rounded-md border border-dashed bg-[var(--color-surface)] p-2">
            {Array.from({ length: 3 - (col % 2) }).map((_, i) => (
              <div
                key={i}
                className="rounded-md border bg-[var(--color-surface-2)] p-3"
              >
                <div className="flex gap-2.5">
                  <Bloco className="size-9 shrink-0 rounded-full" />
                  <div className="flex-1">
                    <Bloco className="h-3.5 w-28" />
                    <Bloco className="mt-1.5 h-2.5 w-36" />
                  </div>
                </div>
                <Bloco className="mt-2.5 h-2.5 w-40" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
