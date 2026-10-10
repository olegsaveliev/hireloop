// Step 5 tests (docs/specs/05-outreach-agent.md "Test cases" + "Acceptance criteria"). Real Sonnet/Haiku runs, ~$0.20.
//   1. Strong candidate -> personalized draft under 120 words
//   2. Reply "how much does it pay?" -> intent question, reply uses rate_range
//   3. Reply "please stop" -> not_interested, no more follow-ups
//   4. Out-of-office reply -> follow-ups paused
// Plus: all 5 seeded reply types, nothing sent without approval, reject -> redraft, bulk approve, edits score,
// no-email candidates, follow-up timing and the max of 2, recruiter correction of a classification, runaway stop.
// Test cases are kept in sync as Langfuse datasets "outreach-draft" and "reply-classifier".
// Run with: npm run test:phase3
import { config } from "dotenv";
config({ path: ".env.local" });

import type { JobSpecData } from "@/agents/job-spec/schema";

const SPEC: JobSpecData = {
  title: "Senior Python Engineer (Payments Reconciliation)",
  seniority: "senior",
  must_have: ["Python", "FastAPI or Django", "AWS (Lambda, SQS, RDS Postgres)", "Production on-call experience", "B2B contract"],
  nice_to_have: ["Terraform", "Fintech/payments background", "Kafka"],
  dealbreakers: ["No commercial AWS experience"],
  location: ["Remote from Poland or Ukraine", "~4h overlap with New York (until ~7pm CET)"],
  rate_range: "$55-65/hr",
  selling_points: ["12 months with extension", "Payments reconciliation platform used by US fintechs", "Fully remote"],
  open_questions: [],
};
// cand-001 strong fit; cand-002, cand-021 Python; cand-004 Ukrainian profile (Cyrillic name); cand-009 no email
// (its cached profile's email is removed for the test and put back at the end: every seed candidate has one now).
const CANDIDATES = ["cand-001", "cand-002", "cand-004", "cand-021", "cand-009"];
const REASON = "Meets the Python and AWS must-haves for this role (test fixture reason).";

const DATASETS = {
  draft: { name: "outreach-draft", description: "Step 5 outreach drafts: test cases from docs/specs/05-outreach-agent.md" },
  classifier: { name: "reply-classifier", description: "Step 5 reply classifier: seeded replies + test cases from docs/specs/05-outreach-agent.md" },
} as const;

