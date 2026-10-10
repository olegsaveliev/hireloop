// Phase 5 tests. Real Sonnet/Haiku runs, ~$0.30.
// Step 6 (docs/specs/06-prescreen-agent.md "Test cases" + "Acceptance criteria"):
//   1. Full answers, rate in range -> proceed
//   2. Rate 40% over range -> discuss + red flag
//   3. Only 2 of 4 answers -> missing items listed
// Plus: interested reply -> questions drafted for approval (since 2026-10-08) and no "let's call" reply, "Start pre-screen" button,
// guardrails (no protected topics, never to a declined candidate, only pre-screen messages skip approval),
// re-summary when more answers arrive, the recruiter's call + score, "discuss" in the approval queue,
// runaway stop and resume.
// Step 7 (docs/specs/07-submission-agent.md):
//   2. Missing rate -> blocked with message      3. Every field of the one Hireloop format filled
//   (TC1 "anonymized client" retired 2026-10-09: one format for every client, names shown.)
// Plus: rate without an amount refused, typed rate unblocks, AM approve (edits, sends via mock_inbox, stage submitted,
// no double send), reject -> redraft, "Don't submit", runaway stop. The anonymization check itself is unit-tested.
// Step 8 (docs/specs/08-scheduling-agent.md):
//   1. Easy overlap -> confirmed in 2 messages      2. No overlap -> escalated
//   3. US client (New York) + Kyiv candidate -> slots within both working hours (also across summer/winter time)
// Plus: guardrails (time zones stated, 09:00-19:00 enforced in code and at booking, no AI-written times), reply
// routing (scheduling replies aren't classified or summarized), reschedule once -> new times, twice -> escalated,
// Try again, reminders and nudges, client rejects, never to a declined candidate, no double booking.
// Step 9 is in scripts/tests/test-step9.ts (npm run test:phase5 runs both).
// The agents' dataset items live in src/evals/datasets.ts; this script records test_passed scores.
// Run with: npm run test:phase5 (Steps 6-8 here, then Step 9)
import { config } from "dotenv";
config({ path: ".env.local" });

import type { JobSpecData } from "@/agents/job-spec/schema";
import type { SubmissionFields } from "@/agents/submission/schema";

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
// cand-001 strong fit, cand-021 middle Python, cand-004 Ukrainian profile, cand-002 says no, cand-003 runaway/resume.
const CANDIDATES = ["cand-001", "cand-021", "cand-004", "cand-002", "cand-003"];
// Step 7: cand-008 has no rate (blocked), cand-011 embedded Rust for Haldor (Don't submit).
const STEP7_CANDIDATES = ["cand-008", "cand-011"];
const RUST_SPEC: JobSpecData = {
  title: "Embedded Rust Firmware Engineer (Telematics)",
  seniority: null,
  must_have: ["Embedded Rust (no_std, Embassy or RTIC)", "CAN bus", "B2B contract"],
  nice_to_have: ["STM32", "Yocto"],
  dealbreakers: [],
  location: ["Remote, EU time zone", "On-site in Munich one week per quarter"],
  rate_range: "EUR 60-75/hr",
  selling_points: ["Rewrite from C to Rust"],
  open_questions: [],
};
const INTERESTED = "Hi Anna, sounds interesting, happy to hear more.";

