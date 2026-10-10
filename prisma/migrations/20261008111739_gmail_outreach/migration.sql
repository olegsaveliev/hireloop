-- AlterTable
ALTER TABLE "messages" ADD COLUMN "deliveredTo" TEXT;
ALTER TABLE "messages" ADD COLUMN "gmailMessageId" TEXT;
ALTER TABLE "messages" ADD COLUMN "gmailThreadId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "messages_gmailMessageId_key" ON "messages"("gmailMessageId");

-- CreateIndex
CREATE INDEX "messages_gmailThreadId_idx" ON "messages"("gmailThreadId");

