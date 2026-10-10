-- CreateTable
CREATE TABLE "interviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "candidateTz" TEXT,
    "clientTz" TEXT NOT NULL,
    "clientEmail" TEXT NOT NULL,
    "proposedSlots" JSONB NOT NULL DEFAULT [],
    "pastSlots" JSONB NOT NULL DEFAULT [],
    "chosenSlot" DATETIME,
    "confirmedSlot" DATETIME,
    "calendarEventIds" JSONB NOT NULL DEFAULT [],
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "messagesToConfirm" INTEGER NOT NULL DEFAULT 0,
    "escalationReason" TEXT,
    "lastSentAt" DATETIME,
    "nudgedAt" DATETIME,
    "reminderSentAt" DATETIME,
    "traceId" TEXT,
    "agentRunIds" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "interviews_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "person" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "interviewId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "interviews_jobId_candidateId_key" ON "interviews"("jobId", "candidateId");

-- CreateIndex
CREATE INDEX "calendar_events_person_idx" ON "calendar_events"("person");
