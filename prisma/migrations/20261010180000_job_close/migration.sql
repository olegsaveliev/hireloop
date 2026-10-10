-- "Close position" on the Job page: when, why, a note, and the status to restore on Reopen.
ALTER TABLE "jobs" ADD COLUMN "closedAt" DATETIME;
ALTER TABLE "jobs" ADD COLUMN "closeReason" TEXT;
ALTER TABLE "jobs" ADD COLUMN "closeNote" TEXT;
ALTER TABLE "jobs" ADD COLUMN "statusBeforeClose" TEXT;
