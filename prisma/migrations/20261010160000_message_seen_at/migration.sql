-- "New" tag on the Job page's Candidate / Client tabs: inbound emails not opened yet.
ALTER TABLE "messages" ADD COLUMN "seenAt" DATETIME;

-- Emails that arrived before this change count as seen.
UPDATE "messages" SET "seenAt" = COALESCE("sentAt", "createdAt") WHERE "direction" = 'inbound';
