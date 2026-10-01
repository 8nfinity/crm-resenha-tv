import { prisma } from "@/lib/db";
import { Playbook } from "@/components/playbook";

// Editado por quem cuida do playbook; quem está lendo vê a versão nova na hora.
export const dynamic = "force-dynamic";

export default async function PlaybookPage() {
  const [secoes, arquivos] = await Promise.all([
    prisma.playbookSection.findMany({ orderBy: { order: "asc" } }),
    // Sem o arquivo (bytes): só o que o índice e a busca precisam.
    prisma.playbookFile.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, size: true, text: true, createdAt: true, uploadedBy: { select: { name: true } } },
    }),
  ]);

  return (
    <Playbook
      secoes={secoes.map((s) => ({
        id: s.id,
        title: s.title,
        body: s.body,
        updatedAt: s.updatedAt.toISOString(),
      }))}
      pdfs={arquivos.map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size,
        text: a.text ?? "",
        createdAt: a.createdAt.toISOString(),
        autor: a.uploadedBy?.name ?? null,
      }))}
    />
  );
}
