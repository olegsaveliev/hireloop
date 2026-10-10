-- AlterTable
ALTER TABLE "prescreens" ADD COLUMN "confirmedRate" TEXT;
ALTER TABLE "prescreens" ADD COLUMN "submissionStartedAt" DATETIME;

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "anonymized" BOOLEAN NOT NULL,
    "format" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "agentDraft" JSONB NOT NULL,
    "previousSubmissionId" TEXT,
    "rejectComment" TEXT,
    "messageId" TEXT,
    "agentRunIds" JSONB NOT NULL DEFAULT [],
    "traceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "submissions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "submissions_jobId_candidateId_idx" ON "submissions"("jobId", "candidateId");
