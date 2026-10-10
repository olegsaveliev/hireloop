// Loads all fictional seed data into the database. Safe to re-run: it replaces seed rows.
// Run with: npm run db:seed
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db";
import { toTestInbox } from "@/lib/test-inbox";
import { clients as seedClients, briefs as seedBriefs, pastJobs, seedReplies as seedReplyRows } from "./seed-data/clients";
import { specialCandidates } from "./seed-data/special-candidates";
import generatedCandidates from "./seed-data/generated-candidates.json";

// Seed addresses are placeholders (test.inbox+12@example.com). With a test inbox set (Keys menu or GOOGLE_TEST_INBOX
// in .env.local), they become yours (you+12@gmail.com), so emails to demo candidates and clients reach you.
async function main() {
  const saved = await db.setting.findUnique({ where: { key: "GOOGLE_TEST_INBOX" } }).catch(() => null);
  const inbox = saved?.value || process.env.GOOGLE_TEST_INBOX;
  const mine = <T,>(data: T): T => JSON.parse(toTestInbox(JSON.stringify(data), inbox));
  const clients = mine(seedClients);
  const briefs = mine(seedBriefs);
  const seedReplies = mine(seedReplyRows);

  // Order matters because of foreign keys.
  await db.clientBrief.deleteMany();
  await db.pastJob.deleteMany();
  await db.clientContact.deleteMany();
  await db.client.deleteMany();
  await db.candidate.deleteMany();
  await db.seedReply.deleteMany();

  for (const c of clients) {
    await db.client.create({ data: c });
  }
  for (const b of briefs) {
    await db.clientBrief.create({ data: { ...b, receivedAt: new Date(b.receivedAt) } });
  }
  for (const j of pastJobs) {
    await db.pastJob.create({ data: { ...j, closedAt: new Date(j.closedAt) } });
  }
  // `testCase` notes are for humans only and are not stored.
  const candidates = mine([
    ...specialCandidates.map(({ id, fullName, source, language, rawProfile }) => ({ id, fullName, source, language, rawProfile })),
    ...generatedCandidates,
  ]);
  for (const c of candidates) await db.candidate.create({ data: c });
  for (const r of seedReplies) await db.seedReply.create({ data: r });

  console.log(
    `Seeded ${clients.length} clients, ${briefs.length} briefs, ${pastJobs.length} past jobs, ` +
      `${candidates.length} candidates, ${seedReplies.length} replies.` +
      (inbox ? ` Demo addresses point at ${inbox.split(",")[0].trim()}.` : " Demo addresses are placeholders (no test inbox set)."),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
