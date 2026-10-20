-- Responsável pelo lead e pela atividade.
ALTER TABLE "Deal" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "assignedToId" TEXT;

CREATE INDEX "Deal_ownerId_idx" ON "Deal"("ownerId");
CREATE INDEX "Activity_assignedToId_idx" ON "Activity"("assignedToId");

ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
