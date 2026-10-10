-- AlterTable
ALTER TABLE "approval_items" ADD COLUMN "inboundEmailId" TEXT;

-- CreateTable
CREATE TABLE "client_contacts" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "google_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "email" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT
);

-- CreateTable
CREATE TABLE "inbound_emails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentNames" JSONB NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "briefId" TEXT,
    "agentRunId" TEXT,
    "traceId" TEXT,
    "classifierWrong" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_client_briefs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "gmailThreadId" TEXT,
    "gmailMessageId" TEXT,
    "attachmentNames" JSONB,
    "updateCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "client_briefs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_client_briefs" ("body", "clientId", "fromEmail", "fromName", "id", "receivedAt", "subject") SELECT "body", "clientId", "fromEmail", "fromName", "id", "receivedAt", "subject" FROM "client_briefs";
DROP TABLE "client_briefs";
ALTER TABLE "new_client_briefs" RENAME TO "client_briefs";
CREATE INDEX "client_briefs_gmailThreadId_idx" ON "client_briefs"("gmailThreadId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "inbound_emails_gmailMessageId_key" ON "inbound_emails"("gmailMessageId");
