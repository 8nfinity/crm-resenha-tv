-- Campos definidos pelo usuário nos leads.
--
-- Escrita à mão: neste projeto `prisma migrate dev` reseta o banco quando
-- detecta divergência, e já apagou dados reais uma vez. Ver README.
--
-- Esta migration só ADICIONA: uma tabela nova e uma coluna opcional. Nenhum
-- DROP, nenhuma coluna obrigatória em tabela com dados.

CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'SELECT', 'NUMBER', 'DATE');

CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "options" JSONB,
    "order" INTEGER NOT NULL,
    "showOnCard" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomField_order_idx" ON "CustomField"("order");

-- Opcional de propósito: os leads que já existem ficam sem valores, o que é
-- exatamente o estado correto para eles.
ALTER TABLE "Deal" ADD COLUMN "customValues" JSONB;
