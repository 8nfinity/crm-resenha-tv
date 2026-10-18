-- Horário de atendimento da IA, cruzado com o calendário do CRM para
-- oferecer só horários livres.
ALTER TABLE "AgenteIA" ADD COLUMN "agendaDias" TEXT NOT NULL DEFAULT '1,2,3,4,5',
ADD COLUMN "agendaJanelas" TEXT NOT NULL DEFAULT '09:00-12:00,14:00-18:00',
ADD COLUMN "duracaoMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "antecedenciaMin" INTEGER NOT NULL DEFAULT 120;