async function main() {
  const { db } = await import("@/lib/db");
  const { runEnrichmentAgent } = await import("@/agents/enrichment/agent");
  const ow = await import("@/agents/outreach/workflow");
  const pw = await import("@/agents/prescreen/workflow");
  const { applyRateRule } = await import("@/agents/prescreen/agent");
  const { prescreenQuestionsSchema, missingAnswers } = await import("@/agents/prescreen/schema");
  const { protectedTopicsIn } = await import("@/config/prescreen");
  const { rateAboveRange, rateLike } = await import("@/lib/rates");
  const { sampleAnswers } = await import("./sample-replies");
  const { sendWithoutApproval } = await import("@/agents/tools/mock-inbox");
  const { loadJob } = await import("@/agents/pipeline/shared");
  const { AGENT_BUDGETS } = await import("@/config/budgets");
  const { getTelemetry, flushTelemetry } = await import("@/agents/telemetry");
  const sw = await import("@/agents/submission/workflow");
  const { identifyingDetails } = await import("@/agents/submission/schema");
  const { runPipeline } = await import("@/agents/pipeline/workflow");
  const { rateProblem, SUBMISSION_FORMAT } = await import("@/config/submission");
  const { langfuse } = getTelemetry();
  const startedAt = new Date();

  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
    if (!ok) failures++;
    return ok;
  };
  const passedOn: { traceId: string | null; id: string; passed: boolean }[] = [];

  // ---------- unit checks (no AI) ----------
  console.log("\n--- Unit checks (no AI) ---");
  check("Protected topics: age, family, health, religion, nationality caught", ["How old are you?", "Are you married?", "Any health conditions?", "What is your religion?", "What is your nationality?"].every((t) => protectedTopicsIn(t).length === 1), "5 of 5");
  check("Protected topics: no false alarms", ["Have you debugged race conditions in Rust?", "Tell me about your work at Kvitka Health.", "Are you based in Poland or Ukraine?", "What's your average deploy frequency?", "When could you start?"].every((t) => protectedTopicsIn(t).length === 0), "race condition, Kvitka Health, Poland, average, start");
  check("Rate: $91/hr is ~40% above $55-65/hr", Math.round((rateAboveRange("$91/hr on B2B", "$55-65/hr") ?? 0) * 100) === 40, `${rateAboveRange("$91/hr on B2B", "$55-65/hr")}`);
  check("Rate: in range is not above", (rateAboveRange("$60/hr", "$55-65/hr") ?? 1) <= 0, `${rateAboveRange("$60/hr", "$55-65/hr")}`);
  check("Rate: different currency or period can't be compared", rateAboveRange("€90/hr", "$55-65/hr") === null && rateAboveRange("$9000 per month", "$55-65/hr") === null, "null, null");
  check("Rate: 'k' and commas", rateAboveRange("€5.5k per month", "€4,000-5,000/month")! > 0.09, `${rateAboveRange("€5.5k per month", "€4,000-5,000/month")}`);
  check("rateLike keeps the range's format", rateLike("$55-65/hr", 60) === "$60/hr" && rateLike("€4,000-5,000 per month", 7000) === "€7000 per month", `${rateLike("$55-65/hr", 60)}, ${rateLike("€4,000-5,000 per month", 7000)}`);
  const summaryBase = { candidate_id: "x", answers: [{ question: "Rate?", answer: "$91/hr" }], rate_expectation: "$91/hr", availability: null, red_flags: [], recommendation: "proceed" as const, summary: "Fine." };
  const ruled = applyRateRule(summaryBase, "$55-65/hr");
  check("App rate rule: proceed + 40% over -> discuss + red flag", ruled.recommendation === "discuss" && ruled.red_flags.length === 1, `${ruled.recommendation}: ${ruled.red_flags.join("; ")}`);
  check("App rate rule: 'stop' stays stop", applyRateRule({ ...summaryBase, recommendation: "stop" }, "$55-65/hr").recommendation === "stop", "stop");
  const q = (topic: "must_have" | "rate" | "availability", question: string) => ({ question, topic, about: "x" });
  const goodQs = [q("must_have", "How long have you used FastAPI?"), q("rate", "What rate do you expect?"), q("availability", "When could you start?")];
  check("Questions schema: valid set passes", prescreenQuestionsSchema.safeParse({ candidate_id: "x", first_name: "A", questions: goodQs }).success, "ok");
  check("Questions schema: protected question rejected", !prescreenQuestionsSchema.safeParse({ candidate_id: "x", first_name: "A", questions: [...goodQs, q("must_have", "Do you have children?")] }).success, "children");
  check("Questions schema: no rate question rejected", !prescreenQuestionsSchema.safeParse({ candidate_id: "x", first_name: "A", questions: [goodQs[0], goodQs[2], q("must_have", "Kafka?")] }).success, "no rate");
  const partial = sampleAnswers("partial", [...goodQs, q("must_have", "On-call?")], "$55-65/hr", "Andriy Kovalchuk");
  check("Sample answers: partial answers 2 of 4", (partial.match(/^\d\./gm) ?? []).length === 2, partial.replace(/\n/g, " "));
  check("Sample answers: rate 40% over", /\$91\/hr/.test(sampleAnswers("rate_high", goodQs, "$55-65/hr", "A B")), "$91/hr");

  // ---------- test job: contacted candidates (messages inserted, no AI) ----------
  for (const id of [...CANDIDATES, ...STEP7_CANDIDATES]) {
    if (await db.candidateProfile.findUnique({ where: { candidateId: id } })) continue;
    const r = await runEnrichmentAgent({ candidateId: id, extraTags: ["test"] });
    if (!r.data) throw new Error(`Enrichment failed for ${id}: ${r.error}`);
    await db.candidateProfile.create({ data: { candidateId: id, data: r.data, missingCount: r.data.missing_fields.length, agentRunId: r.runs.at(-1)!.runId } });
  }
  // Own throwaway briefs (the seed briefs may have been deleted in the app); removed at the end.
  // Same senders as the seed briefs: the brief's sender is the client contact for Steps 7-8.
  const testBrief = (clientId: string, fromName: string, fromEmail: string) =>
    db.clientBrief.create({ data: { id: `brief-test-${Math.random().toString(36).slice(2, 10)}`, clientId, fromName, fromEmail, subject: "[test] phase 5", body: "test", receivedAt: new Date(), source: "manual" } });
  const brief1 = await testBrief("client-brightline", "Dana Whitfield", "dana.whitfield@brightline-payments.example");
  const brief2 = await testBrief("client-haldor", "Markus Feld", "m.feld@haldor-mobility.example");
  const specRow = await db.jobSpec.create({
    data: { briefId: brief1.id, clientId: "client-brightline", status: "approved", agentDraft: SPEC, spec: SPEC, agentRunIds: [], decidedAt: new Date() },
  });
  const job = await db.job.create({ data: { jobSpecId: specRow.id, clientId: "client-brightline", title: `[test] ${SPEC.title}`, status: "outreach" } });
  const jobId = job.id;
  await db.pipelineEntry.createMany({ data: CANDIDATES.map((candidateId) => ({ jobId, candidateId, stage: "contacted", matchedOn: ["python"] })) });
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
  for (const candidateId of CANDIDATES) {
    await db.message.create({
      data: { jobId, candidateId, direction: "outbound", kind: "first", sequenceStep: 1, status: "sent", toEmail: "x@mail.example", subject: "Senior Python role: payments reconciliation, fully remote", body: "Hi, a Senior Python role on a payments platform, fully remote. Open to a short call?\n\nAnna, Hireloop", sentAt: twoDaysAgo },
    });
  }
  const msgs = (where: object = {}) => db.message.findMany({ where: { jobId, ...where }, orderBy: { createdAt: "asc" } });
  const entry = (candidateId: string) => db.pipelineEntry.findUniqueOrThrow({ where: { jobId_candidateId: { jobId, candidateId } } });
  const prescreenOf = (candidateId: string) => db.prescreen.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
  type Q = { question: string; topic: string; about: string };
  const allQuestionText: string[] = [];
  let job2: { id: string; specId: string } | null = null;

  // Pre-screen questions need approval since 2026-10-08: send a candidate's drafted questions as the recruiter would.
  const sendQuestions = async (candidateId: string) => {
    const drafts = await msgs({ candidateId, kind: "prescreen", status: "awaiting_approval" });
    if (drafts.length) await ow.approveDrafts(drafts.map((d) => ({ messageId: d.id, subject: d.subject, body: d.body })));
  };

  try {
    // ---------- trigger: interested reply -> questions drafted for approval ----------
    console.log("\n--- Interested reply -> pre-screen questions (Haiku classifies, Sonnet writes questions) ---");
    const r1 = await ow.receiveReply(jobId, "cand-001", INTERESTED, { extraTags: ["test"] });
    const p1 = await prescreenOf("cand-001");
    const draftQ = (await msgs({ candidateId: "cand-001", kind: "prescreen" }))[0];
    check("Interested -> questions drafted, not sent", r1.ok && p1?.status === "questions_draft" && draftQ?.status === "awaiting_approval" && p1.questionsMessageId === draftQ.id, r1.message);
    check("Interested -> no 'let's call' reply draft (questions replace it)", (await msgs({ candidateId: "cand-001", status: "awaiting_approval" })).every((m) => m.kind === "prescreen"), "only the questions wait");
    const sendItem = await db.approvalItem.findFirst({ where: { jobId, kind: "outreach", status: "awaiting_approval" } });
    check("Questions wait on the send screen ('Send outreach' item)", !!sendItem?.detail?.includes("pre-screen"), sendItem?.detail ?? "none");
    await sendQuestions("cand-001");
    const qMsg = (await msgs({ candidateId: "cand-001", kind: "prescreen" }))[0];
    check("Approved -> questions sent, pre-screen waits for answers", qMsg?.status === "sent" && !!qMsg.sentAt && (await prescreenOf("cand-001"))?.status === "questions_sent", qMsg?.status ?? "");
    const qs1 = (p1?.questions ?? []) as Q[];
    console.log(`      email to cand-001:\n${qMsg?.body.replace(/^/gm, "        ")}`);
    const specWords = SPEC.must_have.flatMap((m) => m.match(/[A-Za-z][A-Za-z0-9+#.-]{2,}/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !["and", "the", "experience", "contract", "production"].includes(w));
    const specific = (qs: Q[]) => qs.some((x) => x.topic === "must_have" && specWords.some((w) => x.question.toLowerCase().includes(w)));
    allQuestionText.push(...qs1.map((x) => x.question));

    // "Start pre-screen" button: a candidate whose reply was a question (not auto-started).
    await db.message.create({ data: { jobId, candidateId: "cand-021", direction: "inbound", kind: "inbound", status: "received", subject: "Re: role", body: "Is it B2B?", intent: "question", sentAt: new Date() } });
    await db.pipelineEntry.update({ where: { jobId_candidateId: { jobId, candidateId: "cand-021" } }, data: { stage: "replied" } });
    const r21 = await pw.startPrescreenNow(jobId, "cand-021", { extraTags: ["test"] });
    const p21 = await prescreenOf("cand-021");
    check("'Start pre-screen' button drafts questions", r21.ok && !!p21, r21.message);
    await sendQuestions("cand-021");
    allQuestionText.push(...((p21?.questions ?? []) as Q[]).map((x) => x.question));
    const again = await pw.startPrescreenNow(jobId, "cand-021", { extraTags: ["test"] });
    check("'Start pre-screen' twice: refused", !again.ok, again.message);

    const r4 = await ow.receiveReply(jobId, "cand-004", INTERESTED, { extraTags: ["test"] });
    await sendQuestions("cand-004");
    const p4 = await prescreenOf("cand-004");
    const q4 = (await msgs({ candidateId: "cand-004", kind: "prescreen" }))[0];
    check("Ukrainian profile: English questions, 'Hi <Latin name>,'", !!p4 && !/[Ѐ-ӿ]/.test(q4?.body ?? "Ѐ"), `${r4.message} ${q4?.body.split("\n")[0]}`);
    allQuestionText.push(...((p4?.questions ?? []) as Q[]).map((x) => x.question));
    const ac1 = [p1, p21, p4].every((p) => p && specific(p.questions as Q[]));
    check("AC1 Questions are specific to the spec (a must-have question names a spec must-have)", ac1, [p1, p21, p4].map((p) => (p?.questions as Q[] | undefined)?.find((x) => x.topic === "must_have")?.question).join(" | "));
    check("Every question set asks about rate and availability", [p1, p21, p4].every((p) => (p?.questions as Q[]).some((x) => x.topic === "rate") && (p?.questions as Q[]).some((x) => ["availability", "notice_period"].includes(x.topic))), "rate + availability");

    // ---------- guardrails in mock_inbox ----------
    await db.pipelineEntry.update({ where: { jobId_candidateId: { jobId, candidateId: "cand-002" } }, data: { stage: "declined" } });
    const toDeclined = await sendWithoutApproval({ jobId, candidateId: "cand-002", kind: "scheduling", toEmail: "x@mail.example", subject: "x", body: "x", footer: "x", agentRunIds: [], traceId: null });
    check("Guardrail: nothing sent to a candidate who said no", toDeclined === null && !(await msgs({ candidateId: "cand-002", kind: "scheduling" })).length, "refused");
    let refused = false;
    try {
      await sendWithoutApproval({ jobId, candidateId: "cand-001", kind: "first", toEmail: "x@mail.example", subject: "x", body: "x", footer: "x", agentRunIds: [], traceId: null });
    } catch {
      refused = true;
    }
    let refusedQuestions = false;
    try {
      await sendWithoutApproval({ jobId, candidateId: "cand-001", kind: "prescreen", toEmail: "x@mail.example", subject: "x", body: "x", footer: "x", agentRunIds: [], traceId: null });
    } catch {
      refusedQuestions = true;
    }
    check("Guardrail: only scheduling emails can skip approval", refused && refusedQuestions, "kinds 'first' and 'prescreen' refused");

    // ---------- answers -> summaries ----------
    console.log("\n--- Answers -> summary (Sonnet) ---");
    const answer = async (candidateId: string, kind: "full" | "rate_high" | "partial") => {
      const p = (await prescreenOf(candidateId))!;
      const body = sampleAnswers(kind, p.questions as Q[] as never, SPEC.rate_range, candidateId);
      const r = await ow.receiveReply(jobId, candidateId, body, { extraTags: ["test"] });
      const after = (await prescreenOf(candidateId))!;
      const s = after.data as { recommendation: string; red_flags: string[]; answers: { question: string; answer: string | null }[]; summary: string; rate_expectation: string | null } | null;
      console.log(`      ${candidateId} (${kind}): ${r.message}\n        ${s?.summary}\n        red flags: ${s?.red_flags.join("; ") || "none"}`);
      if (s) allQuestionText.push(s.summary, ...s.red_flags);
      return { r, p: after, s };
    };
    const a1 = await answer("cand-001", "full");
    const inbound1 = (await msgs({ candidateId: "cand-001", direction: "inbound" })).at(-1);
    check("Answers are never sent to the reply classifier", inbound1?.intent === pw.ANSWER_INTENT && !inbound1.classification, `${inbound1?.intent}`);
    const tc1 = check("TC1 Full answers, rate in range -> proceed", a1.s?.recommendation === "proceed" && !a1.s.red_flags.some((f) => /rate|\$/i.test(f)), `${a1.s?.recommendation}, rate ${a1.s?.rate_expectation}`);
    passedOn.push({ traceId: a1.p.traceId, id: "prescreen-tc1-full-in-range", passed: tc1 });
    check("Summary -> stage prescreened, answers_completeness 1", (await entry("cand-001")).stage === "prescreened" && a1.p.completeness === 1, `${(await entry("cand-001")).stage}, ${a1.p.completeness}`);

    const a21 = await answer("cand-021", "rate_high");
    const tc2 = check("TC2 Rate 40% over range -> discuss + red flag", a21.s?.recommendation === "discuss" && a21.s.red_flags.some((f) => /rate|\$/i.test(f)), `${a21.s?.recommendation}: ${a21.s?.red_flags.join("; ")}`);
    passedOn.push({ traceId: a21.p.traceId, id: "prescreen-tc2-rate-40-over", passed: tc2 });
    check("AC2 Summary flags rate mismatch correctly (flag on 40% over, none in range)", tc1 && tc2, "TC1 + TC2");
    const review = await db.approvalItem.findFirst({ where: { jobId, candidateId: "cand-021", kind: "prescreen_review", status: "awaiting_approval" } });
    check("'discuss' -> 'Review pre-screen' item in the approval queue", !!review, `${review?.title}: ${review?.detail?.slice(0, 140)}`);

    const a4 = await answer("cand-004", "partial");
    const missing = a4.s ? missingAnswers(a4.s as never) : [];
    const tc3 = check("TC3 Only 2 answers -> missing items listed", missing.length >= 1 && missing.length === (a4.p.questions as Q[]).length - 2 && (a4.p.completeness ?? 1) < 1, `${missing.length} not answered: ${missing.join(" | ")}`);
    passedOn.push({ traceId: a4.p.traceId, id: "prescreen-tc3-partial", passed: tc3 });

    // More answers later -> summary updated.
    const rest = (a4.p.questions as Q[]).slice(2).map((x, i) => `${i + 3}. ${x.topic === "rate" ? "$60/hr, B2B." : x.topic === "availability" || x.topic === "notice_period" ? "In 3 weeks, notice period 2 weeks." : "Yes, 3 years in production."}`).join("\n");
    const more = await ow.receiveReply(jobId, "cand-004", `Hi Anna, the rest:\n\n${rest}\n\nOleksandr`, { extraTags: ["test"] });
    const p4b = (await prescreenOf("cand-004"))!;
    check("More answers later -> summary updated, completeness 1", (p4b.completeness ?? 0) === 1 && p4b.updatedAt > a4.p.updatedAt, `${more.message} completeness ${p4b.completeness}`);

    check("AC3 No prohibited questions in any output", allQuestionText.every((t) => protectedTopicsIn(t).length === 0), `${allQuestionText.length} questions, summaries and red flags checked`);

    // ---------- the recruiter's call ----------
    const d1 = await pw.decidePrescreen(jobId, "cand-001", "submit");
    check("Recruiter's call saved (proceed + submit = agreed)", d1.ok && (await prescreenOf("cand-001"))?.decision === "submit", d1.message);
    const d21 = await pw.decidePrescreen(jobId, "cand-021", "dont_submit");
    const closed = await db.approvalItem.findUniqueOrThrow({ where: { id: review!.id } });
    check("Deciding closes the 'Review pre-screen' item", d21.ok && closed.status === "rejected", `${closed.status}`);
    check("Deciding twice: refused", !(await pw.decidePrescreen(jobId, "cand-001", "dont_submit")).ok, "refused");

    // ---------- runaway: nothing saved, then resume ----------
    console.log("\n--- Runaway and resume ---");
    {
      const budget = AGENT_BUDGETS["prescreen-agent"];
      const original = budget.budgetUsd;
      budget.budgetUsd = 0.0001; // in memory only
      try {
        await ow.receiveReply(jobId, "cand-003", INTERESTED, { extraTags: ["test", "runaway"] });
      } finally {
        budget.budgetUsd = original;
      }
      const stopped = await db.approvalItem.findFirst({ where: { jobId, kind: "stopped_run", step: 6 }, orderBy: { createdAt: "desc" } });
      check("Runaway: no questions sent, no pre-screen saved, 'Stopped: over budget' in the queue", !(await prescreenOf("cand-003")) && !(await msgs({ candidateId: "cand-003", kind: "prescreen" })).length && stopped?.title === "Stopped: over budget", `${stopped?.title}: ${stopped?.detail}`);
      await pw.prescreenStep(await loadJob(jobId), { extraTags: ["test"] });
      check("Resume (Try again): the missing questions are drafted", !!(await prescreenOf("cand-003")) && (await msgs({ candidateId: "cand-003", kind: "prescreen" })).length === 1, "drafted once");
    }

    // =================== Step 7: submissions ===================
    console.log("\n--- Step 7: unit checks (no AI) ---");
    const format = SUBMISSION_FORMAT; // one format for every client (2026-10-09)
    check("One format: named, all six fields", !format.anonymized && format.fields.length === 6, format.fields.join(", "));
    check("Rate with an amount is fine in any currency", rateProblem("$60/hr", format) === null && rateProblem("EUR 70/hr", format) === null, "ok");
    check("Rate missing -> blocked", rateProblem(null, format) !== null && rateProblem("negotiable", format) !== null, `${rateProblem(null, format)}`);
    const who = { fullName: "Andriy Kovalchuk", employers: ["Amber Ledger", "Nebo Software"] };
    check("Anonymization check catches name, email, phone, LinkedIn, employer", identifyingDetails("Andriy at Amber Ledger, a.k@mail.example, +48 600 123 456, linkedin.com/in/x", who).length === 5, identifyingDetails("Andriy at Amber Ledger, a.k@mail.example, +48 600 123 456, linkedin.com/in/x", who).join("; "));
    check("Anonymization check: no false alarm on years or generic text", identifyingDetails("10 years of Python at a Polish fintech (2016-2021), based in Kraków", who).length === 0, "ok");

    console.log("\n--- Step 7: named client (Brightline), drafts via the job's run (Sonnet) ---");
    // cand-001: "submit" was decided in Step 6. cand-008: approved for submission but no rate (blocked).
    await db.pipelineEntry.create({ data: { jobId, candidateId: "cand-008", stage: "prescreened", matchedOn: ["python"] } });
    const noRate = { candidate_id: "cand-008", answers: [{ question: "What rate?", answer: null }], rate_expectation: null, availability: "In a month", red_flags: [], recommendation: "proceed", summary: "Fits; rate not stated." };
    await db.prescreen.create({ data: { jobId, candidateId: "cand-008", status: "summarized", questions: [], data: noRate, recommendation: "proceed", completeness: 0, decision: "submit" } });
    await db.job.update({ where: { id: jobId }, data: { status: "drafting_outreach" } });
    await runPipeline(jobId, { extraTags: ["test"] });
    const subs = (candidateId: string) => db.submission.findMany({ where: { jobId, candidateId }, orderBy: { createdAt: "asc" } });
    const s1 = (await subs("cand-001"))[0];
    const d1s = s1?.data as { headline: string; summary: string; key_skills: string[]; experience_highlights: string[]; highlight_sources: string[]; rate: string; availability: string; anonymized: boolean } | undefined;
    console.log(`      ${d1s?.headline}\n      ${d1s?.summary}\n      skills: ${d1s?.key_skills.join(", ")}\n      ${d1s?.experience_highlights.map((h, i) => `- ${h}  <- "${d1s.highlight_sources[i]}"`).join("\n      ")}\n      rate: ${d1s?.rate} · ${d1s?.availability}`);
    const tc3s = check(
      "TC3 Every field of the format filled, named",
      !!d1s && format.fields.every((f) => { const v = d1s[f]; return Array.isArray(v) ? v.length > 0 : !!v; }) && !d1s.anonymized && s1.status === "awaiting_approval",
      `${format.fields.join(", ")}`,
    );
    passedOn.push({ traceId: s1?.traceId ?? null, id: "submission-tc3-named-brightline", passed: tc3s });
    check("AC2 Every claim traceable: one source quote per highlight (checked against the source data in code)", !!d1s && d1s.highlight_sources.length === d1s.experience_highlights.length, `${d1s?.highlight_sources.length} quotes`);
    check("Rate in the profile = the confirmed rate", d1s?.rate === ((await prescreenOf("cand-001"))!.data as { rate_expectation: string }).rate_expectation, `${d1s?.rate}`);
    const item1 = await db.approvalItem.findFirst({ where: { jobId, candidateId: "cand-001", kind: "submission", status: "awaiting_approval" } });
    check("Account manager item 'Send to client' in the approval queue", !!item1, `${item1?.title}`);
    check("Nothing sent to the client before approval", !(await msgs({ kind: "submission" })).length, "0 sent");
    check("Not submitted to a candidate the recruiter said no to (cand-021)", !(await subs("cand-021")).length, "none");
    const rateItem = await db.approvalItem.findFirst({ where: { jobId, candidateId: "cand-008", kind: "submission_rate", status: "awaiting_approval" } });
    const tc2s = check("TC2 Missing rate -> blocked with message, no draft", !!rateItem && !(await subs("cand-008")).length, `${rateItem?.title}: ${rateItem?.detail}`);
    passedOn.push({ traceId: null, id: "submission-tc2-missing-rate", passed: tc2s });
    const noAmount = await sw.setConfirmedRate(jobId, "cand-008", "negotiable");
    check("Typed rate without an amount is refused", !noAmount.ok, noAmount.message);
    const typed = await sw.setConfirmedRate(jobId, "cand-008", "$58/hr");
    await db.job.update({ where: { id: jobId }, data: { status: "drafting_outreach" } });
    await runPipeline(jobId, { extraTags: ["test"] });
    const s8 = (await subs("cand-008"))[0];
    check("Typed rate unblocks: profile drafted with $58/hr", typed.ok && (s8?.data as { rate: string } | undefined)?.rate === "$58/hr" && (await db.approvalItem.findUniqueOrThrow({ where: { id: rateItem!.id } })).status === "approved", typed.message);

    // Reject -> redraft, then approve with an edit.
    const rj = await sw.rejectSubmission(s1.id, "Keep the summary to 2 sentences.", { extraTags: ["test"] });
    const s1b = (await subs("cand-001")).at(-1)!;
    const sentences = (s1b.data as { summary: string }).summary.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    check("Reject -> kept as rejected, agent redrafts following the comment", rj.ok && (await db.submission.findUniqueOrThrow({ where: { id: s1.id } })).status === "rejected" && s1b.previousSubmissionId === s1.id && sentences <= 2, `${rj.message} ${sentences} sentence(s)`);
    const f1 = s1b.data as { headline: string; summary: string; key_skills: string[]; experience_highlights: string[]; rate: string; availability: string };
    const ap = await sw.approveSubmission(s1b.id, { ...f1, headline: `${f1.headline} (edited by AM)` });
    const sentMsg = (await msgs({ kind: "submission" }))[0];
    check(
      "AC3 AM approval sends (mock inbox, to the client contact) and moves stage to submitted",
      ap.ok && sentMsg?.toEmail === "dana.whitfield@brightline-payments.example" && (await entry("cand-001")).stage === "submitted" && (await db.submission.findUniqueOrThrow({ where: { id: s1b.id } })).status === "sent",
      `${ap.message}`,
    );
    console.log(`      email to client:\n${sentMsg?.body.replace(/^/gm, "        ")}`);
    check("AM edit saved in what was sent", /edited by AM/.test(sentMsg?.body ?? ""), "edit present");
    check("Approve twice: nothing sent twice", !(await sw.approveSubmission(s1b.id, f1)).ok && (await msgs({ kind: "submission" })).length === 1, "refused");
    check("Approval item closes after sending", !(await db.approvalItem.findFirst({ where: { jobId, candidateId: "cand-001", kind: "submission", status: "awaiting_approval" } })), "closed");

    console.log("\n--- Step 7: second client (Haldor), Don't submit ---");
    const spec2 = await db.jobSpec.create({ data: { briefId: brief2.id, clientId: "client-haldor", status: "approved", agentDraft: RUST_SPEC, spec: RUST_SPEC, agentRunIds: [], decidedAt: new Date() } });
    const j2 = await db.job.create({ data: { jobSpecId: spec2.id, clientId: "client-haldor", title: `[test] ${RUST_SPEC.title}`, status: "drafting_outreach" } });
    job2 = { id: j2.id, specId: spec2.id };
    await db.pipelineEntry.create({ data: { jobId: j2.id, candidateId: "cand-011", stage: "prescreened", matchedOn: ["rust"] } });
    const rustSummary = { candidate_id: "cand-011", answers: [{ question: "Rate?", answer: "EUR 70/hr, B2B" }, { question: "Start?", answer: "In 3 weeks, 2 weeks' notice" }], rate_expectation: "EUR 70/hr", availability: "In about 3 weeks (2 weeks' notice)", red_flags: [], recommendation: "proceed", summary: "Strong embedded Rust fit with CAN bus; rate in range." };
    await db.prescreen.create({ data: { jobId: j2.id, candidateId: "cand-011", status: "summarized", questions: [], data: rustSummary, recommendation: "proceed", completeness: 1 } });
    await runPipeline(j2.id, { extraTags: ["test"] });
    const s11 = (await db.submission.findMany({ where: { jobId: j2.id } }))[0];
    const d11 = s11?.data as SubmissionFields | undefined;
    if (d11) console.log(`      ${d11.headline}\n      ${d11.summary}\n      ${d11.experience_highlights.join("\n      ")}`);
    check("Same one format for Haldor: named, all fields filled", !!s11 && !s11.anonymized && !!d11 && format.fields.every((f) => { const v = d11[f]; return Array.isArray(v) ? v.length > 0 : !!v; }), `${s11?.status}`);
    if (s11 && d11) {
      const wd = await sw.withdrawSubmission(s11.id);
      const pre11 = await db.prescreen.findUniqueOrThrow({ where: { jobId_candidateId: { jobId: j2.id, candidateId: "cand-011" } } });
      check("'Don't submit': nothing sent, recruiter's call saved (proceed overridden)", wd.ok && pre11.decision === "dont_submit" && !(await db.message.count({ where: { jobId: j2.id, kind: "submission" } })), wd.message);
      await db.job.update({ where: { id: j2.id }, data: { status: "drafting_outreach" } });
      await runPipeline(j2.id, { extraTags: ["test"] });
      check("After 'Don't submit', no new draft is made", (await db.submission.count({ where: { jobId: j2.id } })) === 1, "1 (withdrawn)");
    }

    // Runaway: above 3x -> nothing saved, "Stopped: over budget", the claim is released for Try again.
    {
      await db.prescreen.update({ where: { jobId_candidateId: { jobId: j2.id, candidateId: "cand-011" } }, data: { decision: "submit" } });
      await db.submission.deleteMany({ where: { jobId: j2.id } });
      const budget = AGENT_BUDGETS["submission-agent"];
      const original = budget.budgetUsd;
      budget.budgetUsd = 0.0001; // in memory only
      try {
        await db.job.update({ where: { id: j2.id }, data: { status: "drafting_outreach" } });
        await runPipeline(j2.id, { extraTags: ["test", "runaway"] });
      } finally {
        budget.budgetUsd = original;
      }
      const stopped = await db.approvalItem.findFirst({ where: { jobId: j2.id, kind: "stopped_run", step: 7 } });
      const pre11 = await db.prescreen.findUniqueOrThrow({ where: { jobId_candidateId: { jobId: j2.id, candidateId: "cand-011" } } });
      check("Runaway: no submission saved, 'Stopped: over budget', claim released", !(await db.submission.count({ where: { jobId: j2.id } })) && stopped?.title === "Stopped: over budget" && pre11.submissionStartedAt === null, `${stopped?.title}`);
    }

    // =================== Step 8: scheduling ===================
    console.log("\n--- Step 8: unit checks (no AI) ---");
    const tz = await import("@/lib/timezones");
    const { findSlots } = await import("@/agents/scheduling/slots");
    const { optionsEmailSchema } = await import("@/agents/scheduling/schema");
    const { book } = await import("@/agents/tools/bookings");
    const scw = await import("@/agents/scheduling/workflow");
    const { sampleSchedulingReply } = await import("./sample-replies");
    const KYIV = "Europe/Kyiv";
    const NY = "America/New_York";
    check("Working hours: 18:00-19:00 Kyiv ok; 18:30-19:30, 08:00 and Saturday refused",
      tz.withinWorkingHours(new Date("2026-10-13T15:00:00Z"), KYIV) && !tz.withinWorkingHours(new Date("2026-10-13T15:30:00Z"), KYIV) && !tz.withinWorkingHours(new Date("2026-10-13T05:00:00Z"), KYIV) && !tz.withinWorkingHours(new Date("2026-10-17T10:00:00Z"), KYIV),
      "Tue 13 Oct / Sat 17 Oct");
    const line = tz.slotLine(new Date("2026-10-13T13:00:00Z"), KYIV, NY);
    check("Time zones stated explicitly, summer offsets right (Kyiv UTC+3, New York UTC-4)", line === "Tue 13 Oct, 16:00-17:00 Kyiv time (UTC+3) = 09:00-10:00 New York time (UTC-4)", line);
    const gap = tz.slotLine(new Date("2026-10-27T14:00:00Z"), KYIV, NY);
    check("Week when Europe is on winter time but the US isn't yet: Kyiv UTC+2, New York UTC-4", gap === "Tue 27 Oct, 16:00-17:00 Kyiv time (UTC+2) = 10:00-11:00 New York time (UTC-4)", gap);
    check("Candidate time zone from location; unknown -> null (escalated, never guessed)",
      tz.timeZoneOfLocation("Kharkiv, Ukraine") === KYIV && tz.timeZoneOfLocation("Kraków, Poland") === "Europe/Warsaw" && tz.timeZoneOfLocation("Lisbon, Portugal") === null && tz.timeZoneOfLocation(null) === null,
      "Kyiv, Warsaw, null, null");
    let tc3unit = true;
    const tc3detail: string[] = [];
    for (const [label, candTz, now] of [["Kyiv, summer", KYIV, new Date("2026-10-07T08:00:00Z")], ["Kyiv, gap week", KYIV, new Date("2026-10-24T08:00:00Z")], ["Kyiv, winter", KYIV, new Date("2026-12-01T08:00:00Z")], ["Warsaw, summer", "Europe/Warsaw", new Date("2026-10-07T08:00:00Z")]] as const) {
      const slots = await findSlots({ candidate: { person: "test-cand", tz: candTz }, client: { person: "test-client@x.example", tz: NY }, now });
      const ok = slots.length > 0 && slots.every((d) => tz.withinWorkingHours(d, candTz) && tz.withinWorkingHours(d, NY));
      tc3unit &&= ok;
      tc3detail.push(`${label}: ${slots.length} slot(s)${slots[0] ? `, e.g. ${tz.slotLine(slots[0], candTz, NY)}` : ""}`);
    }
    check("TC3 (code) US client (New York) + Kyiv/Warsaw candidate -> every slot inside both working days", tc3unit, tc3detail.join("; "));
    const bad = optionsEmailSchema({ clientName: "Brightline Payments" });
    check("Agent can't write times: 'Tuesday at 15:00 CET' refused; missing {{slots}} refused; client name refused",
      !bad.safeParse({ candidate_id: "x", body: "Hi A,\n\nHow about Tuesday at 15:00 CET?\n{{slots}}" }).success && !bad.safeParse({ candidate_id: "x", body: "Hi A, here are times." }).success && !bad.safeParse({ candidate_id: "x", body: "Hi A, Brightline wants to meet.\n{{slots}}" }).success && bad.safeParse({ candidate_id: "x", body: "Hi A,\n\nThe client would like to interview you.\n{{slots}}\nReply with the number." }).success,
      "3 refused, 1 ok");
    const outside = await book(new Date("2026-10-13T17:00:00Z"), [{ person: "test-cand", tz: KYIV }, { person: "test-client@x.example", tz: NY }], "test", "none");
    check("mock_calendar.book refuses 20:00 Kyiv time (guardrail in code)", "error" in outside, "error" in outside ? outside.error : "booked!");

    console.log("\n--- Step 8: Brightline (New York) job, Haiku writes the options and reads replies ---");
    const sentSub = async (candidateId: string) => {
      await db.pipelineEntry.update({ where: { jobId_candidateId: { jobId, candidateId } }, data: { stage: "submitted" } });
      return db.submission.create({ data: { jobId, candidateId, clientId: "client-brightline", status: "sent", anonymized: false, format: SUBMISSION_FORMAT, data: {}, agentDraft: {}, decidedAt: new Date() } });
    };
    const iv = (candidateId: string) => db.interview.findUniqueOrThrow({ where: { jobId_candidateId: { jobId, candidateId } } });
    const schedMsgs = (candidateId: string) => msgs({ candidateId, kind: { in: ["scheduling", "scheduling_client"] } });
    // Interview times need approval since 2026-10-08: send the drafted times unchanged, as the recruiter would.
    const sendTimes = async (candidateId: string) => {
      const v = await iv(candidateId);
      const draft = await db.message.findFirst({ where: { jobId, candidateId, kind: "scheduling", status: "awaiting_approval" } });
      if (v.status !== "times_draft" || !draft) return null;
      return scw.approveInterviewTimes(v.id, { subject: draft.subject, body: draft.body, slots: v.proposedSlots as string[] });
    };
    const optionLines = (body: string) => body.split("\n").filter((l) => /^\d\. /.test(l)).map((l) => l.replace(/^\d\. /, ""));
    const runsBefore = await db.agentRun.count({ where: { agent: { in: ["reply-classifier", "prescreen-agent"] }, createdAt: { gte: startedAt } } });

    // TC1: easy overlap (Kraków candidate, Warsaw time, + New York) -> confirmed in 2 messages.
    const sub1 = (await db.submission.findFirst({ where: { jobId, candidateId: "cand-001", status: "sent" } })) ?? (await sentSub("cand-001"));
    const answeredUpTo = (await prescreenOf("cand-001"))?.answeredUpTo?.getTime();
    const rq1 = await scw.requestInterview(sub1.id, { extraTags: ["test"] });
    const draft1 = await iv("cand-001");
    check("Client wants interview -> times drafted for approval, nothing sent yet", draft1.status === "times_draft" && !!(await db.approvalItem.findFirst({ where: { jobId, candidateId: "cand-001", kind: "interview_times", status: "awaiting_approval" } })) && !(await schedMsgs("cand-001")).some((m) => m.status === "sent"), rq1.message);
    const st1 = await sendTimes("cand-001");
    const i1 = await iv("cand-001");
    const opt1 = (await schedMsgs("cand-001"))[0];
    console.log(`      options email to cand-001:\n${opt1?.body.replace(/^/gm, "        ")}`);
    check("Approved -> times sent to the candidate, stage interview", rq1.ok && !!st1?.ok && i1.status === "proposed" && opt1?.status === "sent" && opt1.kind === "scheduling" && (await entry("cand-001")).stage === "interview", rq1.message);
    const lines1 = optionLines(opt1?.body ?? "");
    check("Options: up to 3, each with both time zones stated (Warsaw + New York)", lines1.length >= 1 && lines1.length <= 3 && lines1.every((l) => /Warsaw time \(UTC\+\d\)/.test(l) && /New York time \(UTC-\d\)/.test(l)), `${lines1.length} option(s)`);
    const r1s = await ow.receiveReply(jobId, "cand-001", sampleSchedulingReply(lines1.length > 1 ? "pick2" : "pick1", lines1, "Andriy"), { extraTags: ["test"] });
    const i1b = await iv("cand-001");
    const pickN = lines1.length > 1 ? 2 : 1;
    check(`Candidate picks option ${pickN} -> client asked to confirm that time`, r1s.ok && i1b.status === "awaiting_client" && i1b.chosenSlot?.toISOString() === (i1.proposedSlots as string[])[pickN - 1] && (await schedMsgs("cand-001")).at(-1)?.toEmail === "dana.whitfield@brightline-payments.example", r1s.message);
    const cf = await scw.clientConfirms(i1.id);
    const i1c = await iv("cand-001");
    const events1 = await db.calendarEvent.findMany({ where: { interviewId: i1.id } });
    const s8tc1 = check("TC1 Easy overlap -> confirmed in 2 messages (booked in both calendars)", cf.ok && i1c.status === "confirmed" && i1c.messagesToConfirm === 2 && events1.length === 2, `${cf.message} messages_to_confirm=${i1c.messagesToConfirm}`);
    passedOn.push({ traceId: i1c.traceId, id: "scheduling-s8tc1-easy-overlap", passed: s8tc1 });
    const conf = (await schedMsgs("cand-001")).slice(-2);
    check("Confirmations sent to the candidate and the client", conf.length === 2 && conf.some((m) => m.kind === "scheduling" && /is booked/.test(m.body)) && conf.some((m) => m.kind === "scheduling_client" && /is booked/.test(m.body)), conf.map((m) => m.toEmail).join(", "));
    check("Confirm twice: booked once", !(await scw.clientConfirms(i1.id)).ok && (await db.calendarEvent.count({ where: { interviewId: i1.id } })) === 2, "refused");
    check("Scheduling replies go to the scheduling agent (not the reply classifier, no new pre-screen summary)", (await db.agentRun.count({ where: { agent: { in: ["reply-classifier", "prescreen-agent"] }, createdAt: { gte: startedAt } } })) === runsBefore && (await prescreenOf("cand-001"))?.answeredUpTo?.getTime() === answeredUpTo, "0 classifier / pre-screen runs");

    // TC3: Kyiv candidate (Kharkiv) + New York, then reschedule once (new times), nudge, reschedule again (escalated).
    const sub4 = await sentSub("cand-004");
    const rq4 = await scw.requestInterview(sub4.id, { extraTags: ["test"] });
    await sendTimes("cand-004");
    const i4 = await iv("cand-004");
    const opt4 = (await schedMsgs("cand-004"))[0];
    const slots4 = (i4.proposedSlots as string[]).map((x) => new Date(x));
    console.log(`      options email to cand-004:\n${opt4?.body.replace(/^/gm, "        ")}`);
    const s8tc3 = check("TC3 US client (New York) + Kyiv candidate -> slots within both working hours", rq4.ok && i4.candidateTz === KYIV && slots4.length > 0 && slots4.every((d) => tz.withinWorkingHours(d, KYIV) && tz.withinWorkingHours(d, NY)) && /Kyiv time/.test(opt4?.body ?? "") && /New York time/.test(opt4?.body ?? ""), optionLines(opt4?.body ?? "").join(" | "));
    passedOn.push({ traceId: i4.traceId, id: "scheduling-s8tc3-us-kyiv", passed: s8tc3 });
    check("Greeting uses the Latin first name from earlier emails (profile name is Cyrillic)", !/[Ѐ-ӿ]/.test(opt4?.body ?? "x"), opt4?.body.split("\n")[0] ?? "");
    const rs1 = await ow.receiveReply(jobId, "cand-004", sampleSchedulingReply("reschedule", optionLines(opt4?.body ?? ""), "Oleksandr"), { extraTags: ["test"] });
    await sendTimes("cand-004");
    const i4b = await iv("cand-004");
    const newSlots = i4b.proposedSlots as string[];
    check("Reschedule once -> new times sent (none of the old ones)", rs1.ok && i4b.status === "rescheduled" && i4b.rescheduleCount === 1 && newSlots.length > 0 && newSlots.every((x) => !(i4.proposedSlots as string[]).includes(x)) && (await schedMsgs("cand-004")).length === 2, rs1.message);

    // Reminders and nudges ("Run reminders now"): an hour before the booked interview, then 49h after the last times email.
    const before = (await msgs({ kind: { in: ["scheduling", "scheduling_client"] } })).length;
    const remA = await scw.runSchedulingReminders(jobId, { now: new Date((await iv("cand-001")).confirmedSlot!.getTime() - 3600_000) });
    const remB = await scw.runSchedulingReminders(jobId, { now: new Date((await iv("cand-004")).lastSentAt!.getTime() + 49 * 3600_000) });
    const rem = { ok: remA.ok && remB.ok, message: `${remA.message} / ${remB.message}` };
    const after = await msgs({ kind: { in: ["scheduling", "scheduling_client"] } });
    const i1r = await iv("cand-001");
    const i4r = await iv("cand-004");
    check("Run reminders now: reminder to both sides of the booked interview, nudge to the candidate who didn't answer", rem.ok && i1r.reminderSentAt !== null && i4r.nudgedAt !== null && after.length - before === 3 && after.slice(-3).filter((m) => /reminder/i.test(m.body)).length === 2, rem.message);
    check("Run reminders again: nothing sent twice", (await scw.runSchedulingReminders(jobId, {})).message.startsWith("0 reminder(s), 0 nudge(s)"), "0, 0");

    const rs2 = await ow.receiveReply(jobId, "cand-004", "Hi Anna, sorry, these don't work either, can we look at the week after?\n\nOleksandr", { extraTags: ["test"] });
    const i4c = await iv("cand-004");
    const item4 = await db.approvalItem.findFirst({ where: { jobId, candidateId: "cand-004", kind: "scheduling", status: "awaiting_approval" } });
    check("Reschedule twice -> escalated to the recruiter (approval queue), no new times sent", rs2.ok && i4c.status === "escalated" && !!item4 && (await schedMsgs("cand-004")).length === 3, `${item4?.title}: ${item4?.detail}`);
    const rt = await scw.retryScheduling(i4c.id, { extraTags: ["test"] });
    await sendTimes("cand-004");
    const i4d = await iv("cand-004");
    check("Try again (recruiter): new times sent, queue item closed", rt.ok && i4d.status === "proposed" && !(await db.approvalItem.findFirst({ where: { jobId, candidateId: "cand-004", kind: "scheduling", status: "awaiting_approval" } })), rt.message);

    // Client rejects; never to a declined candidate.
    const sub21 = await sentSub("cand-021");
    const cr = await scw.clientRejects(sub21.id);
    check("Client rejected -> stage client rejected, no interview", cr.ok && (await entry("cand-021")).stage === "client_rejected" && !(await db.interview.findUnique({ where: { jobId_candidateId: { jobId, candidateId: "cand-021" } } })), cr.message);
    check("Client's answer can't be recorded twice", !(await scw.clientRejects(sub21.id)).ok && !(await scw.requestInterview(sub21.id)).ok, "refused");
    const sub2 = await db.submission.create({ data: { jobId, candidateId: "cand-002", clientId: "client-brightline", status: "sent", anonymized: false, format: SUBMISSION_FORMAT, data: {}, agentDraft: {}, decidedAt: new Date() } });
    await db.pipelineEntry.update({ where: { jobId_candidateId: { jobId, candidateId: "cand-002" } }, data: { stage: "declined" } });
    const rq2 = await scw.requestInterview(sub2.id, { extraTags: ["test"] });
    check("Never to a candidate who said no: refused, nothing sent", !rq2.ok && !(await db.interview.findUnique({ where: { jobId_candidateId: { jobId, candidateId: "cand-002" } } })) && !(await schedMsgs("cand-002")).length, rq2.message);

    // TC2: no overlap (the candidate is booked for the next week and a half) -> escalated, no email, no AI run.
    const haikuBefore = await db.agentRun.count({ where: { agent: "scheduling-agent", createdAt: { gte: startedAt } } });
    const sub3 = await sentSub("cand-003");
    const block = await db.calendarEvent.create({ data: { person: "cand-003", startsAt: new Date(), endsAt: new Date(Date.now() + 10 * 24 * 3600_000), title: "Busy (test: fully booked)" } });
    const nr = await scw.requestInterview(sub3.id, { extraTags: ["test"] });
    await db.calendarEvent.delete({ where: { id: block.id } });
    const i3 = await iv("cand-003");
    const item3 = await db.approvalItem.findFirst({ where: { jobId, candidateId: "cand-003", kind: "scheduling", status: "awaiting_approval" } });
    const s8tc2 = check("TC2 No overlap -> escalated (approval queue), nothing sent, no AI run", i3.status === "escalated" && !!item3 && !(await schedMsgs("cand-003")).length && (await db.agentRun.count({ where: { agent: "scheduling-agent", createdAt: { gte: startedAt } } })) === haikuBefore, `${nr.message}`);
    passedOn.push({ traceId: i3.traceId, id: "scheduling-s8tc2-no-overlap", passed: s8tc2 });
    check("AC2 Conflicts escalate instead of guessing (no overlap, 2nd reschedule)", s8tc2 && i4c.status === "escalated", "2 cases");
    check("The no-overlap block only affects that candidate: the booked interview with the same client is untouched", (await iv("cand-001")).status === "confirmed" && (await db.calendarEvent.count({ where: { interviewId: i1.id } })) === 2, "cand-001 still booked");

    // Guardrails over everything sent in this test.
    const allSched = await msgs({ kind: { in: ["scheduling", "scheduling_client"] } });
    const withTimes = allSched.filter((m) => /\d{2}:\d{2}/.test(m.body));
    check("Every scheduling message with a time states the time zone (city + UTC offset)", withTimes.length > 0 && withTimes.every((m) => /time \(UTC[+-]\d+\)/.test(m.body)), `${withTimes.length} message(s)`);
    const everySlot = (await db.interview.findMany({ where: { jobId } })).flatMap((x) => [...(x.proposedSlots as string[]), ...(x.pastSlots as string[])].map((d) => ({ d: new Date(d), c: x.candidateTz!, k: x.clientTz })));
    check("AC1 Time zones correct: every proposed time inside 09:00-19:00 for both sides", everySlot.length > 0 && everySlot.every((x) => tz.withinWorkingHours(x.d, x.c) && tz.withinWorkingHours(x.d, x.k)), `${everySlot.length} slots checked`);
  } finally {
    // Langfuse: the agent's dataset (src/evals/datasets.ts) + test_passed on the traces of the spec's test cases.
    const { syncDataset } = await import("@/evals/datasets");
    await syncDataset(langfuse, "prescreen-agent");
    await syncDataset(langfuse, "submission-agent");
    await syncDataset(langfuse, "scheduling-agent");
    for (const r of passedOn) if (r.traceId) langfuse.score.create({ traceId: r.traceId, name: "test_passed", value: r.passed ? 1 : 0, comment: r.id });
    await flushTelemetry();

    // Remove the test rows (messages, pipeline, pre-screens, interviews go with the job; agent_runs keep their real cost).
    const testInterviews = await db.interview.findMany({ where: { jobId }, select: { id: true } });
    await db.calendarEvent.deleteMany({ where: { OR: [{ interviewId: { in: testInterviews.map((x) => x.id) } }, { title: { startsWith: "Busy (demo" }, createdAt: { gte: startedAt } }] } });
    await db.approvalItem.deleteMany({ where: { jobId } });
    await db.agentRun.updateMany({ where: { jobId }, data: { jobId: null } });
    await db.job.delete({ where: { id: jobId } });
    await db.jobSpec.delete({ where: { id: specRow.id } });
    if (job2) {
      await db.approvalItem.deleteMany({ where: { jobId: job2.id } });
      await db.agentRun.updateMany({ where: { jobId: job2.id }, data: { jobId: null } });
      await db.job.delete({ where: { id: job2.id } });
      await db.jobSpec.delete({ where: { id: job2.specId } });
    }
    await db.clientBrief.deleteMany({ where: { id: { in: [brief1.id, brief2.id] } } });
  }

  const spent = await db.agentRun.groupBy({ by: ["agent"], where: { createdAt: { gte: startedAt } }, _sum: { costUsd: true }, _count: true, _max: { costUsd: true } });
  console.log("\nCost of this test run:");
  for (const s of spent) console.log(`  ${s.agent}: ${s._count} run(s), $${(s._sum.costUsd ?? 0).toFixed(4)} (max $${(s._max.costUsd ?? 0).toFixed(4)})`);
  console.log(`  total: $${spent.reduce((n, s) => n + (s._sum.costUsd ?? 0), 0).toFixed(4)}`);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
