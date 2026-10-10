-- AlterTable
ALTER TABLE "job_specs" ADD COLUMN "editedAfterApprovalAt" DATETIME;

-- CreateTable
CREATE TABLE "pipeline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "matchedOn" JSONB NOT NULL,
    "sourcingRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pipeline_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "candidate_profiles" (
    "candidateId" TEXT NOT NULL PRIMARY KEY,
    "data" JSONB NOT NULL,
    "missingCount" INTEGER NOT NULL,
    "agentRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "screening_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "filteredOut" BOOLEAN NOT NULL DEFAULT false,
    "filterReason" TEXT,
    "data" JSONB,
    "score" INTEGER,
    "confidence" TEXT,
    "overrideScore" INTEGER,
    "overrideNote" TEXT,
    "agentRunId" TEXT,
    "traceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "screening_results_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobSpecId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "pipelineNote" TEXT,
    "pipelineUpdatedAt" DATETIME,
    "extraBudgetUsd" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jobs_jobSpecId_fkey" FOREIGN KEY ("jobSpecId") REFERENCES "job_specs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_jobs" ("clientId", "createdAt", "id", "jobSpecId", "status", "title") SELECT "clientId", "createdAt", "id", "jobSpecId", "status", "title" FROM "jobs";
DROP TABLE "jobs";
ALTER TABLE "new_jobs" RENAME TO "jobs";
CREATE UNIQUE INDEX "jobs_jobSpecId_key" ON "jobs"("jobSpecId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_jobId_candidateId_key" ON "pipeline"("jobId", "candidateId");

-- CreateIndex
CREATE INDEX "screening_results_jobId_current_idx" ON "screening_results"("jobId", "current");
