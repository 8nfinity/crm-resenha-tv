-- Cadastro manual de lead (e-mail, empresa, origem) e a opção de só deixar
-- entrar no CRM os contatos etiquetados no celular.
ALTER TABLE "Contact" ADD COLUMN "email" TEXT,
ADD COLUMN "empresa" TEXT;

ALTER TABLE "Deal" ADD COLUMN "origem" TEXT;

ALTER TABLE "WhatsAppAccount" ADD COLUMN "soComEtiqueta" BOOLEAN NOT NULL DEFAULT false;
