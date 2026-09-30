import { Bloco, CabecalhoSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <CabecalhoSkeleton />
      <div className="flex-1 px-4 pb-8 sm:px-8">
        <div className="flex max-w-4xl flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-6">
                <Bloco className="h-2.5 w-20" />
                <Bloco className="mt-2 h-7 w-12" />
              </div>
            ))}
          </div>
          {Array.from({ length: 2 }).map((_, s) => (
            <div key={s} className="card p-6">
              <Bloco className="h-3.5 w-24" />
              <div className="mt-3 flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Bloco key={i} className="h-6 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
