// Step 6 workflow (docs/specs/06-prescreen-agent.md): interested reply -> questions (drafted; sent after the recruiter
// approves them on the send screen, changed 2026-10-08) ->
// answers -> summary -> stage prescreened. "discuss" goes to the approval queue; the recruiter's call
// (submit / don't submit) is saved and scored. Driven by database state, so it can stop and resume anywhere.
import { db } from "@/lib/db";
import { OPT_OUT_LINE } from "@/config/outreach";
import type { WorkflowResult } from "../job-spec/workflow";
import type { CandidateProfileData } from "../enrichment/schema";
import { flushTelemetry } from "../telemetry";
import { getThread, threadText, type ThreadMessage } from "../tools/mock-inbox";
import { ensureBudget, loadJob, PausedForBudget, queueJobProblem, score, type LoadedJob, type Problem } from "../pipeline/shared";
import { questionsEmail, runPrescreenQuestions, runPrescreenSummary } from "./agent";
import { completeness, missingAnswers, type PrescreenQuestion, type PrescreenSummary } from "./schema";

export type RunOptions = { extraTags?: string[] };
// Marks a candidate message as answers to our questions (it is summarized, never sent to the reply classifier).
export const ANSWER_INTENT = "prescreen_answer";

async function context(job: LoadedJob, candidateId: string) {
  const [candidate, profileRow] = await Promise.all([
    db.candidate.findUniqueOrThrow({ where: { id: candidateId } }),
    db.candidateProfile.findUnique({ where: { candidateId } }),
  ]);
  const profile = profileRow?.data as CandidateProfileData | undefined;
  return { candidate, profile, email: profile?.contacts.email ?? null };
}

// ---------- questions ----------

// Writes the questions as a draft for the send screen (status questions_draft; sent when the recruiter approves).
// The caller refreshes the "Send outreach" queue item. Returns a problem instead of throwing.
export async function startPrescreen(job: LoadedJob, candidateId: string, opts: RunOptions = {}): Promise<Problem | null> {
  if (await db.prescreen.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId } } })) return null;
  const entry = await db.pipelineEntry.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId } } });
  if (!entry || entry.stage === "declined") return null; // said no in the meantime: no pre-screen
  const ctx = await context(job, candidateId);
  if (!ctx.profile || !ctx.email) return { candidateId, runs: [], error: "No profile or email for this candidate" };
  const thread = await getThread(job.id, candidateId);
  await ensureBudget(job.id, 6);
  const r = await runPrescreenQuestions({
    jobId: job.id,
    clientId: job.clientId,
    spec: job.spec,
    candidateId,
    fullName: ctx.candidate.fullName,
    profile: ctx.profile,
    thread: threadText(thread),
    extraTags: opts.extraTags,
  });
  if (!r.data) return { candidateId, runs: r.runs, error: r.error };
  const last = r.runs.at(-1)!;
  const msg = await createQuestionsDraft(job, candidateId, thread, ctx.email, r.data.first_name, r.data.questions, r.runs.map((x) => x.runId), last.traceId);
  await db.prescreen.create({
    data: {
      jobId: job.id,
      candidateId,
      status: "questions_draft",
      questions: r.data.questions,
      questionsMessageId: msg.id,
      questionsTraceId: last.traceId,
      agentRunIds: r.runs.map((x) => x.runId),
    },
  });
  return null;
}

async function createQuestionsDraft(
  job: LoadedJob,
  candidateId: string,
  thread: ThreadMessage[],
  email: string,
  firstName: string,
  questions: PrescreenQuestion[],
  agentRunIds: string[],
  traceId: string,
  previousMessageId?: string,
) {
  const first = thread.find((m) => m.kind === "first" && m.status === "sent");
  const subject = `Re: ${(first?.subject ?? job.spec.title).replace(/^(Re:\s*)+/i, "")}`;
  const body = questionsEmail(firstName, questions);
  return db.message.create({
    data: {
      jobId: job.id,
      candidateId,
      direction: "outbound",
      kind: "prescreen",
      status: "awaiting_approval",
      toEmail: email,
      subject,
      body,
      footer: OPT_OUT_LINE,
      agentDraft: { subject, body },
      previousMessageId,
      agentRunIds,
      traceId,
    },
  });
}

