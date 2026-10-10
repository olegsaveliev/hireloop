// Step 9 tests (docs/specs/09-feedback-loop.md "Test cases" + "Acceptance criteria"). Real runs: 1 Opus screening, 1-2
// eval items, 1 Sonnet weekly summary, ~$0.06.
//   1. Hired candidate -> final_outcome = 1 on their screening trace (read back from Langfuse)
//   2. Recruiter override in Step 4 -> new item in the screening-agent dataset (read back from Langfuse)
// Acceptance: an outcome shows up as a score on earlier traces; each agent has a dataset with 5+ items; two prompt
// versions can be compared on one dataset (eval runs are named after the prompt version).
// Plus: the protected-attribute guardrail on reasons, outcomes that don't fit the stage, changing an outcome (one
// score, new value), withdrawing cleans up (interview cancelled, calendar freed, drafts and queue items closed),
// replies after an outcome aren't read by any agent, every kind of correction collected once, corrections run by the
// eval, the weekly job + summary checks, the job funnel.
// Run with: npm run test:step9 (also part of npm run test:phase5)
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
// cand-001 hired (real screening run), cand-021 rejected by client, cand-004 withdraws with a booked interview,
// cand-002 only contacted (no outcome possible; its reply was misclassified and a draft edited).
const CANDIDATES = ["cand-001", "cand-021", "cand-004", "cand-002"];

