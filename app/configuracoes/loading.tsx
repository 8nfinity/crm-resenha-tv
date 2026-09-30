import { Bloco, CabecalhoSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <CabecalhoSkeleton />
      <div className="flex-1 px-4 pb-8 sm:px-8">
        <div className="flex max-w-3xl flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-6">
              <Bloco className="h-3.5 w-40" />
              <Bloco className="mt-2 h-2.5 w-64" />
              <Bloco className="mt-3 h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
