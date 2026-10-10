// Removes data left behind by an automated test that was stopped before its own cleanup ran: jobs titled
// "[test] ..." (with their specs, messages, pipeline, interviews, queue items) and briefs "brief-test-*". Your real data
// is never touched; agent runs stay (cost history). Run with: npm run cleanup:test
import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const { db } = await import("@/lib/db");
  const jobs = await db.job.findMany({ where: { title: { startsWith: "[test] " } }, include: { jobSpec: true } });
  const ids = jobs.map((j) => j.id);
  const ivs = await db.interview.findMany({ where: { jobId: { in: ids } }, select: { id: true } });
  await db.calendarEvent.deleteMany({ where: { interviewId: { in: ivs.map((x) => x.id) } } });
  await db.approvalItem.deleteMany({ where: { jobId: { in: ids } } });
  await db.agentRun.updateMany({ where: { jobId: { in: ids } }, data: { jobId: null } });
  for (const j of jobs) {
    await db.job.delete({ where: { id: j.id } });
    await db.jobSpec.delete({ where: { id: j.jobSpecId } });
  }
  const b = await db.clientBrief.deleteMany({ where: { subject: { startsWith: "[test] " }, id: { startsWith: "brief-test-" } } });
  console.log(`removed ${jobs.length} test jobs (${jobs.map((j) => j.title).join(", ")}), ${b.count} test briefs`);
  await db.$disconnect();
}
main();
