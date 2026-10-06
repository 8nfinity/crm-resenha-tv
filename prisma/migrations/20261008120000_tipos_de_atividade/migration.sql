-- Tipos de atividade criados por você (além dos fixos). Só acrescenta:
-- tabela nova e coluna opcional; nenhuma atividade existente muda.

-- CreateTable
CREATE TABLE "ActivityKind" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#94a3b8',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityKind_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN "kindId" TEXT;

-- CreateIndex
CREATE INDEX "Activity_kindId_idx" ON "Activity"("kindId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_kindId_fkey" FOREIGN KEY ("kindId") REFERENCES "ActivityKind"("id") ON DELETE SET NULL ON UPDATE CASCADE;
