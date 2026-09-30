-- Suporte a vários números de WhatsApp no mesmo CRM.
--
-- Escrita à mão porque o banco já tem dados: 2155 contatos e as conversas
-- deles. Uma migration gerada automaticamente exigiria apagar tudo para
-- adicionar a coluna obrigatória. Aqui criamos a conta atual primeiro e
-- religamos os registros existentes a ela.

-- 1. A tabela de contas.
CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "label" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "color" TEXT NOT NULL DEFAULT '#25d366',
    "lastImportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppAccount_instanceName_key" ON "WhatsAppAccount"("instanceName");
CREATE INDEX "WhatsAppAccount_status_idx" ON "WhatsAppAccount"("status");

-- 2. A conta que já existia. O nome "crm" vem de EVOLUTION_INSTANCE, que era
--    a única instância antes desta mudança.
INSERT INTO "WhatsAppAccount" ("id", "instanceName", "label", "status", "createdAt", "updatedAt")
SELECT
    'acc_' || substr(md5(random()::text), 1, 21),
    'crm',
    'Principal',
    COALESCE((SELECT "connectionStatus" FROM "SystemState" LIMIT 1), 'disconnected'),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "WhatsAppAccount" WHERE "instanceName" = 'crm');

-- 3. Coluna nova, primeiro opcional para os registros existentes caberem.
ALTER TABLE "Contact" ADD COLUMN "accountId" TEXT;

-- 4. Todo contato que já existia pertence à conta que já existia.
UPDATE "Contact"
SET "accountId" = (SELECT "id" FROM "WhatsAppAccount" WHERE "instanceName" = 'crm')
WHERE "accountId" IS NULL;

-- 5. Agora sim obrigatória.
ALTER TABLE "Contact" ALTER COLUMN "accountId" SET NOT NULL;

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Contact_accountId_idx" ON "Contact"("accountId");

-- 6. A unicidade do JID passa a ser por conta: a mesma pessoa pode falar com
--    dois números seus, e aí são dois leads distintos de propósito.
DROP INDEX "Contact_waJid_key";
CREATE UNIQUE INDEX "Contact_accountId_waJid_key" ON "Contact"("accountId", "waJid");

-- 7. Mesma lógica nas mensagens. Sendo o identificador único globalmente, uma
--    mensagem com o mesmo id chegando por outra conta seria descartada como
--    duplicata e sumiria sem deixar rastro.
DROP INDEX "Message_waMessageId_key";
CREATE UNIQUE INDEX "Message_contactId_waMessageId_key" ON "Message"("contactId", "waMessageId");

-- 8. O estado de conexão agora vive por conta. Um status global não significa
--    nada quando há vários números conectados.
ALTER TABLE "SystemState" DROP COLUMN "connectionStatus";
ALTER TABLE "SystemState" DROP COLUMN "instanceName";
ALTER TABLE "SystemState" DROP COLUMN "connectedNumber";
