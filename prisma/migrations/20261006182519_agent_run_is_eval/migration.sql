-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_agent_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isEval" BOOLEAN NOT NULL DEFAULT false,
    "promptVersion" TEXT,
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
INSERT INTO "new_agent_runs" ("agent", "budgetUsd", "costUsd", "createdAt", "error", "id", "inputTokens", "jobId", "model", "numTurns", "outputTokens", "overBudget", "promptVersion", "status", "traceId", "traceUrl") SELECT "agent", "budgetUsd", "costUsd", "createdAt", "error", "id", "inputTokens", "jobId", "model", "numTurns", "outputTokens", "overBudget", "promptVersion", "status", "traceId", "traceUrl" FROM "agent_runs";
DROP TABLE "agent_runs";
ALTER TABLE "new_agent_runs" RENAME TO "agent_runs";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
