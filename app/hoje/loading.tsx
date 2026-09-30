import { CabecalhoSkeleton, ListaSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <CabecalhoSkeleton />
      <div className="flex-1 px-4 pb-8 sm:px-8">
        <ListaSkeleton linhas={5} />
      </div>
    </>
  );
}
