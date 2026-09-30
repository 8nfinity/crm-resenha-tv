import { prisma } from "@/lib/db";
import { Playbook } from "@/components/playbook";

// Editado por quem cuida do playbook; quem está lendo vê a versão nova na hora.
export const dynamic = "force-dynamic";

export default async function PlaybookPage() {
  const secoes = await prisma.playbookSection.findMany({ orderBy: { order: "asc" } });

  return (
    <Playbook
      secoes={secoes.map((s) => ({
        id: s.id,
        title: s.title,
        body: s.body,
        updatedAt: s.updatedAt.toISOString(),
      }))}
    />
  );
}