// The recruiter rejected the questions draft with a comment (send screen): the agent writes new questions.
export async function redraftQuestions(job: LoadedJob, rejected: ThreadMessage, opts: RunOptions = {}): Promise<Problem | null> {
  const pre = await db.prescreen.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId: rejected.candidateId } } });
  const ctx = await context(job, rejected.candidateId);
  if (!pre || !ctx.profile || !ctx.email) return { candidateId: rejected.candidateId, runs: [], error: "No pre-screen, profile or email for this candidate" };
  const thread = await getThread(job.id, rejected.candidateId);
  await ensureBudget(job.id, 6);
  const r = await runPrescreenQuestions({
    jobId: job.id,
    clientId: job.clientId,
    spec: job.spec,
    candidateId: rejected.candidateId,
    fullName: ctx.candidate.fullName,
    profile: ctx.profile,
    thread: threadText(thread),
    previous: { body: rejected.body, comment: rejected.rejectComment ?? "" },
    extraTags: opts.extraTags,
  });
  if (!r.data) return { candidateId: rejected.candidateId, runs: r.runs, error: r.error };
  const last = r.runs.at(-1)!;
  const runIds = r.runs.map((x) => x.runId);
  const msg = await createQuestionsDraft(job, rejected.candidateId, thread, ctx.email, r.data.first_name, r.data.questions, runIds, last.traceId, rejected.id);
  await db.prescreen.update({
    where: { id: pre.id },
    data: { questions: r.data.questions, questionsMessageId: msg.id, questionsTraceId: last.traceId, agentRunIds: [...(pre.agentRunIds as string[]), ...runIds] },
  });
  return null;
}

// "Start pre-screen" button (Job page): candidates who replied before Step 6 existed, or with another intent.
export async function startPrescreenNow(jobId: string, candidateId: string, opts: RunOptions = {}): Promise<WorkflowResult> {
  const entry = await db.pipelineEntry.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
  if (entry?.stage !== "replied") return { ok: false, message: "Only candidates who replied can be pre-screened." };
  if (await db.prescreen.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } })) return { ok: false, message: "Pre-screen already started." };
  const job = await loadJob(jobId);
  try {
    const problem = await startPrescreen(job, candidateId, opts);
    if (problem) await queueJobProblem(job, 6, "pre-screen questions", [problem]);
    const { syncOutreachItem } = await import("../outreach/workflow");
    await syncOutreachItem(jobId);
    await flushTelemetry();
    return problem
      ? { ok: false, message: "Writing the questions failed or went over budget; see the approval queue (Try again)." }
      : { ok: true, message: "Pre-screen questions drafted: review and send them in the approval queue (Send outreach).", jobId };
  } catch (e) {
    if (e instanceof PausedForBudget) return { ok: false, message: "The job reached its budget: the pre-screen starts after 'Continue' in the approval queue." };
    throw e;
  }
}

// ---------- answers -> summary ----------

async function syncReviewItem(job: LoadedJob, candidateId: string, fullName: string, s: PrescreenSummary | null, decided: boolean) {
  const open = await db.approvalItem.findFirst({ where: { jobId: job.id, candidateId, kind: "prescreen_review", status: "awaiting_approval" } });
  const wanted = s?.recommendation === "discuss" && !decided;
  if (!wanted) {
    if (open) await db.approvalItem.update({ where: { id: open.id }, data: { status: decided ? "approved" : "dismissed", decidedAt: new Date() } });
    return;
  }
  const missing = missingAnswers(s);
  const detail = [
    s.red_flags.length ? `Red flags: ${s.red_flags.join("; ")}.` : null,
    missing.length ? `Not answered: ${missing.length} of ${s.answers.length} questions.` : null,
    s.summary,
  ]
    .filter(Boolean)
    .join(" ");
  if (open) await db.approvalItem.update({ where: { id: open.id }, data: { detail } });
  else {
    await db.approvalItem.create({
      data: { kind: "prescreen_review", step: 6, status: "awaiting_approval", title: `Review pre-screen: ${fullName} (${job.title})`, detail, clientId: job.clientId, jobId: job.id, candidateId },
    });
  }
}

