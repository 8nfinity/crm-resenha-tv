-- CreateTable
CREATE TABLE "WhatsAppLabel" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "stageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppLabel_accountId_idx" ON "WhatsAppLabel"("accountId");

-- CreateIndex
CREATE INDEX "WhatsAppLabel_stageId_idx" ON "WhatsAppLabel"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppLabel_accountId_labelId_key" ON "WhatsAppLabel"("accountId", "labelId");

-- AddForeignKey
ALTER TABLE "WhatsAppLabel" ADD CONSTRAINT "WhatsAppLabel_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppLabel" ADD CONSTRAINT "WhatsAppLabel_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
