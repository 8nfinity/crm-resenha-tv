-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'LOCATION', 'CONTACT', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('FOLLOW_UP', 'MEETING', 'CALL', 'PROPOSAL', 'OTHER');

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "waJid" TEXT NOT NULL,
    "phone" TEXT,
    "pushName" TEXT,
    "savedName" TEXT,
    "profilePicUrl" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "isBusiness" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "title" TEXT,
    "value" DECIMAL(12,2),
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreFactors" JSONB,
    "scoreUpdatedAt" TIMESTAMP(3),
    "enteredStageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInteractionAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageTransition" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hoursInFrom" DOUBLE PRECISION,

    CONSTRAINT "StageTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "fromMe" BOOLEAN NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "title" TEXT,
    "notes" TEXT,
    "dueAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "instanceName" TEXT,
    "connectionStatus" TEXT NOT NULL DEFAULT 'disconnected',
    "connectedNumber" TEXT,
    "lastImportAt" TIMESTAMP(3),
    "lastImportSummary" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_waJid_key" ON "Contact"("waJid");

-- CreateIndex
CREATE INDEX "Contact_phone_idx" ON "Contact"("phone");

-- CreateIndex
CREATE INDEX "Contact_isGroup_idx" ON "Contact"("isGroup");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_order_key" ON "Stage"("order");

-- CreateIndex
CREATE INDEX "Stage_order_idx" ON "Stage"("order");

-- CreateIndex
CREATE INDEX "Deal_stageId_score_idx" ON "Deal"("stageId", "score");

-- CreateIndex
CREATE INDEX "Deal_lastInboundAt_idx" ON "Deal"("lastInboundAt");

-- CreateIndex
CREATE INDEX "Deal_archivedAt_idx" ON "Deal"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_contactId_key" ON "Deal"("contactId");

-- CreateIndex
CREATE INDEX "StageTransition_dealId_at_idx" ON "StageTransition"("dealId", "at");

-- CreateIndex
CREATE INDEX "StageTransition_toStageId_at_idx" ON "StageTransition"("toStageId", "at");

-- CreateIndex
CREATE INDEX "StageTransition_at_idx" ON "StageTransition"("at");

-- CreateIndex
CREATE UNIQUE INDEX "Message_waMessageId_key" ON "Message"("waMessageId");

-- CreateIndex
CREATE INDEX "Message_contactId_timestamp_idx" ON "Message"("contactId", "timestamp");

-- CreateIndex
CREATE INDEX "Message_timestamp_idx" ON "Message"("timestamp");

-- CreateIndex
CREATE INDEX "Message_fromMe_idx" ON "Message"("fromMe");

-- CreateIndex
CREATE INDEX "Activity_dealId_createdAt_idx" ON "Activity"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_type_doneAt_idx" ON "Activity"("type", "doneAt");

-- CreateIndex
CREATE INDEX "Activity_dueAt_idx" ON "Activity"("dueAt");

-- CreateIndex
CREATE INDEX "Note_dealId_createdAt_idx" ON "Note"("dealId", "createdAt");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageTransition" ADD CONSTRAINT "StageTransition_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageTransition" ADD CONSTRAINT "StageTransition_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageTransition" ADD CONSTRAINT "StageTransition_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "Stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
