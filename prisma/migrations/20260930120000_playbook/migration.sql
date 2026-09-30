-- Playbook comercial: seções em Markdown para os vendedores revisarem.
--
-- Gerada com `prisma migrate diff` e revisada: só ADICIONA uma tabela nova.
-- Nenhum DROP, nenhuma alteração em tabela existente.

-- CreateTable
CREATE TABLE "PlaybookSection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybookSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaybookSection_order_idx" ON "PlaybookSection"("order");

