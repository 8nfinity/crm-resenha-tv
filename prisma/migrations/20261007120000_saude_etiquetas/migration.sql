-- Saúde das etiquetas: guarda o resultado da verificação da chave que abre
-- as etiquetas e listas do WhatsApp, uma linha do tempo da conexão (para ver
-- se a Evolution reiniciou e voltou sem os arquivos da sessão) e a marca de
-- etiqueta tirada do CRM à mão. Só adiciona colunas vazias e uma tabela nova;
-- não mexe em nada existente. Revisado à mão.

-- AlterTable
ALTER TABLE "WhatsAppAccount" ADD COLUMN     "labelKeyCheckedAt" TIMESTAMP(3),
ADD COLUMN     "labelKeyDetail" TEXT,
ADD COLUMN     "labelKeyStatus" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppLabel" ADD COLUMN     "removedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ConnectionEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectionEvent_accountId_createdAt_idx" ON "ConnectionEvent"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConnectionEvent" ADD CONSTRAINT "ConnectionEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

