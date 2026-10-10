-- CreateTable
CREATE TABLE "outcomes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "stageBefore" TEXT NOT NULL,
    "scoredTraces" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "outcomes_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "dataset_corrections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "jobId" TEXT,
    "candidateId" TEXT,
    "input" JSONB NOT NULL,
    "agentOutput" JSONB NOT NULL,
    "correctedOutput" JSONB NOT NULL,
    "expected" TEXT NOT NULL,
    "checkKind" TEXT,
    "checkValue" JSONB,
    "langfuseItemId" TEXT NOT NULL,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "weekly_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "correctionsAdded" INTEGER NOT NULL DEFAULT 0,
    "correctionsSynced" INTEGER NOT NULL DEFAULT 0,
    "evalResults" JSONB,
    "facts" JSONB,
    "summary" JSONB,
    "agentRunIds" JSONB NOT NULL DEFAULT [],
    "traceId" TEXT,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "outcomes_jobId_candidateId_key" ON "outcomes"("jobId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_corrections_source_sourceId_key" ON "dataset_corrections"("source", "sourceId");
