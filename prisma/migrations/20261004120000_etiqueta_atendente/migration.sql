-- Etiqueta de vendedor vira etiqueta de ATENDENTE: ela só registra no
-- histórico do lead quem atendeu, sem atribuir o lead a ninguém. Os campos de
-- atribuição saem (nenhum lead chegou a usá-los). Revisado à mão.

-- DropForeignKey
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_ownerUserId_fkey";

-- DropForeignKey
ALTER TABLE "WhatsAppLabel" DROP CONSTRAINT "WhatsAppLabel_sellerUserId_fkey";

-- AlterTable
ALTER TABLE "Deal" DROP COLUMN "ownerName",
DROP COLUMN "ownerUserId";

-- AlterTable
ALTER TABLE "WhatsAppLabel" DROP COLUMN "sellerUserId";

