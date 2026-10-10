// Step 5 workflow (docs/specs/05-outreach-agent.md): drafts -> send approval -> mock_inbox -> replies -> follow-ups.
// Driven by database state (job status, message status), so it can stop and resume at any point.
// Only approveDrafts() sends, and only drafts a human approved.
import { db } from "@/lib/db";
import { OUTREACH_CONCURRENCY } from "@/config/budgets";
import { FOLLOW_UP_AFTER_DAYS, MAX_FOLLOW_UPS, OPT_OUT_LINE, OUT_OF_OFFICE_DEFAULT_DAYS } from "@/config/outreach";
import type { WorkflowResult } from "../job-spec/workflow";
import type { CandidateProfileData } from "../enrichment/schema";
import type { ScreeningData } from "../screening/schema";
import { getTelemetry, flushTelemetry } from "../telemetry";
import { getThread, receive, send, threadText, type ThreadMessage } from "../tools/mock-inbox";
import { closeItems, ensureBudget, heartbeat, loadJob, PausedForBudget, pool, queueJobProblem, score, setStatus, type LoadedJob, type Problem } from "../pipeline/shared";
import { rateWarning, runOutreachDraftAgent, runReplyClassifier, type DraftMode } from "./agent";
import { prescreenStep, receiveAnswers, redraftQuestions, startPrescreen } from "../prescreen/workflow";
import { submissionStep } from "../submission/workflow";
import { receiveSchedulingReply, schedulingStep } from "../scheduling/workflow";
import type { Intent, ReplyClassification } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING = "awaiting_approval";
export const NO_EMAIL_NOTE = "No email in profile: contact manually";

export type RunOptions = { extraTags?: string[] };

// ---------- context for one candidate ----------

async function candidateContext(job: LoadedJob, candidateId: string) {
  const [candidate, profileRow, screening, client] = await Promise.all([
    db.candidate.findUniqueOrThrow({ where: { id: candidateId } }),
    db.candidateProfile.findUnique({ where: { candidateId } }),
    db.screeningResult.findFirst({ where: { jobId: job.id, candidateId, current: true } }),
    db.client.findUniqueOrThrow({ where: { id: job.clientId } }),
  ]);
  const profile = profileRow?.data as CandidateProfileData | undefined;
  const reasons = (screening?.data as ScreeningData | null)?.reasons ?? screening?.filterReason ?? null;
  const why = [reasons, screening?.overrideNote ? `Recruiter's note: ${screening.overrideNote}` : null].filter(Boolean).join("\n") || null;
  return { candidate, profile, email: profile?.contacts.email ?? null, why, clientName: client.name };
}

// One draft run, saved as an awaiting_approval message. Returns a problem instead of throwing.
async function draftMessage(
  job: LoadedJob,
  candidateId: string,
  mode: DraftMode,
  opts: RunOptions & { sequenceStep: number | null; previous?: { id: string; subject: string; body: string; comment: string; replyToId: string | null } },
): Promise<Problem | null> {
  const ctx = await candidateContext(job, candidateId);
  if (!ctx.profile || !ctx.email) return null; // no email: never drafted (see NO_EMAIL_NOTE)
  const thread = await getThread(job.id, candidateId);
  await ensureBudget(job.id, 5);
  const r = await runOutreachDraftAgent({
    jobId: job.id,
    clientId: job.clientId,
    clientName: ctx.clientName,
    spec: job.spec,
    candidateId,
    fullName: ctx.candidate.fullName,
    profile: ctx.profile,
    shortlistReasons: ctx.why,
    mode,
    sequenceStep: opts.sequenceStep,
    thread: threadText(thread),
    previousDraft: opts.previous,
    extraTags: opts.extraTags,
  });
  const last = r.runs.at(-1)!;
  if (!r.data) return { candidateId, runs: r.runs, error: r.error };
  await db.message.create({
    data: {
      jobId: job.id,
      candidateId,
      direction: "outbound",
      kind: mode,
      sequenceStep: opts.sequenceStep,
      status: PENDING,
      toEmail: ctx.email,
      subject: r.data.subject,
      body: r.data.body,
      footer: OPT_OUT_LINE,
      agentDraft: { subject: r.data.subject, body: r.data.body },
      hooks: r.data.personalization_hooks,
      previousMessageId: opts.previous?.id ?? null,
      replyToId: opts.previous?.replyToId ?? null,
      warning: mode === "reply" ? rateWarning(r.data.body, job.spec.rate_range) : null,
      agentRunIds: r.runs.map((x) => x.runId),
      traceId: last.traceId,
    },
  });
  return null;
}

