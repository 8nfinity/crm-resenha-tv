import { Bloco, CabecalhoSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <CabecalhoSkeleton />
      <div className="flex flex-1 gap-5 px-4 pb-8 sm:px-8">
        <Bloco className="hidden h-96 w-72 rounded-[28px] lg:block" />
        <Bloco className="h-96 flex-1 rounded-[28px]" />
      </div>
    </>
  );
}
