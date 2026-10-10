-- CreateTable
CREATE TABLE "job_specs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "briefId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "roleIndex" INTEGER NOT NULL DEFAULT 0,
    "roleCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "agentDraft" JSONB NOT NULL,
    "spec" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT [],
    "agentNote" TEXT,
    "previousSpecId" TEXT,
    "rejectComment" TEXT,
    "fieldsEdited" INTEGER,
    "agentRunId" TEXT NOT NULL,
    "traceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "job_specs_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "client_briefs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobSpecId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jobs_jobSpecId_fkey" FOREIGN KEY ("jobSpecId") REFERENCES "job_specs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approval_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "clientId" TEXT,
    "briefId" TEXT,
    "jobSpecId" TEXT,
    "jobId" TEXT,
    "agentRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_jobSpecId_key" ON "jobs"("jobSpecId");

-- CreateIndex
CREATE INDEX "approval_items_status_idx" ON "approval_items"("status");