// ---------- approval queue item (one per job while drafts wait) ----------

export async function syncOutreachItem(jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const pending = await db.message.findMany({ where: { jobId, status: PENDING, kind: { not: "scheduling" } } });
  const open = await db.approvalItem.findFirst({ where: { jobId, kind: "outreach", status: PENDING } });
  if (!pending.length) {
    if (open) await closeItems(jobId, ["outreach"], "approved");
    return;
  }
  const n = (k: string) => pending.filter((m) => m.kind === k).length;
  const parts = [
    n("first") && `${n("first")} first message(s)`,
    n("follow_up") && `${n("follow_up")} follow-up(s)`,
    n("reply") && `${n("reply")} reply(ies) to candidates`,
    n("prescreen") && `${n("prescreen")} pre-screen question email(s)`,
  ].filter(Boolean);
  const noEmail = await db.pipelineEntry.count({ where: { jobId, outreachNote: NO_EMAIL_NOTE, stage: "shortlisted" } });
  const detail = `${parts.join(", ")} waiting for approval.${noEmail ? ` ${noEmail} shortlisted candidate(s) have no email: contact them manually.` : ""}`;
  if (open) await db.approvalItem.update({ where: { id: open.id }, data: { detail } });
  else {
    await db.approvalItem.create({
      data: { kind: "outreach", step: 5, status: PENDING, title: `Send outreach: ${job.title}`, detail, clientId: job.clientId, jobId },
    });
  }
}

// ---------- the automatic step (job status drafting_outreach) ----------

// Does whatever Step 5 work is missing: first messages for shortlisted candidates, redrafts whose run
// failed, and replies not classified yet. Then the job waits (status "outreach") for humans and replies.
export async function outreachStep(job: LoadedJob, opts: RunOptions = {}) {
  const entries = await db.pipelineEntry.findMany({ where: { jobId: job.id } });
  const messages = await db.message.findMany({ where: { jobId: job.id } });
  const profiles = await db.candidateProfile.findMany({ where: { candidateId: { in: entries.map((e) => e.candidateId) } } });
  const emailOf = (id: string) => (profiles.find((p) => p.candidateId === id)?.data as CandidateProfileData | undefined)?.contacts.email ?? null;

  // Shortlisted candidates without email: no draft, a note for the recruiter (with LinkedIn if known).
  for (const e of entries.filter((x) => x.stage === "shortlisted" && !emailOf(x.candidateId) && !x.outreachNote)) {
    await db.pipelineEntry.update({ where: { id: e.id }, data: { outreachNote: NO_EMAIL_NOTE } });
  }
  const firstTodo = entries.filter((e) => e.stage === "shortlisted" && emailOf(e.candidateId) && !messages.some((m) => m.candidateId === e.candidateId && m.kind === "first"));
  // A reject whose redraft failed (or was interrupted): the rejected draft has no successor.
  // Skipped when the candidate replied after it (the reply made it stale).
  const redraftTodo = messages.filter(
    (m) =>
      m.status === "rejected" &&
      !messages.some((x) => x.previousMessageId === m.id) &&
      !messages.some((x) => x.candidateId === m.candidateId && x.direction === "inbound" && x.createdAt > m.createdAt),
  );
  // Answers to pre-screen questions and replies about interview times are marked when they arrive (intent
  // prescreen_answer / scheduling_reply), and client replies are client_reply, so they're never classified here.
  const classifyTodo = messages.filter((m) => m.direction === "inbound" && !m.intent);

  const problems: Problem[] = [];
  try {
    await pool(firstTodo, OUTREACH_CONCURRENCY, async (e) => {
      const p = await draftMessage(job, e.candidateId, "first", { ...opts, sequenceStep: 1 });
      if (p) problems.push(p);
      await heartbeat(job.id);
    });
    for (const m of redraftTodo) {
      const p = await redraft(job, m, opts);
      if (p) problems.push(p);
    }
    for (const m of classifyTodo) {
      const p = await classify(job, m.id, opts);
      if (p) problems.push(p);
    }
  } finally {
    await queueJobProblem(job, 5, "outreach", problems, firstTodo.length + redraftTodo.length + classifyTodo.length);
    await syncOutreachItem(job.id);
    await flushTelemetry();
  }
  // Step 6 work that is missing: questions for interested replies, summaries of new answers.
  await prescreenStep(job, opts);
  // Step 7: submissions for "proceed" pre-screens and the recruiter's "Prepare submission".
  await submissionStep(job, opts);
  // Step 8: interview times not sent yet, candidate replies about times not read yet.
  await schedulingStep(job, opts);
  await setStatus(job.id, "outreach");
}

