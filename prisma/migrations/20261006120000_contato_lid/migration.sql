-- LID do contato: liga o identificador "@lid" do WhatsApp ao contato do
-- telefone, para a mesma pessoa não virar dois leads. Só adiciona uma coluna
-- (vazia) e um índice único; não mexe em nada existente. Revisado à mão.

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "lid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Contact_accountId_lid_key" ON "Contact"("accountId", "lid");