async function main() {
  const { db } = await import("@/lib/db");
  const { runEnrichmentAgent } = await import("@/agents/enrichment/agent");
  const { runScreeningAgent } = await import("@/agents/screening/agent");
  const { recordOutcome, checkReason } = await import("@/agents/feedback/outcomes");
  const { collectCorrections, correctionCheck } = await import("@/agents/feedback/corrections");
  const { weeklySummarySchema } = await import("@/agents/feedback/schema");
  const { startWeeklyReport, runWeeklyJob } = await import("@/agents/feedback/weekly");
  const { protectedInReason } = await import("@/config/feedback");
  const { AGENT_BUDGETS } = await import("@/config/budgets");
  const { EVALS, syncDataset } = await import("@/evals/datasets");
  const { runEval } = await import("@/evals/run");
  const { promptVersion } = await import("@/agents/run-agent");
  const { loadPrompt } = await import("@/agents/prompts");
  const ow = await import("@/agents/outreach/workflow");
  const { jobProgress } = await import("@/lib/job-progress");
  const { fetchScores } = await import("@/agents/langfuse-read");
  const { getTelemetry, flushTelemetry } = await import("@/agents/telemetry");
  const { startActiveObservation, propagateAttributes } = await import("@langfuse/tracing");
  const { context, ROOT_CONTEXT } = await import("@opentelemetry/api");
  const { langfuse } = getTelemetry();
  const startedAt = new Date();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
    if (!ok) failures++;
    return ok;
  };
  const passedOn: { traceId: string | null; id: string; passed: boolean }[] = [];
  // A trace with no model call, standing in for an earlier agent's trace (pre-screen, submission).
  const traceOnly = (name: string) =>
    context.with(ROOT_CONTEXT, () => startActiveObservation(name, async (span) => propagateAttributes({ traceName: name, tags: ["test", "step-9"] }, async () => span.traceId)));
  // Langfuse needs a few seconds to ingest scores; poll until `ok` or ~90s.
  const scoresOn = async (traceId: string, ok: (s: { name: string; value: number }[]) => boolean) => {
    let s: Awaited<ReturnType<typeof fetchScores>> = [];
    for (let i = 0; i < 18; i++) {
      s = (await fetchScores({ traceId })).filter((x) => x.name === "final_outcome");
      if (ok(s)) break;
      await sleep(5000);
    }
    return s;
  };

  // ---------- unit checks (no AI) ----------
  console.log("\n--- Unit checks (no AI) ---");
  const bad = ["Too old for this team", "She is pregnant", "Married with two kids, can't travel", "Client prefers a different nationality", "Religious holidays clash", "Female candidate, client wanted someone else", "Has a disability"];
  check("Guardrail: protected attributes in reasons are caught", bad.every((r) => protectedInReason(r).length > 0), bad.map((r) => `${r} -> ${protectedInReason(r).join("/")}`).join("; "));
  const fine = ["Accepted another offer", "He accepted a counter-offer from his employer", "System design round was weak", "Rate too high for the client's budget", "Relocated to Berlin and wants on-site work", "Found race conditions hard in the live coding"];
  check("Guardrail: no false alarms on job-related reasons", fine.every((r) => protectedInReason(r).length === 0), fine.filter((r) => protectedInReason(r).length).join("; ") || "6 of 6 fine");
  check("Reason required", !!checkReason("  ") && !checkReason("Accepted another offer"), `${checkReason("  ")}`);
  const facts = [
    { id: "C1", kind: "correction", agent: "reply-classifier", text: "x" },
    { id: "C2", kind: "correction", agent: "reply-classifier", text: "y" },
    { id: "C3", kind: "correction", agent: "screening-agent", text: "z" },
  ];
  const sch = weeklySummarySchema(facts);
  const good = { headline: "Classifier mistakes", issues: [{ agent: "reply-classifier", what_went_wrong: "a", evidence: ["C1", "C2"], suggestion: "b" }, { agent: "screening-agent", what_went_wrong: "c", evidence: ["C3"], suggestion: "d" }], going_well: [], open_questions: [] };
  check("Summary schema: valid summary passes", sch.safeParse(good).success, "ok");
  check("Summary schema: invented fact id rejected", !sch.safeParse({ ...good, issues: [{ ...good.issues[0], evidence: ["C1", "C9"] }] }).success, "C9");
  check("Summary schema: smaller issue first rejected", !sch.safeParse({ ...good, issues: [good.issues[1], good.issues[0]] }).success, "1 then 2 facts");
  check("Summary schema: unknown agent rejected", !sch.safeParse({ ...good, issues: [{ ...good.issues[0], agent: "hr-agent" }] }).success, "hr-agent");
  check("Summary schema: protected attribute rejected", !sch.safeParse({ ...good, headline: "Candidates who are married decline more" }).success, "married");
  const within = correctionCheck({ checkKind: "score_within", checkValue: 80 })!;
  const intent = correctionCheck({ checkKind: "intent_is", checkValue: "interested" })!;
  check("Correction checks: score within +/-10, right intent", within({ score: 72 }).passed && !within({ score: 65 }).passed && intent({ intent: "interested" }).passed && !intent({ intent: "question" }).passed, "72 ok, 65 fail; interested ok, question fail");
  const v1 = promptVersion(await loadPrompt("feedback-weekly-summary"));
  check("AC3 prompt version changes with the prompt (eval runs are named after it, so two versions show side by side)", v1 !== promptVersion(`${await loadPrompt("feedback-weekly-summary")}\nBe brief.`), v1);
  // AC2 in Langfuse: eval items (src/evals/datasets.ts) + state-dependent test items (test:* scripts) + corrections.
  const agentsWithBudgets = Object.keys(AGENT_BUDGETS).filter((a) => a !== "connection-test");
  const sizes = await Promise.all(agentsWithBudgets.map(async (a) => ({ a, n: EVALS[a] ? (await langfuse.api.datasetItems.list({ datasetName: a, limit: 100 }).catch(() => ({ data: [] }))).data.length : 0 })));
  const small = sizes.filter((x) => x.n < 5);
  check("AC2 every agent has a Langfuse dataset with 5+ items", small.length === 0, sizes.map((x) => `${x.a} ${x.n}`).join(", "));

  // ---------- test job ----------
  for (const id of CANDIDATES) {
    if (await db.candidateProfile.findUnique({ where: { candidateId: id } })) continue;
    const r = await runEnrichmentAgent({ candidateId: id, extraTags: ["test"] });
    if (!r.data) throw new Error(`Enrichment failed for ${id}: ${r.error}`);
    await db.candidateProfile.create({ data: { candidateId: id, data: r.data, missingCount: r.data.missing_fields.length, agentRunId: r.runs.at(-1)!.runId } });
  }
  // The recruiter filled in the rate when approving the spec (a Step 1 correction).
  const specRow = await db.jobSpec.create({
    data: { briefId: "brief-001", clientId: "client-brightline", status: "approved", agentDraft: { ...SPEC, rate_range: null }, spec: SPEC, fieldsEdited: 1, agentRunIds: [], decidedAt: new Date() },
  });
  const job = await db.job.create({ data: { jobSpecId: specRow.id, clientId: "client-brightline", title: `[test] ${SPEC.title}`, status: "outreach" } });
  const jobId = job.id;
  const stages: Record<string, string> = { "cand-001": "interview", "cand-021": "submitted", "cand-004": "interview", "cand-002": "contacted" };
  await db.pipelineEntry.createMany({ data: CANDIDATES.map((candidateId) => ({ jobId, candidateId, stage: stages[candidateId], matchedOn: ["python"] })) });
  const entry = (candidateId: string) => db.pipelineEntry.findUniqueOrThrow({ where: { jobId_candidateId: { jobId, candidateId } } });
  const outcomeOf = (candidateId: string) => db.outcome.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
  let reportId: string | null = null;

  try {
    // Earlier steps' traces. cand-001: a real screening run (Opus), then the recruiter raised the score a little.
    console.log("\n--- Setup: screening run (Opus) and earlier steps' rows ---");
    const profile1 = (await db.candidateProfile.findUniqueOrThrow({ where: { candidateId: "cand-001" } })).data as never;
    const s1 = await runScreeningAgent({ jobId, clientId: "client-brightline", spec: SPEC, profile: profile1, extraTags: ["test"] });
    if (!s1.data) throw new Error(`Screening failed: ${s1.error}`);
    const override = Math.min(100, s1.data.score + 5);
    const sr1 = await db.screeningResult.create({
      data: { jobId, candidateId: "cand-001", data: s1.data, score: s1.data.score, confidence: s1.data.confidence, overrideScore: override, overrideNote: "Strong on-call record", agentRunId: s1.runs.at(-1)!.runId, traceId: s1.runs.at(-1)!.traceId },
    });
    const screeningTrace = sr1.traceId!;
    const pre1 = await traceOnly("prescreen-agent");
    const sub1 = await traceOnly("submission-agent");
    const sub21 = await traceOnly("submission-agent");
    await db.prescreen.create({ data: { jobId, candidateId: "cand-001", status: "summarized", questions: [], recommendation: "proceed", decision: "submit", traceId: pre1 } });
    await db.prescreen.create({ data: { jobId, candidateId: "cand-021", status: "summarized", questions: [], recommendation: "stop", decision: "submit", data: { recommendation: "stop", summary: "Rate far above range." } } });
    const draft = { summary: "Senior Python engineer", skills: ["Python"] };
    await db.submission.create({ data: { jobId, candidateId: "cand-001", clientId: "client-brightline", status: "sent", anonymized: false, format: {}, data: draft, agentDraft: draft, traceId: sub1, decidedAt: new Date() } });
    await db.submission.create({ data: { jobId, candidateId: "cand-021", clientId: "client-brightline", status: "sent", anonymized: false, format: {}, data: { ...draft, summary: "Middle Python engineer, strong FastAPI" }, agentDraft: draft, traceId: sub21, decidedAt: new Date() } });
    // cand-004: a booked interview next week, an open queue item and an unsent draft.
    const slot = new Date(Date.now() + 5 * 86400000);
    const iv4 = await db.interview.create({ data: { jobId, candidateId: "cand-004", clientId: "client-brightline", submissionId: "x", status: "confirmed", candidateTz: "Europe/Kyiv", clientTz: "America/New_York", clientEmail: "t@brightline.example", confirmedSlot: slot } });
    const ev = await Promise.all(["cand-004", "t@brightline.example"].map((person) => db.calendarEvent.create({ data: { person, startsAt: slot, endsAt: new Date(slot.getTime() + 3600_000), title: "[test] interview", interviewId: iv4.id } })));
    await db.interview.update({ where: { id: iv4.id }, data: { calendarEventIds: ev.map((e) => e.id) } });
    await db.approvalItem.create({ data: { kind: "scheduling", step: 8, status: "awaiting_approval", title: "[test] Scheduling needs you", jobId, candidateId: "cand-004" } });
    // Threads: a first message to everyone; cand-002's was edited before sending, and its reply was misclassified.
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
    for (const candidateId of CANDIDATES) {
      const edited = candidateId === "cand-002";
      await db.message.create({
        data: {
          jobId, candidateId, direction: "outbound", kind: "first", sequenceStep: 1, status: "sent", toEmail: "x@mail.example",
          subject: "Senior Python role: payments reconciliation, fully remote",
          body: edited ? "Hi, a Senior Python role on a payments platform, fully remote, 12 months. Open to a short call?" : "Hi, a Senior Python role on a payments platform, fully remote. Open to a short call?",
          agentDraft: { subject: "Senior Python role: payments reconciliation, fully remote", body: "Hi, a Senior Python role on a payments platform, fully remote. Open to a short call?" },
          sentAt: twoDaysAgo,
        },
      });
    }
    await db.message.create({ data: { jobId, candidateId: "cand-004", direction: "outbound", kind: "reply", status: "awaiting_approval", toEmail: "x@mail.example", subject: "Re: role", body: "[test] unsent draft" } });
    const wrongReply = await db.message.create({
      data: {
        jobId, candidateId: "cand-002", direction: "inbound", kind: "inbound", status: "received", subject: "Re: role", body: "Sounds great, I'm in. What's the rate?", sentAt: new Date(Date.now() - 86400000),
        classification: { candidate_id: "cand-002", intent: "question", return_date: null, suggested_reply: null, summary: "Asks about rate" }, intent: "interested", classifierCorrect: false,
      },
    });
    console.log(`cand-001 screened ${s1.data.score} (recruiter override ${override})`);

    // ---------- outcomes ----------
    console.log("\n--- Outcomes (no AI) ---");
    const notFit = await recordOutcome(jobId, "cand-002", "hired", "Great fit");
    const notFit2 = await recordOutcome(jobId, "cand-021", "hired", "Great fit");
    check("Outcome must fit the stage: contacted can't be hired, submitted can't be hired", !notFit.ok && !notFit2.ok && !(await outcomeOf("cand-002")) && !(await outcomeOf("cand-021")), `${notFit.message} | ${notFit2.message}`);
    const blocked = await recordOutcome(jobId, "cand-004", "withdrew", "Too old to keep up with the team");
    check("Guardrail: reason with a protected attribute is blocked, nothing saved", !blocked.ok && !(await outcomeOf("cand-004")) && (await entry("cand-004")).stage === "interview", blocked.message);

    // TC1, with a change of mind first: rejected -> hired. Fixed score ids: one score per trace, the latest value.
    const r1 = await recordOutcome(jobId, "cand-001", "rejected_by_client", "Client wanted more Kafka");
    const r2 = await recordOutcome(jobId, "cand-001", "hired", "Strong system design round, client signed");
    const o1 = await outcomeOf("cand-001");
    check("Hired recorded: outcome row, stage hired, 3 earlier traces scored", r1.ok && r2.ok && o1?.outcome === "hired" && (await entry("cand-001")).stage === "hired" && (o1?.scoredTraces as unknown[]).length === 3, r2.message);
    const sc1 = await scoresOn(screeningTrace, (s) => s.length === 1 && s[0].value === 1);
    const tc1 = check("TC1 Hired candidate -> final_outcome = 1 on their screening trace (changed from 0: still one score)", sc1.length === 1 && sc1[0].value === 1, `${sc1.map((s) => s.value).join(", ") || "no score yet"}`);
    passedOn.push({ traceId: screeningTrace, id: "feedback-tc1-hired-final-outcome", passed: tc1 });
    const scPre = await scoresOn(pre1, (s) => s.length === 1);
    const scSub = await scoresOn(sub1, (s) => s.length === 1);
    check("AC1 Outcome shows up as a score on earlier traces (screening, pre-screen, submission)", tc1 && scPre[0]?.value === 1 && scSub[0]?.value === 1, `pre-screen ${scPre.map((s) => s.value)}, submission ${scSub.map((s) => s.value)}`);

    const r21 = await recordOutcome(jobId, "cand-021", "rejected_by_client", "Client chose a candidate with more Kafka");
    const sc21 = await scoresOn(sub21, (s) => s.length === 1);
    check("Rejected by client -> final_outcome = 0 on the submission trace, stage client rejected", r21.ok && sc21[0]?.value === 0 && (await entry("cand-021")).stage === "client_rejected", `${r21.message} | ${sc21.map((s) => s.value)}`);

    const r4 = await recordOutcome(jobId, "cand-004", "withdrew", "Accepted another offer");
    const iv4b = await db.interview.findUniqueOrThrow({ where: { id: iv4.id } });
    const openItems = await db.approvalItem.count({ where: { jobId, candidateId: "cand-004", status: "awaiting_approval" } });
    const pending = await db.message.count({ where: { jobId, candidateId: "cand-004", status: "awaiting_approval" } });
    check(
      "Withdrew: interview cancelled, calendar freed, unsent draft cancelled, queue item closed",
      r4.ok && iv4b.status === "cancelled" && (await db.calendarEvent.count({ where: { interviewId: iv4.id } })) === 0 && openItems === 0 && pending === 0 && (await entry("cand-004")).stage === "withdrew",
      r4.message,
    );
    const runsBefore = await db.agentRun.count({ where: { createdAt: { gte: startedAt } } });
    const late = await ow.receiveReply(jobId, "cand-004", "Hi, just checking: is the interview still on?");
    const lateMsg = await db.message.findFirst({ where: { jobId, candidateId: "cand-004", direction: "inbound" }, orderBy: { createdAt: "desc" } });
    check("Reply after the outcome: saved, not read by any agent", late.ok && lateMsg?.intent === "after_outcome" && (await db.agentRun.count({ where: { createdAt: { gte: startedAt } } })) === runsBefore, late.message);

    const p = (await jobProgress([job])).get(jobId)!;
    check("Job funnel: hired counted; withdrew still counts at the stage reached (interview)", p.stageCounts.hired === 1 && p.stageCounts.interview === 2 && p.stageCounts.submitted === 3, `hired ${p.stageCounts.hired}, interview ${p.stageCounts.interview}, submitted ${p.stageCounts.submitted}`);

    // ---------- corrections -> datasets ----------
    console.log("\n--- Corrections -> datasets ---");
    await collectCorrections(); // recordOutcome already collected; a second run must add nothing for this job
    const mine = await db.datasetCorrection.findMany({ where: { OR: [{ jobId }, { sourceId: specRow.id }] } });
    const by = (source: string) => mine.find((c) => c.source === source);
    const want = { screening_override: "score_within", classifier_corrected: "intent_is", outreach_edited: null, prescreen_disagreed: null, submission_edited: null, job_spec_edited: null } as Record<string, string | null>;
    check(
      "Every kind of correction in this job collected once (score override, intent, edited draft, recommendation, submission, spec)",
      Object.entries(want).every(([s, k]) => by(s) && by(s)!.checkKind === k) && mine.length === Object.keys(want).length,
      mine.map((c) => `${c.source}${c.checkKind ? ` (${c.checkKind})` : ""}`).join(", "),
    );
    const again = await collectCorrections();
    check("Collecting again adds nothing new", (await db.datasetCorrection.count({ where: { OR: [{ jobId }, { sourceId: specRow.id }] } })) === mine.length, `${again.added} added overall`);
    check("All of them pushed to Langfuse", mine.every((c) => c.syncedAt), `${mine.filter((c) => c.syncedAt).length}/${mine.length}`);
    const so = by("screening_override")!;
    let item: { id: string; datasetName?: string; input?: unknown } | null = null;
    for (let i = 0; i < 6 && !item; i++) {
      item = await langfuse.api.datasetItems.get(so.langfuseItemId).catch(() => null);
      if (!item) await sleep(3000);
    }
    const tc2 = check("TC2 Recruiter override in Step 4 -> new item in screening-agent (input = spec + profile)", !!item && JSON.stringify(item.input).includes("Payments Reconciliation") && so.agent === "screening-agent", `${so.langfuseItemId}: ${so.expected}`);
    passedOn.push({ traceId: screeningTrace, id: "feedback-tc2-override-dataset-item", passed: tc2 });
    const ci = by("classifier_corrected")!;
    check("Classifier correction keeps the real thread (ending with the reply) and spec", JSON.stringify(ci.input).includes(wrongReply.body) && JSON.stringify(ci.input).includes("--- Recruiter (us)"), ci.expected);

    // The eval runs checkable corrections like any other item (pass/fail depends on the model: corrections are
    // cases the agent got wrong, so failing is normal until the prompt improves).
    console.log("\n--- Eval runs the corrections (Opus + Haiku) ---");
    const e1 = await runEval("screening-agent", { onlyItem: so.langfuseItemId });
    const e2 = await runEval("reply-classifier", { onlyItem: ci.langfuseItemId });
    check("npm run eval includes checkable corrections (screening, classifier), named after the prompt version", e1.total === 1 && e2.total === 1 && e1.runName.startsWith(e1.promptVersion), `screening: ${e1.items[0]?.detail}; classifier: ${e2.items[0]?.detail}`);

    // ---------- weekly job ----------
    console.log("\n--- Weekly job (Sonnet summary) ---");
    const st = await startWeeklyReport();
    if (!st.ok) throw new Error(st.message);
    reportId = st.reportId;
    check("Only one weekly job at a time", !(await startWeeklyReport()).ok, "second start refused");
    const w = await runWeeklyJob(reportId, { extraTags: ["test"] });
    const rep = await db.weeklyReport.findUniqueOrThrow({ where: { id: reportId } });
    const repFacts = rep.facts as { id: string; text: string }[];
    const sum = rep.summary as { headline: string; issues: { agent: string; evidence: string[] }[] } | null;
    const run = await db.agentRun.findFirst({ where: { id: { in: rep.agentRunIds as string[] } }, orderBy: { createdAt: "desc" } });
    check("Weekly job: report done, facts include this week's corrections and outcomes", w.ok && rep.status === "done" && repFacts.some((f) => f.text.includes("cand-002")) && repFacts.some((f) => f.id.startsWith("O")), `${w.message}`);
    check("Weekly summary cites only real facts (checked in code), issues most frequent first", !!sum && sum.issues.every((i) => i.evidence.every((e) => repFacts.some((f) => f.id === e))), `${sum?.headline} | ${sum?.issues.map((i) => `${i.agent} (${i.evidence.length})`).join(", ")}`);
    check("Weekly summary run logged with cost under budget ($0.20)", !!run && run.agent === "feedback-weekly-summary" && run.costUsd <= AGENT_BUDGETS["feedback-weekly-summary"].budgetUsd, `$${run?.costUsd.toFixed(4)}, ${run?.numTurns} turn(s)`);

    // Datasets in Langfuse.
    await syncDataset(langfuse, "feedback-weekly-summary");
    const lfItems = await langfuse.api.datasetItems.list({ datasetName: "feedback-weekly-summary", limit: 100 });
    check("Dataset feedback-weekly-summary in Langfuse with 5+ items", lfItems.data.length >= 5, `${lfItems.data.length} items`);
  } finally {
    for (const r of passedOn) if (r.traceId) langfuse.score.create({ traceId: r.traceId, name: "test_passed", value: r.passed ? 1 : 0, comment: r.id });
    await flushTelemetry();

    // Remove the test rows and the test's dataset items in Langfuse (agent_runs keep their real cost).
    const testCorrections = await db.datasetCorrection.findMany({ where: { OR: [{ jobId }, { sourceId: specRow.id }] } });
    for (const c of testCorrections) await langfuse.api.datasetItems.delete(c.langfuseItemId).catch(() => undefined);
    await db.datasetCorrection.deleteMany({ where: { id: { in: testCorrections.map((c) => c.id) } } });
    if (reportId) await db.weeklyReport.delete({ where: { id: reportId } });
    const ivs = await db.interview.findMany({ where: { jobId }, select: { id: true } });
    await db.calendarEvent.deleteMany({ where: { interviewId: { in: ivs.map((x) => x.id) } } });
    await db.approvalItem.deleteMany({ where: { jobId } });
    await db.agentRun.updateMany({ where: { jobId }, data: { jobId: null } });
    await db.job.delete({ where: { id: jobId } });
    await db.jobSpec.delete({ where: { id: specRow.id } });
  }

  const spent = await db.agentRun.groupBy({ by: ["agent"], where: { createdAt: { gte: startedAt } }, _sum: { costUsd: true }, _count: true });
  console.log("\nCost of this test run:");
  for (const s of spent) console.log(`  ${s.agent}: ${s._count} run(s), $${(s._sum.costUsd ?? 0).toFixed(4)}`);
  console.log(`  total: $${spent.reduce((n, s) => n + (s._sum.costUsd ?? 0), 0).toFixed(4)}`);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