// Jobs shortlisted before Phase 3: "Draft outreach" button.
export async function canStartOutreach(jobId: string): Promise<WorkflowResult> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!["shortlisted", "outreach"].includes(job.status)) return { ok: false, message: `This job is ${job.status.replaceAll("_", " ")}.` };
  await setStatus(jobId, "drafting_outreach");
  return { ok: true, message: "Drafting outreach messages. They appear in the approval queue in about a minute.", jobId };
}

// ---------- approve (= send) / reject (= redraft) ----------

export type DraftDecision = { messageId: string; subject: string; body: string };

export async function approveDrafts(decisions: DraftDecision[]): Promise<WorkflowResult> {
  if (!decisions.length) return { ok: false, message: "Select at least one draft." };
  for (const d of decisions) {
    if (!d.subject.trim() || !d.body.trim()) return { ok: false, message: "Subject and body can't be empty." };
  }
  const { langfuse } = getTelemetry();
  let sent = 0;
  const errors: string[] = [];
  const jobIds = new Set<string>();
  for (const d of decisions) {
    const draft = await db.message.findUnique({ where: { id: d.messageId } });
    if (!draft || draft.status !== PENDING || draft.kind === "scheduling") continue; // interview times: their own screen
    // Guardrail: nothing goes to someone who said no or asked to stop (even if a draft slipped through).
    const entry = await db.pipelineEntry.findUnique({ where: { jobId_candidateId: { jobId: draft.jobId, candidateId: draft.candidateId } } });
    if (entry?.stage === "declined") {
      await db.message.update({ where: { id: draft.id }, data: { status: "cancelled", decidedAt: new Date() } });
      jobIds.add(draft.jobId);
      continue;
    }
    const result = await send(draft.id, { subject: d.subject.trim(), body: d.body.trim() });
    if (!result.ok) {
      if (result.error) errors.push(result.error);
      continue;
    }
    sent++;
    jobIds.add(draft.jobId);
    // Step 6 questions (approved on this screen since 2026-10-08): the pre-screen now waits for answers.
    if (draft.kind === "prescreen") await db.prescreen.updateMany({ where: { questionsMessageId: draft.id }, data: { status: "questions_sent" } });
    if (draft.kind === "first") {
      await db.pipelineEntry.updateMany({ where: { jobId: draft.jobId, candidateId: draft.candidateId, stage: "shortlisted" }, data: { stage: "contacted" } });
    }
    const agent = draft.agentDraft as { subject: string; body: string } | null;
    const unedited = !!agent && agent.subject === d.subject.trim() && agent.body.trim() === d.body.trim();
    await score(draft.traceId, { approved_without_edits: unedited ? 1 : 0 });
    // reply_received starts at 0 and becomes 1 (same score id) if they reply.
    if (draft.traceId) langfuse.score.create({ id: `reply_received-${draft.id}`, traceId: draft.traceId, name: "reply_received", value: 0 });
  }
  for (const id of jobIds) await syncOutreachItem(id);
  await flushTelemetry();
  const failed = errors.length ? ` ${errors.length} not sent, still waiting: ${errors[0]}` : "";
  const skipped = decisions.length - sent - errors.length;
  return sent
    ? { ok: !errors.length, message: `${sent} message(s) sent.${skipped ? ` ${skipped} skipped (already decided).` : ""}${failed}` }
    : { ok: false, message: errors.length ? `Nothing sent.${failed}` : "Nothing sent: these drafts were already decided." };
}

