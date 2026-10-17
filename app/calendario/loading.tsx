import { Bloco, CabecalhoSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <CabecalhoSkeleton />
      <div className="flex-1 px-4 pb-8 sm:px-8">
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }).map((_, i) => (
            <Bloco key={i} className="h-24 rounded-md" />
          ))}
        </div>
      </div>
    </>
  );
}
