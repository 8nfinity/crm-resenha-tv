-- IA de atendimento: configuração, pausa por conversa e marca nas mensagens dela.

-- A IA sai da conversa quando alguém responde pelo celular, quando ela passa
-- para um humano, ou quando é pausada à mão.
ALTER TABLE "Deal" ADD COLUMN "iaMotivoPausa" TEXT,
ADD COLUMN "iaPausadaEm" TIMESTAMP(3);

-- Mensagens enviadas pela IA aparecem com 🤖 no painel do lead.
ALTER TABLE "Message" ADD COLUMN "porIA" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AgenteIA" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "pipelineId" TEXT,
    "nome" TEXT NOT NULL DEFAULT 'Lia',
    "modelo" TEXT NOT NULL DEFAULT 'claude-opus-5-5',
    "empresa" TEXT NOT NULL DEFAULT '',
    "qualificacao" TEXT NOT NULL DEFAULT '',
    "agenda" TEXT NOT NULL DEFAULT '',
    "regras" TEXT NOT NULL DEFAULT '',
    "colunaQualificadoId" TEXT,
    "colunaAgendadoId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgenteIA_pkey" PRIMARY KEY ("id")
);

-- Como as outras tabelas do CRM: invisível para a API pública do Supabase.
ALTER TABLE "AgenteIA" ENABLE ROW LEVEL SECURITY;