async function redraft(job: LoadedJob, rejected: ThreadMessage, opts: RunOptions): Promise<Problem | null> {
  const mode = rejected.kind as DraftMode;
  return draftMessage(job, rejected.candidateId, mode, {
    ...opts,
    sequenceStep: rejected.sequenceStep,
    previous: { id: rejected.id, subject: rejected.subject, body: rejected.body, comment: rejected.rejectComment ?? "", replyToId: rejected.replyToId },
  });
}

// Reject with a comment: the draft is kept as "rejected" and the agent writes a new one (waits ~15s).
export async function rejectDraft(messageId: string, comment: string, opts: RunOptions = {}): Promise<WorkflowResult> {
  if (!comment.trim()) return { ok: false, message: "Add a comment so the agent knows what to change." };
  const draft = await db.message.findUniqueOrThrow({ where: { id: messageId } });
  if (draft.status !== PENDING) return { ok: false, message: "This draft was already decided." };
  const { count } = await db.message.updateMany({
    where: { id: messageId, status: PENDING },
    data: { status: "rejected", rejectComment: comment.trim(), decidedAt: new Date() },
  });
  if (!count) return { ok: false, message: "This draft was already decided." };
  await score(draft.traceId, { approved_without_edits: 0 });
  const job = await loadJob(draft.jobId);
  try {
    const rejected = { ...draft, status: "rejected", rejectComment: comment.trim() };
    const isQuestions = draft.kind === "prescreen";
    const problem = isQuestions ? await redraftQuestions(job, rejected, opts) : await redraft(job, rejected, opts);
    if (problem) await queueJobProblem(job, isQuestions ? 6 : 5, isQuestions ? "pre-screen questions redraft" : "outreach redraft", [problem]);
    await syncOutreachItem(job.id);
    await flushTelemetry();
    return problem
      ? { ok: false, message: "The redraft failed or went over budget; see the approval queue (Try again)." }
      : { ok: true, message: "Redrafted. The new version is below." };
  } catch (e) {
    if (e instanceof PausedForBudget) return { ok: false, message: "Rejected, but the job reached its budget: the redraft waits for 'Continue' in the approval queue." };
    throw e;
  }
}

// ---------- replies ----------

// Stage and follow-up rules for an intent (specs/05 "On reply" table). Re-applied when a recruiter corrects it.
async function applyIntent(jobId: string, candidateId: string, intent: Intent, returnDate: string | null, receivedAt: Date) {
  const entry = await db.pipelineEntry.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
  if (!entry) return;
  const date = returnDate ? new Date(`${returnDate}T00:00:00Z`) : null;
  const data =
    intent === "not_interested"
      ? { stage: "declined", followUpsStopped: "Said no or asked to stop", followUpsPausedUntil: null }
      : intent === "out_of_office"
        ? {
            stage: ["replied", "declined"].includes(entry.stage) ? entry.stage : "contacted",
            followUpsStopped: null,
            followUpsPausedUntil: date && date > receivedAt ? date : new Date(receivedAt.getTime() + OUT_OF_OFFICE_DEFAULT_DAYS * DAY_MS),
          }
        : {
            stage: "replied",
            followUpsStopped: intent === "later" ? `Asked to be contacted later${returnDate ? ` (re-contact from ${returnDate})` : ""}` : "Replied",
            followUpsPausedUntil: null,
          };
  await db.pipelineEntry.update({ where: { id: entry.id }, data });
}

