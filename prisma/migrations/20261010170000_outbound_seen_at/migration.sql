-- The "New" tag now also covers emails we send (2026-10-10): the ones already sent count as seen.
UPDATE "messages" SET "seenAt" = COALESCE("sentAt", "createdAt") WHERE "direction" = 'outbound' AND "seenAt" IS NULL AND "status" = 'sent';
