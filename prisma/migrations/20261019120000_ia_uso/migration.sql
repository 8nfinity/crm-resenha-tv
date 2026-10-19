-- Consumo de cada chamada da IA de atendimento (tokens e custo em dólar).
CREATE TABLE "IaUso" (
    "id" TEXT NOT NULL,
    "dealId" TEXT,
    "origem" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "custoUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IaUso_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IaUso_createdAt_idx" ON "IaUso"("createdAt");
CREATE INDEX "IaUso_dealId_idx" ON "IaUso"("dealId");

-- Como as outras tabelas do CRM: invisível para a API pública do Supabase.
ALTER TABLE "IaUso" ENABLE ROW LEVEL SECURITY;