async function classify(job: LoadedJob, inboundId: string, opts: RunOptions): Promise<Problem | null> {
  const inbound = await db.message.findUniqueOrThrow({ where: { id: inboundId } });
  const ctx = await candidateContext(job, inbound.candidateId);
  const thread = (await getThread(job.id, inbound.candidateId)).filter((m) => (m.sentAt ?? m.createdAt) <= (inbound.sentAt ?? inbound.createdAt));
  await ensureBudget(job.id, 5);
  const r = await runReplyClassifier({
    jobId: job.id,
    clientId: job.clientId,
    spec: job.spec,
    candidateId: inbound.candidateId,
    fullName: ctx.candidate.fullName,
    thread: threadText(thread),
    extraTags: opts.extraTags,
  });
  if (!r.data) return { candidateId: inbound.candidateId, runs: r.runs, error: r.error };
  const c: ReplyClassification = r.data;
  const last = r.runs.at(-1)!;
  await db.message.update({
    where: { id: inbound.id },
    data: { classification: c, intent: c.intent, agentRunIds: r.runs.map((x) => x.runId), traceId: last.traceId },
  });
  await applyIntent(job.id, inbound.candidateId, c.intent, c.return_date, inbound.sentAt ?? inbound.createdAt);

  // reply_received = 1 on the last message we sent (an auto-reply doesn't count).
  if (c.intent !== "out_of_office") {
    const lastSent = thread.filter((m) => m.status === "sent").at(-1);
    if (lastSent?.traceId) getTelemetry().langfuse.score.create({ id: `reply_received-${lastSent.id}`, traceId: lastSent.traceId, name: "reply_received", value: 1 });
  }
  // Step 6 starts right away for "interested": pre-screen questions are drafted for the send screen.
  if (c.intent === "interested") {
    const p = await startPrescreen(job, inbound.candidateId, opts);
    if (p) await queueJobProblem(job, 6, "pre-screen questions", [p]);
  }
  if (c.suggested_reply && ctx.email) {
    const first = thread.find((m) => m.kind === "first" && m.status === "sent");
    await db.message.create({
      data: {
        jobId: job.id,
        candidateId: inbound.candidateId,
        direction: "outbound",
        kind: "reply",
        status: PENDING,
        toEmail: ctx.email,
        subject: `Re: ${(first?.subject ?? inbound.subject).replace(/^(Re:\s*)+/i, "")}`,
        body: c.suggested_reply,
        footer: OPT_OUT_LINE,
        agentDraft: { subject: `Re: ${(first?.subject ?? inbound.subject).replace(/^(Re:\s*)+/i, "")}`, body: c.suggested_reply },
        replyToId: inbound.id,
        warning: rateWarning(c.suggested_reply, job.spec.rate_range),
        agentRunIds: r.runs.map((x) => x.runId),
        traceId: last.traceId,
      },
    });
  }
  return null;
}

// A reply arrives (prototype: "Simulate reply"). Pending drafts for this candidate become stale and are
// cancelled; then the reply is classified and the stage/follow-up rules applied.
// Marks a message that arrived after the candidate's final outcome (Step 9): never classified, summarized or read.
export const AFTER_OUTCOME_INTENT = "after_outcome";

