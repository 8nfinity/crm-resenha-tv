import { Bloco, CabecalhoSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <CabecalhoSkeleton />
      <div className="flex-1 px-4 pb-8 sm:px-8">
        <div className="flex max-w-3xl flex-col gap-4">
          <Bloco className="h-10 w-full" />
          <Bloco className="h-24 w-full" />
        </div>
      </div>
    </>
  );
}