// Summarizes everything the candidate wrote after the questions (again, if more answers arrived since).
export async function summarizePrescreen(job: LoadedJob, candidateId: string, opts: RunOptions = {}): Promise<Problem | null> {
  const pre = await db.prescreen.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId } } });
  if (!pre) return null;
  const thread = await getThread(job.id, candidateId);
  const asked = thread.find((m) => m.id === pre.questionsMessageId);
  // Only messages marked as answers (receiveAnswers): later Step 8 scheduling replies and client replies are not answers.
  const answers = thread.filter((m) => m.direction === "inbound" && m.intent === ANSWER_INTENT && asked?.sentAt && m.sentAt! > asked.sentAt);
  const latest = answers.at(-1);
  if (!latest || (pre.answeredUpTo && latest.sentAt! <= pre.answeredUpTo)) return null; // nothing new
  const ctx = await context(job, candidateId);
  if (!ctx.profile) return { candidateId, runs: [], error: "No profile for this candidate" };
  await ensureBudget(job.id, 6);
  const r = await runPrescreenSummary({
    jobId: job.id,
    clientId: job.clientId,
    spec: job.spec,
    candidateId,
    fullName: ctx.candidate.fullName,
    profile: ctx.profile,
    thread: threadText(thread),
    questions: pre.questions as PrescreenQuestion[],
    extraTags: opts.extraTags,
  });
  if (!r.data) return { candidateId, runs: r.runs, error: r.error };
  const last = r.runs.at(-1)!;
  const done = completeness(r.data);
  await db.prescreen.update({
    where: { id: pre.id },
    data: {
      status: "summarized",
      data: r.data,
      recommendation: r.data.recommendation,
      completeness: done,
      answeredUpTo: latest.sentAt,
      traceId: last.traceId,
      agentRunIds: [...(pre.agentRunIds as string[]), ...r.runs.map((x) => x.runId)],
    },
  });
  await db.pipelineEntry.updateMany({ where: { jobId: job.id, candidateId, stage: { in: ["replied", "prescreened"] } }, data: { stage: "prescreened" } });
  await score(last.traceId, { answers_completeness: Number(done.toFixed(3)) });
  await syncReviewItem(job, candidateId, ctx.candidate.fullName, r.data, !!pre.decision);
  return null;
}

// Answers arrive (prototype: "Simulate answers" on the Job page, via receiveReply in outreach/workflow).
export async function receiveAnswers(jobId: string, candidateId: string, inboundId: string, opts: RunOptions = {}): Promise<WorkflowResult> {
  await db.message.update({ where: { id: inboundId }, data: { intent: ANSWER_INTENT } });
  const job = await loadJob(jobId);
  try {
    const problem = await summarizePrescreen(job, candidateId, opts);
    if (problem) await queueJobProblem(job, 6, "pre-screen summary", [problem]);
    await flushTelemetry();
    if (problem) return { ok: false, message: "Answers saved, but the summary failed; see the approval queue (Try again)." };
    const pre = await db.prescreen.findUniqueOrThrow({ where: { jobId_candidateId: { jobId, candidateId } } });
    const s = pre.data as PrescreenSummary;
    const missing = missingAnswers(s).length;
    return {
      ok: true,
      message: `Answers summarized: recommendation "${s.recommendation}"${s.red_flags.length ? `, ${s.red_flags.length} red flag(s)` : ""}${missing ? `, ${missing} question(s) not answered` : ""}.${s.recommendation === "discuss" ? " Waiting for you in the approval queue." : ""}`,
      jobId,
    };
  } catch (e) {
    if (e instanceof PausedForBudget) return { ok: false, message: "Answers saved. The job reached its budget, so they're summarized after 'Continue' in the approval queue." };
    throw e;
  }
}