export async function receiveReply(
  jobId: string,
  candidateId: string,
  body: string,
  opts: RunOptions & { receivedAt?: Date; gmailMessageId?: string; gmailThreadId?: string } = {},
): Promise<WorkflowResult> {
  if (!body.trim()) return { ok: false, message: "The reply is empty." };
  const thread = await getThread(jobId, candidateId);
  if (!thread.some((m) => m.status === "sent")) return { ok: false, message: "Nothing was sent to this candidate yet." };
  const inbound = await receive({ jobId, candidateId, body: body.trim(), receivedAt: opts.receivedAt, gmailMessageId: opts.gmailMessageId, gmailThreadId: opts.gmailThreadId });
  // Interview-times drafts (Step 8) have their own screen and stay; Step 8 shows the reply next to them.
  await db.message.updateMany({ where: { jobId, candidateId, direction: "outbound", status: PENDING, kind: { not: "scheduling" } }, data: { status: "cancelled", decidedAt: new Date() } });
  // Pre-screen questions still a draft (just cancelled above): there's no pre-screen yet. This reply is classified
  // normally, and an "interested" one drafts fresh questions that take it into account.
  await db.prescreen.deleteMany({ where: { jobId, candidateId, status: "questions_draft" } });
  await syncOutreachItem(jobId);
  // Step 9: a candidate with a final outcome is done. The message is kept for the recruiter; no agent reads it.
  if (await db.outcome.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } })) {
    await db.message.update({ where: { id: inbound.id }, data: { intent: AFTER_OUTCOME_INTENT } });
    return { ok: true, message: "Reply saved. This candidate already has a final outcome, so no agent reads it: handle it yourself.", jobId };
  }
  // Once the client asked for an interview, the candidate's messages are about times (Step 8).
  if (await db.interview.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } })) return receiveSchedulingReply(jobId, candidateId, inbound.id, opts);
  // After pre-screen questions, anything the candidate writes is treated as answers (Step 6 summary).
  if (await db.prescreen.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } })) return receiveAnswers(jobId, candidateId, inbound.id, opts);
  const job = await loadJob(jobId);
  try {
    const problem = await classify(job, inbound.id, opts);
    if (problem) await queueJobProblem(job, 5, "reply classification", [problem]);
    await syncOutreachItem(jobId);
    await flushTelemetry();
    if (problem) return { ok: false, message: "Reply saved, but classification failed; see the approval queue (Try again)." };
    const saved = await db.message.findUniqueOrThrow({ where: { id: inbound.id } });
    const c = saved.classification as ReplyClassification;
    const prescreen = c.intent === "interested" && (await db.prescreen.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } }));
    const next = c.suggested_reply
      ? " A suggested reply is waiting for approval."
      : c.intent === "interested"
        ? prescreen
          ? " Pre-screen questions drafted: review and send them in the approval queue (Send outreach)."
          : " Writing the pre-screen questions failed; see the approval queue."
        : "";
    return { ok: true, message: `Classified as "${c.intent.replaceAll("_", " ")}".${next}`, jobId };
  } catch (e) {
    if (e instanceof PausedForBudget) {
      await syncOutreachItem(jobId);
      return { ok: false, message: "Reply saved. The job reached its budget, so the next step waits for 'Continue' in the approval queue." };
    }
    throw e;
  }
}

// Recruiter feedback on a classification: Correct, or Wrong + the right intent (rules re-applied).
export async function reviewClassification(messageId: string, correct: boolean, intent?: Intent): Promise<WorkflowResult> {
  const msg = await db.message.findUniqueOrThrow({ where: { id: messageId } });
  if (msg.direction !== "inbound" || !msg.classification) return { ok: false, message: "This reply isn't classified yet." };
  const c = msg.classification as ReplyClassification;
  const newIntent = correct ? (c.intent as Intent) : intent;
  if (!newIntent) return { ok: false, message: "Pick the right intent." };
  await db.message.update({ where: { id: messageId }, data: { classifierCorrect: correct, intent: newIntent } });
  await score(msg.traceId, { classifier_correct: correct ? 1 : 0 });
  await flushTelemetry();
  if (!correct) {
    // Only the latest reply decides the stage.
    const latest = (await getThread(msg.jobId, msg.candidateId)).filter((m) => m.direction === "inbound").at(-1);
    if (latest?.id === msg.id) {
      await applyIntent(msg.jobId, msg.candidateId, newIntent, c.return_date, msg.sentAt ?? msg.createdAt);
      if (newIntent === "not_interested" || newIntent === "out_of_office") {
        await db.message.updateMany({
          where: { jobId: msg.jobId, candidateId: msg.candidateId, direction: "outbound", status: PENDING },
          data: { status: "cancelled", decidedAt: new Date() },
        });
        await syncOutreachItem(msg.jobId);
      }
    }
  }
  return { ok: true, message: correct ? "Thanks: marked correct." : `Changed to "${newIntent.replaceAll("_", " ")}"; stage and follow-ups updated.` };
}

