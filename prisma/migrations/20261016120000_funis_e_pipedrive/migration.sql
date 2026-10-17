-- Vários funis (como no Pipedrive) e integração com o Pipedrive.
--
-- As colunas que já existem viram o "Funil principal": nenhum lead muda de
-- lugar e o histórico do funil continua o mesmo.

-- Funis
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Pipeline_order_key" ON "Pipeline"("order");

-- Como as outras tabelas do CRM: invisível para a API pública do Supabase.
-- O CRM conecta como dono do banco e não é afetado.
ALTER TABLE "Pipeline" ENABLE ROW LEVEL SECURITY;

INSERT INTO "Pipeline" ("id", "name", "order", "updatedAt")
VALUES ('funil_principal', 'Funil principal', 0, CURRENT_TIMESTAMP);

-- Colunas passam a pertencer a um funil. Primeiro todas vão para o principal,
-- depois a coluna vira obrigatória.
ALTER TABLE "Stage" ADD COLUMN "pipelineId" TEXT;
UPDATE "Stage" SET "pipelineId" = 'funil_principal';
ALTER TABLE "Stage" ALTER COLUMN "pipelineId" SET NOT NULL;

-- A ordem deixa de ser única no CRM inteiro: cada funil numera as suas.
DROP INDEX "Stage_order_key";
CREATE UNIQUE INDEX "Stage_pipelineId_order_key" ON "Stage"("pipelineId", "order");

ALTER TABLE "Stage" ADD CONSTRAINT "Stage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Funil de entrada de cada número de WhatsApp (nulo: o primeiro funil).
ALTER TABLE "WhatsAppAccount" ADD COLUMN "entryPipelineId" TEXT;
ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_entryPipelineId_fkey" FOREIGN KEY ("entryPipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pipedrive: o que foi criado lá para cada lead…
ALTER TABLE "Deal" ADD COLUMN "pipedriveDealId" INTEGER,
ADD COLUMN "pipedrivePersonId" INTEGER,
ADD COLUMN "pipedriveSentAt" TIMESTAMP(3);

-- …e a configuração da integração.
ALTER TABLE "SystemState" ADD COLUMN "pipedriveToken" TEXT,
ADD COLUMN "pipedriveDomain" TEXT,
ADD COLUMN "pipedrivePipelineId" INTEGER,
ADD COLUMN "pipedriveStageId" INTEGER,
ADD COLUMN "pipedriveAutoStageId" TEXT;
