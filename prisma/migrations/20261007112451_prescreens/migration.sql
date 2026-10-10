-- AlterTable
ALTER TABLE "approval_items" ADD COLUMN "candidateId" TEXT;

-- CreateTable
CREATE TABLE "prescreens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "questionsMessageId" TEXT,
    "questionsTraceId" TEXT,
    "data" JSONB,
    "recommendation" TEXT,
    "completeness" REAL,
    "answeredUpTo" DATETIME,
    "traceId" TEXT,
    "agentRunIds" JSONB NOT NULL DEFAULT [],
    "decision" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "prescreens_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "prescreens_jobId_candidateId_key" ON "prescreens"("jobId", "candidateId");