async function main() {
  const { db } = await import("@/lib/db");
  const { runPipeline } = await import("@/agents/pipeline/workflow");
  const { runEnrichmentAgent } = await import("@/agents/enrichment/agent");
  const { runReplyClassifier, rateWarning } = await import("@/agents/outreach/agent");
  const { outreachDraftSchema, wordCount } = await import("@/agents/outreach/schema");
  const ow = await import("@/agents/outreach/workflow");
  const { send } = await import("@/agents/tools/mock-inbox");
  const { OPT_OUT_LINE } = await import("@/config/outreach");
  const { AGENT_BUDGETS } = await import("@/config/budgets");
  const { getTelemetry, flushTelemetry } = await import("@/agents/telemetry");
  const { langfuse } = getTelemetry();
  const startedAt = new Date();

  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
    if (!ok) failures++;
    return ok;
  };
  const runName = `test-phase3 ${new Date().toISOString().slice(0, 16)}`;
  const datasetRuns: { dataset: string; id: string; name: string; input: unknown; expected: string; traceId?: string | null; passed: boolean }[] = [];

  // ---------- unit checks (no AI) ----------
  console.log("\n--- Unit checks (no AI) ---");
  check("Rate check: amounts from rate_range are fine", rateWarning("The rate is $55-65/hr on a B2B contract.", "$55-65/hr") === null, "no warning");
  check("Rate check: other amounts are flagged", rateWarning("We can do $70/hr.", "$55-65/hr") !== null, `${rateWarning("We can do $70/hr.", "$55-65/hr")}`);
  check("Rate check: '15-minute call' is not money", rateWarning("Open to a 15-minute call?", null) === null, "no warning");
  const schema = outreachDraftSchema("Brightline Payments");
  const base = { candidate_id: "x", subject: "Senior Python role", body: "Hi Ann, short message.", personalization_hooks: ["Worked at X"], sequence_step: 1 };
  check("Draft check: valid draft passes", schema.safeParse(base).success, "ok");
  check("Draft check: client name rejected", !schema.safeParse({ ...base, body: "Hi Ann, Brightline is hiring." }).success, "Brightline in body");
  check("Draft check: 120+ words rejected", !schema.safeParse({ ...base, body: "word ".repeat(125) }).success, "125 words");
  check("Draft check: no hook rejected", !schema.safeParse({ ...base, personalization_hooks: [] }).success, "0 hooks");

  // ---------- test job: approved spec, shortlist approved ----------
  for (const id of CANDIDATES) {
    if (await db.candidateProfile.findUnique({ where: { candidateId: id } })) continue;
    const r = await runEnrichmentAgent({ candidateId: id, extraTags: ["test"] });
    if (!r.data) throw new Error(`Enrichment failed for ${id}: ${r.error}`);
    await db.candidateProfile.create({ data: { candidateId: id, data: r.data, missingCount: r.data.missing_fields.length, agentRunId: r.runs.at(-1)!.runId } });
  }
  const specRow = await db.jobSpec.create({
    data: { briefId: "brief-001", clientId: "client-brightline", status: "approved", agentDraft: SPEC, spec: SPEC, agentRunIds: [], decidedAt: new Date() },
  });
  const job = await db.job.create({ data: { jobSpecId: specRow.id, clientId: "client-brightline", title: `[test] ${SPEC.title}`, status: "drafting_outreach" } });
  const jobId = job.id;
  await db.pipelineEntry.createMany({ data: CANDIDATES.map((candidateId) => ({ jobId, candidateId, stage: "shortlisted", matchedOn: ["python"] })) });
  await db.screeningResult.createMany({ data: CANDIDATES.map((candidateId) => ({ jobId, candidateId, data: { candidate_id: candidateId, score: 80, must_have_met: [], must_have_missing: [], dealbreaker_hit: null, reasons: REASON, confidence: "medium" }, score: 80, confidence: "medium" })) });

  const msgs = (where: object = {}) => db.message.findMany({ where: { jobId, ...where }, orderBy: { createdAt: "asc" } });
  const entry = (candidateId: string) => db.pipelineEntry.findUniqueOrThrow({ where: { jobId_candidateId: { jobId, candidateId } } });
  const pendingFor = async (candidateId: string) => (await msgs({ candidateId, status: "awaiting_approval" }))[0];
  const profileOf = async (id: string) => (await db.candidateProfile.findUniqueOrThrow({ where: { candidateId: id } })).data as { job_history: { company: string }[]; recent_stack: string[]; key_facts: string[] };

  const p9 = await db.candidateProfile.findUniqueOrThrow({ where: { candidateId: "cand-009" } });
  const p9data = p9.data as { contacts: { email: string | null } };
  await db.candidateProfile.update({ where: { candidateId: "cand-009" }, data: { data: { ...p9data, contacts: { ...p9data.contacts, email: null } } } });

  try {
    // ---------- drafting ----------
    console.log("\n--- First messages (Sonnet) ---");
    const r = await runPipeline(jobId, { extraTags: ["test"] });
    const drafts = await msgs({ direction: "outbound" });
    const after = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    check("Pipeline: drafts written, job waits for approval", after.status === "outreach" && drafts.length === 4, `${r.message} ${drafts.length} drafts`);
    check("No email (cand-009): no draft, marked for manual contact", !drafts.some((d) => d.candidateId === "cand-009") && (await entry("cand-009")).outreachNote === ow.NO_EMAIL_NOTE, `${(await entry("cand-009")).outreachNote}`);
    check("AC2 Nothing sent before approval", (await msgs({ status: "sent" })).length === 0 && drafts.every((d) => d.status === "awaiting_approval"), `${drafts.map((d) => d.status).join(", ")}`);
    const item = await db.approvalItem.findFirst({ where: { jobId, kind: "outreach", status: "awaiting_approval" } });
    check("Approval queue: one 'Send outreach' item for the job", !!item, `${item?.title} / ${item?.detail}`);

    const specText = JSON.stringify(SPEC).toLowerCase();
    let allSpecific = true;
    for (const d of drafts) {
      const p = await profileOf(d.candidateId);
      const body = d.body.toLowerCase();
      const factWords = p.key_facts.flatMap((f) => f.toLowerCase().match(/[a-z][a-z0-9+#.-]{5,}/g) ?? []).filter((w) => !specText.includes(w));
      const specific = [
        ...p.job_history.map((j) => j.company.toLowerCase()),
        ...p.recent_stack.map((s) => s.toLowerCase()).filter((s) => !specText.includes(s)),
        ...factWords,
      ].filter((t) => t.length > 2 && body.includes(t));
      const words = wordCount(d.body);
      console.log(`      ${d.candidateId}: ${words} words, hooks: ${(d.hooks as string[]).join(" | ")}; specific: ${specific.slice(0, 3).join(", ")}`);
      allSpecific &&= specific.length > 0;
      check(`${d.candidateId}: under 120 words, opt-out line, no client name`, words < 120 && d.footer === OPT_OUT_LINE && !/brightline/i.test(d.subject + d.body), `${words} words`);
    }
    check("AC1 Drafts reference something specific from each profile", allSpecific, "company, recent stack or key fact found in every body");
    const d1 = drafts.find((d) => d.candidateId === "cand-001")!;
    const tc1 = check("TC1 Strong candidate -> personalized draft under 120 words", wordCount(d1.body) < 120 && (d1.hooks as string[]).length > 0, `${wordCount(d1.body)} words:\n${d1.subject}\n${d1.body}\n`);
    datasetRuns.push({ dataset: DATASETS.draft.name, id: "outreach-tc1-strong-candidate", name: "Strong candidate (cand-001)", input: { candidate_id: "cand-001", spec: SPEC }, expected: "Personalized draft under 120 words, a specific profile hook, no client name", traceId: d1.traceId, passed: tc1 });
    const d4 = drafts.find((d) => d.candidateId === "cand-004")!;
    check("Ukrainian profile (cand-004): English draft, name in Latin letters", !/[Ѐ-ӿ]/.test(d4.body), d4.body.split("\n")[0]);

    // ---------- approve / reject ----------
    console.log("\n--- Send approval ---");
    const d2 = drafts.find((d) => d.candidateId === "cand-002")!;
    const d21 = drafts.find((d) => d.candidateId === "cand-021")!;
    const a = await ow.approveDrafts([
      { messageId: d1.id, subject: d1.subject, body: d1.body },
      { messageId: d2.id, subject: d2.subject, body: `${d2.body}\n\nP.S. Edited by the recruiter.` },
      { messageId: d4.id, subject: d4.subject, body: d4.body },
    ]);
    const sent = await msgs({ status: "sent" });
    check("Bulk approve sends exactly the approved drafts", a.ok && sent.length === 3 && !sent.some((m) => m.id === d21.id), a.message);
    check("Sent -> stage contacted", (await entry("cand-001")).stage === "contacted" && (await entry("cand-021")).stage === "shortlisted", "cand-001 contacted, cand-021 still shortlisted");
    check("Recruiter edit saved in the sent message", (await db.message.findUniqueOrThrow({ where: { id: d2.id } })).body.includes("Edited by the recruiter"), "P.S. present");
    const again = await ow.approveDrafts([{ messageId: d1.id, subject: d1.subject, body: d1.body }]);
    check("Double approve doesn't send twice", !again.ok, again.message);

    const rj = await ow.rejectDraft(d21.id, "Mention that the role is fully remote and keep it under 60 words.", { extraTags: ["test"] });
    const redraft = await pendingFor("cand-021");
    const old = await db.message.findUniqueOrThrow({ where: { id: d21.id } });
    const redraftOk = check(
      "Reject -> old draft kept as rejected, agent redrafts with the comment",
      rj.ok && old.status === "rejected" && !!redraft && redraft.previousMessageId === d21.id && /remote/i.test(redraft.body) && wordCount(redraft.body) <= 70,
      `${rj.message} ${redraft ? `${wordCount(redraft.body)} words: ${redraft.body.replace(/\n/g, " ")}` : ""}`,
    );
    datasetRuns.push({ dataset: DATASETS.draft.name, id: "outreach-redraft-comment", name: "Redraft after reject comment (cand-021)", input: { comment: "Mention that the role is fully remote and keep it under 60 words." }, expected: "Mentions remote, about 60 words or fewer", traceId: redraft?.traceId, passed: redraftOk });
    check("Rejected draft can't be sent", !(await send(d21.id, { subject: "x", body: "y" })).ok, "send() refused");
    if (redraft) await ow.approveDrafts([{ messageId: redraft.id, subject: redraft.subject, body: redraft.body }]);
    check("Approval item closes when no drafts wait", !(await db.approvalItem.findFirst({ where: { jobId, kind: "outreach", status: "awaiting_approval" } })), "closed");

    // ---------- classifier on every seeded reply (AC3) ----------
    console.log("\n--- Reply classifier (Haiku) on all seeded replies ---");
    const seeds = await db.seedReply.findMany();
    const thread1 = `--- Recruiter (us), 2026-10-01, subject: ${d1.subject}\n${d1.body}`;
    let allRight = true;
    for (const s of seeds) {
      const c = await runReplyClassifier({ jobId, clientId: job.clientId, spec: SPEC, candidateId: "cand-001", fullName: "Andriy Kovalchuk", thread: `${thread1}\n\n--- Candidate, 2026-10-03\n${s.body}`, extraTags: ["test"] });
      const ok = c.data?.intent === s.intent;
      allRight &&= ok;
      console.log(`      ${s.id}: expected ${s.intent}, got ${c.data?.intent} (return_date ${c.data?.return_date}) · reply: ${c.data?.suggested_reply?.replace(/\n/g, " ").slice(0, 110) ?? "none"}`);
      datasetRuns.push({ dataset: DATASETS.classifier.name, id: `classifier-${s.id}`, name: `Seeded reply: ${s.intent}`, input: { reply: s.body }, expected: `intent ${s.intent}`, traceId: c.runs.at(-1)?.traceId, passed: ok });
      if (s.id === "reply-rate-question" && c.data) {
        const rep = c.data.suggested_reply ?? "";
        const tc2 = check("TC2 'How much does it pay?' -> question, reply uses rate_range only", c.data.intent === "question" && /55/.test(rep) && /65/.test(rep) && rateWarning(rep, SPEC.rate_range) === null, rep.replace(/\n/g, " "));
        // SPEC.must_have includes "B2B contract": confirming B2B is grounded, calling it employment is not.
        check("TC2 'B2B or employment?' answered from the spec (B2B), never 'employment'", !/\b(it is|it's) (an? )?employment\b/i.test(rep), "no invented contract type");
        datasetRuns.push({ dataset: DATASETS.classifier.name, id: "classifier-tc2-rate-question", name: "Rate question uses rate_range", input: { reply: s.body, rate_range: SPEC.rate_range }, expected: "intent question, suggested reply quotes $55-65/hr only", traceId: c.runs.at(-1)?.traceId, passed: tc2 });
      }
      if (s.id === "reply-out-of-office") check("Out of office: return date read", c.data?.return_date === "2026-10-20", `${c.data?.return_date}`);
      if (["reply-not-interested", "reply-out-of-office"].includes(s.id)) check(`${s.id}: no suggested reply`, c.data?.suggested_reply === null, `${c.data?.suggested_reply}`);
    }
    check("AC3 All seeded reply types classified correctly", allRight, `${seeds.length} replies`);

    // ---------- replies through the workflow + follow-ups ----------
    console.log("\n--- Replies and follow-ups ---");
    const none = await ow.runFollowUps(jobId, { extraTags: ["test"] });
    check("Follow-ups: none due right after sending", (await msgs({ kind: "follow_up" })).length === 0, none.message);

    const stop = await ow.receiveReply(jobId, "cand-002", "Please stop messaging me, I'm not interested.", { extraTags: ["test"] });
    const e2 = await entry("cand-002");
    const stopMsg = (await msgs({ candidateId: "cand-002", direction: "inbound" }))[0];
    const tc3a = check("TC3 'please stop' -> not_interested, stage declined, follow-ups stopped", stopMsg?.intent === "not_interested" && e2.stage === "declined" && !!e2.followUpsStopped, `${stop.message} ${e2.stage}, ${e2.followUpsStopped}`);
    check("TC3 no suggested reply to a 'stop'", !(await pendingFor("cand-002")), "no draft");

    const seedOoo = seeds.find((s) => s.intent === "out_of_office")!;
    const ooo = await ow.receiveReply(jobId, "cand-004", seedOoo.body, { extraTags: ["test"] });
    const e4 = await entry("cand-004");
    const tc4a = check("TC4 out of office -> stays contacted, follow-ups paused until 2026-10-20", e4.stage === "contacted" && e4.followUpsPausedUntil?.toISOString().slice(0, 10) === "2026-10-20", `${ooo.message} paused until ${e4.followUpsPausedUntil?.toISOString().slice(0, 10)}`);

    const fu = await ow.runFollowUps(jobId, { now: new Date(Date.now() + 3 * 24 * 3600_000), extraTags: ["test"] });
    const followUps = await msgs({ kind: "follow_up" });
    const fuFor = followUps.map((m) => m.candidateId).sort();
    check("Follow-ups (3 days later): drafted for cand-001 and cand-021 only", JSON.stringify(fuFor) === JSON.stringify(["cand-001", "cand-021"]) && followUps.every((m) => m.sequenceStep === 2 && m.status === "awaiting_approval"), `${fu.message} -> ${fuFor.join(", ")}`);
    const tc3 = check("TC3 no follow-up for the candidate who said stop", !fuFor.includes("cand-002"), fuFor.join(", "));
    const tc4 = check("TC4 no follow-up while out of office", !fuFor.includes("cand-004"), fuFor.join(", "));
    check("AC4 Follow-ups stop on 'not interested'", tc3a && tc3, "declined + skipped");
    datasetRuns.push({ dataset: DATASETS.classifier.name, id: "classifier-tc3-please-stop", name: "'Please stop' stops follow-ups", input: { reply: "Please stop messaging me, I'm not interested." }, expected: "not_interested, declined, no follow-ups", traceId: stopMsg?.traceId, passed: tc3a && tc3 });
    datasetRuns.push({ dataset: DATASETS.classifier.name, id: "classifier-tc4-out-of-office", name: "Out of office pauses follow-ups", input: { reply: seedOoo.body }, expected: "out_of_office, paused until 2026-10-20, no follow-up", traceId: (await msgs({ candidateId: "cand-004", direction: "inbound" }))[0]?.traceId, passed: tc4a && tc4 });
    const fu1 = followUps.find((m) => m.candidateId === "cand-001");
    if (fu1) console.log(`      follow-up for cand-001 (${wordCount(fu1.body)} words): ${fu1.body.replace(/\n/g, " ")}`);

    // Rate question through the workflow: cancels the pending follow-up, drafts a reply for approval.
    const q = await ow.receiveReply(jobId, "cand-001", "Sounds interesting. How much does it pay?", { extraTags: ["test"] });
    const fuAfter = fu1 ? await db.message.findUniqueOrThrow({ where: { id: fu1.id } }) : null;
    const replyDraft = await pendingFor("cand-001");
    check("Reply cancels the pending follow-up", fuAfter?.status === "cancelled", `${fuAfter?.status}`);
    check("Question -> stage replied, suggested reply waits for approval with the rate", (await entry("cand-001")).stage === "replied" && replyDraft?.kind === "reply" && /55/.test(replyDraft.body) && !replyDraft.warning, `${q.message} ${replyDraft?.body.replace(/\n/g, " ")}`);

    // Max 2 follow-ups (no AI): send cand-021's follow-up, age the thread, add a 2nd sent follow-up.
    const fu21 = followUps.find((m) => m.candidateId === "cand-021")!;
    await ow.approveDrafts([{ messageId: fu21.id, subject: fu21.subject, body: fu21.body }]);
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    await db.message.updateMany({ where: { jobId, candidateId: "cand-021", status: "sent" }, data: { sentAt: tenDaysAgo } });
    let s21 = (await ow.followUpStatus(jobId)).find((s) => s.candidateId === "cand-021")!;
    check("Follow-up 2 due after another 3 days", s21.due && s21.nextStep === 3, s21.reason);
    await db.message.create({ data: { jobId, candidateId: "cand-021", direction: "outbound", kind: "follow_up", sequenceStep: 3, status: "sent", toEmail: "x@example.com", subject: "Re: test", body: "Follow-up 2 (test fixture)", sentAt: tenDaysAgo } });
    s21 = (await ow.followUpStatus(jobId)).find((s) => s.candidateId === "cand-021")!;
    check("Max 2 follow-ups: no third one", !s21.due && /All 2/.test(s21.reason), s21.reason);

    // Recruiter checks the classifier.
    await ow.reviewClassification(stopMsg!.id, true);
    const oooMsg = (await msgs({ candidateId: "cand-004", direction: "inbound" }))[0];
    const corr = await ow.reviewClassification(oooMsg.id, false, "not_interested");
    check("Classification feedback: Correct saved; Wrong re-applies the rules", (await db.message.findUniqueOrThrow({ where: { id: stopMsg!.id } })).classifierCorrect === true && (await entry("cand-004")).stage === "declined", corr.message);

    // ---------- runaway: above 3x budget -> nothing saved, "Stopped: over budget" ----------
    console.log("\n--- Runaway ---");
    {
      await db.pipelineEntry.create({ data: { jobId, candidateId: "cand-005", stage: "shortlisted", matchedOn: ["test"] } });
      const budget = AGENT_BUDGETS["outreach-draft"];
      const original = budget.budgetUsd;
      budget.budgetUsd = 0.0001; // in memory only
      try {
        await db.job.update({ where: { id: jobId }, data: { status: "drafting_outreach" } });
        await runPipeline(jobId, { extraTags: ["test", "runaway"] });
        const stopped = await db.approvalItem.findFirst({ where: { jobId, kind: "stopped_run", step: 5 }, orderBy: { createdAt: "desc" } });
        check("Runaway: nothing saved, 'Stopped: over budget' in the queue", !(await msgs({ candidateId: "cand-005" })).length && stopped?.title === "Stopped: over budget", `${stopped?.title}: ${stopped?.detail}`);
      } finally {
        budget.budgetUsd = original;
      }
    }
  } finally {
    await db.candidateProfile.update({ where: { candidateId: "cand-009" }, data: { data: p9data } });
    // ---------- Langfuse datasets ----------
    // Items that the eval runner also uses are defined once in src/evals/datasets.ts (synced here); only the
    // state-dependent test cases are written from this script, marked eval: false (the eval runner skips them).
    const { EVALS, syncDataset } = await import("@/evals/datasets");
    for (const d of Object.values(DATASETS)) await syncDataset(langfuse, d.name);
    for (const r of datasetRuns) {
      if (!EVALS[r.dataset]?.items.some((i) => i.id === r.id)) {
        await langfuse.api.datasetItems.create({ datasetName: r.dataset, id: r.id, input: r.input, expectedOutput: r.expected, metadata: { test_case: r.name, eval: false } });
      }
      if (r.traceId) {
        await langfuse.api.datasetRunItems.create({ runName, datasetItemId: r.id, traceId: r.traceId });
        langfuse.score.create({ traceId: r.traceId, name: "test_passed", value: r.passed ? 1 : 0, comment: r.id });
      }
    }
    await flushTelemetry();

    // Remove the test rows (messages and pipeline go with the job; agent_runs keep their real cost).
    await db.approvalItem.deleteMany({ where: { jobId } });
    await db.agentRun.updateMany({ where: { jobId }, data: { jobId: null } });
    await db.job.delete({ where: { id: jobId } });
    await db.jobSpec.delete({ where: { id: specRow.id } });
  }

  const spent = await db.agentRun.groupBy({ by: ["agent"], where: { createdAt: { gte: startedAt } }, _sum: { costUsd: true }, _count: true });
  console.log("\nCost of this test run:");
  for (const s of spent) console.log(`  ${s.agent}: ${s._count} run(s), $${(s._sum.costUsd ?? 0).toFixed(4)}`);
  console.log(`  total: $${spent.reduce((n, s) => n + (s._sum.costUsd ?? 0), 0).toFixed(4)}`);
  console.log(`Langfuse datasets: ${Object.values(DATASETS).map((d) => d.name).join(", ")}; run "${runName}"`);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
