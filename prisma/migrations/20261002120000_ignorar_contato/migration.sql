-- Etiqueta de "ignorar contato".
--
-- Só ADICIONA: uma coluna opcional em Contact e um booleano com padrão
-- em WhatsAppLabel. Nada existente muda.

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "ignoredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WhatsAppLabel" ADD COLUMN     "ignoreContact" BOOLEAN NOT NULL DEFAULT false;

