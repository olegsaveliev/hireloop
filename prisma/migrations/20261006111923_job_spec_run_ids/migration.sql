/*
  Warnings:

  - You are about to drop the column `agentRunId` on the `job_specs` table. All the data in the column will be lost.
  - Added the required column `agentRunIds` to the `job_specs` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_job_specs" (
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
    "agentRunIds" JSONB NOT NULL,
    "traceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "job_specs_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "client_briefs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_job_specs" ("agentDraft", "agentNote", "answers", "briefId", "clientId", "createdAt", "decidedAt", "fieldsEdited", "id", "previousSpecId", "rejectComment", "roleCount", "roleIndex", "spec", "status", "traceId") SELECT "agentDraft", "agentNote", "answers", "briefId", "clientId", "createdAt", "decidedAt", "fieldsEdited", "id", "previousSpecId", "rejectComment", "roleCount", "roleIndex", "spec", "status", "traceId" FROM "job_specs";
DROP TABLE "job_specs";
ALTER TABLE "new_job_specs" RENAME TO "job_specs";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
