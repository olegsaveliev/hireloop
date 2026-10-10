-- AlterTable
ALTER TABLE "pipeline" ADD COLUMN "followUpsPausedUntil" DATETIME;
ALTER TABLE "pipeline" ADD COLUMN "followUpsStopped" TEXT;
ALTER TABLE "pipeline" ADD COLUMN "outreachNote" TEXT;

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sequenceStep" INTEGER,
    "status" TEXT NOT NULL,
    "toEmail" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "footer" TEXT,
    "agentDraft" JSONB,
    "hooks" JSONB NOT NULL DEFAULT [],
    "previousMessageId" TEXT,
    "replyToId" TEXT,
    "rejectComment" TEXT,
    "classification" JSONB,
    "intent" TEXT,
    "classifierCorrect" BOOLEAN,
    "warning" TEXT,
    "agentRunIds" JSONB NOT NULL DEFAULT [],
    "traceId" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "messages_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "messages_jobId_candidateId_idx" ON "messages"("jobId", "candidateId");