// ---------- missing work (called by the job's Step 5-6 run: resume, Try again, Continue) ----------

export async function prescreenStep(job: LoadedJob, opts: RunOptions = {}) {
  const entries = await db.pipelineEntry.findMany({ where: { jobId: job.id, stage: { in: ["replied", "prescreened"] } } });
  const prescreens = await db.prescreen.findMany({ where: { jobId: job.id } });
  const inbound = await db.message.findMany({ where: { jobId: job.id, direction: "inbound" }, orderBy: { sentAt: "asc" } });
  // Interested replies whose questions were never sent (run failed, budget pause, app restarted).
  const startTodo = entries.filter((e) => !prescreens.some((p) => p.candidateId === e.candidateId) && inbound.filter((m) => m.candidateId === e.candidateId).at(-1)?.intent === "interested");
  const problems: Problem[] = [];
  try {
    for (const e of startTodo) {
      const p = await startPrescreen(job, e.candidateId, opts);
      if (p) problems.push(p);
    }
    // Answers not summarized yet (summarizePrescreen skips candidates with nothing new).
    for (const p of prescreens) {
      const problem = await summarizePrescreen(job, p.candidateId, opts);
      if (problem) problems.push(problem);
    }
  } finally {
    await queueJobProblem(job, 6, "pre-screen", problems);
    await flushTelemetry();
  }
}

// ---------- recruiter's call ----------

export type PrescreenDecision = "submit" | "dont_submit";

// Saves the recruiter's call once and scores recruiter_agreed_with_recommendation for "proceed" (agree = submit)
// and "stop" (agree = don't submit); "discuss" leaves the call to the recruiter. Closes the "Review pre-screen" item.
// Also used by Step 7: approving a submission = submit, "Don't submit" there = don't submit.
export async function recordPrescreenDecision(jobId: string, candidateId: string, decision: PrescreenDecision): Promise<boolean> {
  const pre = await db.prescreen.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
  if (!pre || pre.status !== "summarized") return false;
  const { count } = await db.prescreen.updateMany({ where: { id: pre.id, decision: null }, data: { decision, decidedAt: new Date() } });
  if (!count) return false;
  if (pre.recommendation === "proceed" || pre.recommendation === "stop") {
    const agreed = (pre.recommendation === "proceed") === (decision === "submit");
    await score(pre.traceId, { recruiter_agreed_with_recommendation: agreed ? 1 : 0 });
  }
  const items = await db.approvalItem.findMany({ where: { jobId, candidateId, kind: "prescreen_review", status: "awaiting_approval" } });
  for (const i of items) await db.approvalItem.update({ where: { id: i.id }, data: { status: decision === "submit" ? "approved" : "rejected", decidedAt: new Date() } });
  await flushTelemetry();
  return true;
}

// After reading the summary: prepare a submission (Step 7 drafts it; the caller starts the job's run), or not.
export async function decidePrescreen(jobId: string, candidateId: string, decision: PrescreenDecision): Promise<WorkflowResult> {
  const pre = await db.prescreen.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
  if (!pre || pre.status !== "summarized") return { ok: false, message: "There's no pre-screen summary to decide on yet." };
  if (pre.decision) return { ok: false, message: "Already decided." };
  if (!(await recordPrescreenDecision(jobId, candidateId, decision))) return { ok: false, message: "Already decided." };
  return decision === "submit"
    ? { ok: true, message: "Saved. The submission agent is writing the client profile (about 20s); it then waits for the account manager in the approval queue.", jobId }
    : { ok: true, message: "Saved: not submitting this candidate.", jobId };
}