// ---------- follow-ups ("Run follow-ups now") ----------

export type FollowUpStatus = { candidateId: string; due: boolean; nextStep: number | null; reason: string; dueAt: Date | null };

// Who gets a follow-up at `now`: contacted, no reply, not stopped or paused, no draft waiting,
// last message 3+ days old, fewer than 2 follow-ups sent. No AI: also used for the Job page.
export async function followUpStatus(jobId: string, now = new Date()): Promise<FollowUpStatus[]> {
  const entries = await db.pipelineEntry.findMany({ where: { jobId, stage: { in: ["contacted", "replied", "declined"] } } });
  const messages = await db.message.findMany({ where: { jobId } });
  return entries.map((e) => {
    const mine = messages.filter((m) => m.candidateId === e.candidateId);
    const sentSeq = mine.filter((m) => m.status === "sent" && m.sequenceStep != null).sort((a, b) => a.sentAt!.getTime() - b.sentAt!.getTime());
    const lastSeq = sentSeq.at(-1);
    const followUpsSent = sentSeq.filter((m) => (m.sequenceStep ?? 0) > 1).length;
    const lastActivity = mine.filter((m) => m.status === "sent" || m.status === "received").map((m) => m.sentAt!.getTime());
    const dueAt = lastActivity.length ? new Date(Math.max(...lastActivity) + FOLLOW_UP_AFTER_DAYS * DAY_MS) : null;
    const base = { candidateId: e.candidateId, nextStep: lastSeq ? (lastSeq.sequenceStep ?? 1) + 1 : null, dueAt };
    const no = (reason: string) => ({ ...base, due: false, reason });
    if (e.stage !== "contacted") return no(e.followUpsStopped ?? `Stage ${e.stage}`);
    if (e.followUpsStopped) return no(e.followUpsStopped);
    if (!lastSeq) return no("Nothing sent yet");
    if (followUpsSent >= MAX_FOLLOW_UPS) return no(`All ${MAX_FOLLOW_UPS} follow-ups sent`);
    if (mine.some((m) => m.status === PENDING)) return no("A draft is waiting for approval");
    if (e.followUpsPausedUntil && e.followUpsPausedUntil > now) return no(`Paused (out of office) until ${e.followUpsPausedUntil.toISOString().slice(0, 10)}`);
    if (dueAt && dueAt > now) return no(`Follow-up ${followUpsSent + 1} due ${dueAt.toISOString().slice(0, 10)}`);
    return { ...base, due: true, reason: `Follow-up ${followUpsSent + 1} due now` };
  });
}

// Drafts every due follow-up (they still go through send approval). `now` is for automated tests only.
export async function runFollowUps(jobId: string, opts: RunOptions & { now?: Date } = {}): Promise<WorkflowResult> {
  const due = (await followUpStatus(jobId, opts.now ?? new Date())).filter((s) => s.due);
  if (!due.length) return { ok: true, message: "No follow-ups due yet.", jobId };
  const job = await loadJob(jobId);
  const problems: Problem[] = [];
  let paused = false;
  try {
    await pool(due, OUTREACH_CONCURRENCY, async (s) => {
      const p = await draftMessage(job, s.candidateId, "follow_up", { ...opts, sequenceStep: s.nextStep });
      if (p) problems.push(p);
    });
  } catch (e) {
    if (!(e instanceof PausedForBudget)) throw e;
    paused = true;
  } finally {
    await queueJobProblem(job, 5, "follow-ups", problems, due.length);
    await syncOutreachItem(jobId);
    await flushTelemetry();
  }
  const drafted = due.length - problems.length;
  if (paused) return { ok: false, message: "The job reached its budget; some follow-ups were not drafted. See the approval queue." };
  return { ok: !problems.length, message: `${drafted} follow-up draft(s) waiting for approval.${problems.length ? ` ${problems.length} failed; see the approval queue.` : ""}`, jobId };
}
