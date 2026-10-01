-- Etiqueta de vendedor, histórico de etiquetas, avisos por e-mail e PDF do playbook.
--
-- Só ADICIONA: colunas opcionais (ou com padrão) e duas tabelas novas.
-- Nenhum DROP, nada existente muda.

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "ownerUserId" TEXT;

-- AlterTable
ALTER TABLE "SystemState" ADD COLUMN     "lastDigestOn" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "WhatsAppLabel" ADD COLUMN     "isSeller" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sellerUserId" TEXT;

-- CreateTable
CREATE TABLE "LabelEvent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "labelName" TEXT NOT NULL,
    "labelColor" TEXT,
    "action" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybookFile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "text" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybookFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabelEvent_contactId_createdAt_idx" ON "LabelEvent"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "PlaybookFile_createdAt_idx" ON "PlaybookFile"("createdAt");

-- AddForeignKey
ALTER TABLE "WhatsAppLabel" ADD CONSTRAINT "WhatsAppLabel_sellerUserId_fkey" FOREIGN KEY ("sellerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelEvent" ADD CONSTRAINT "LabelEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookFile" ADD CONSTRAINT "PlaybookFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

