-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "submissionFormat" JSONB
);

-- CreateTable
CREATE TABLE "client_briefs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    CONSTRAINT "client_briefs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "past_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seniority" TEXT NOT NULL,
    "stack" JSONB NOT NULL,
    "rateRange" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "closedAt" DATETIME NOT NULL,
    CONSTRAINT "past_jobs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "rawProfile" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "seed_replies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intent" TEXT NOT NULL,
    "body" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "jobId" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "budgetUsd" REAL NOT NULL,
    "numTurns" INTEGER NOT NULL DEFAULT 0,
    "overBudget" BOOLEAN NOT NULL DEFAULT false,
    "traceId" TEXT,
    "traceUrl" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
