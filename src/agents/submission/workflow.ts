// Step 7 workflow (docs/specs/07-submission-agent.md): pre-screen "proceed" or the recruiter's "Prepare submission"
// -> rate check -> draft in the client's format -> account manager approves (sent via mock_inbox, stage submitted),
// rejects with a comment (redraft), or withdraws. Driven by database state; only missing work is done.
import { db } from "@/lib/db";
import { rateProblem, SUBMISSION_FORMAT, type SubmissionFormat } from "@/config/submission";
import type { WorkflowResult } from "../job-spec/workflow";
import type { CandidateProfileData } from "../enrichment/schema";
import type { PrescreenSummary } from "../prescreen/schema";
import type { ScreeningData } from "../screening/schema";
import { flushTelemetry } from "../telemetry";
import { sendToClient } from "../tools/mock-inbox";
import { ensureBudget, loadJob, PausedForBudget, queueJobProblem, score, type LoadedJob, type Problem } from "../pipeline/shared";
import { recordPrescreenDecision } from "../prescreen/workflow";
import { runSubmissionAgent } from "./agent";
import { fieldsText, identifyingDetails, submissionFieldsSchema, type SubmissionData, type SubmissionFields } from "./schema";

export type RunOptions = { extraTags?: string[] };
const PENDING = "awaiting_approval";
// A claim older than this is from a run that died (app restarted); it may be taken again.
const CLAIM_EXPIRES_MS = 5 * 60_000;

// ---------- helpers ----------

// How a candidate is called on screens about an anonymized submission (never in what the client sees).
export const candidateRef = (candidateId: string) => `Candidate NW-${candidateId.replace(/^cand-/, "")}`;

async function people(job: LoadedJob, candidateId: string) {
  const [candidate, profileRow, screening, pre, client, brief, contact] = await Promise.all([
    db.candidate.findUniqueOrThrow({ where: { id: candidateId } }),
    db.candidateProfile.findUnique({ where: { candidateId } }),
    db.screeningResult.findFirst({ where: { jobId: job.id, candidateId, current: true } }),
    db.prescreen.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId } } }),
    db.client.findUniqueOrThrow({ where: { id: job.clientId } }),
    db.clientBrief.findUnique({ where: { id: job.jobSpec.briefId } }),
    clientEmailOf(job.clientId, job.jobSpec.briefId),
  ]);
  return {
    candidate,
    profile: profileRow?.data as CandidateProfileData | undefined,
    screening: (screening?.data as ScreeningData | null) ?? null,
    pre,
    summary: (pre?.data as PrescreenSummary | null) ?? null,
    client,
    brief,
    contact,
  };
}

// Where a submission goes (2026-10-10): the client's email from the Clients page, else the email of whoever sent the
// brief. null = no email yet: nothing can be sent to the client until one is added on the Clients page.
export async function clientEmailOf(clientId: string, briefId: string): Promise<{ name: string | null; email: string } | null> {
  const [saved, brief] = await Promise.all([
    db.clientContact.findFirst({ where: { clientId }, orderBy: { createdAt: "asc" } }),
    db.clientBrief.findUnique({ where: { id: briefId }, select: { fromName: true, fromEmail: true } }),
  ]);
  if (saved?.email.trim()) return { name: saved.name, email: saved.email };
  if (brief?.fromEmail.trim()) return { name: brief.fromName === "Unknown sender" ? null : brief.fromName, email: brief.fromEmail.trim() };
  return null;
}
export const NO_CLIENT_EMAIL = "No email for this client yet. Add one on the Clients page (Edit email), then send.";

export const confirmedRateOf = (pre: { confirmedRate: string | null; data: unknown } | null) => pre?.confirmedRate ?? (pre?.data as PrescreenSummary | null)?.rate_expectation ?? null;

// Plain-text version of the profile for the email to the client (the HTML preview is a page in the app).
export function submissionText(fields: SubmissionFields, format: SubmissionFormat, name: string | null): string {
  const has = (f: string) => (format.fields as string[]).includes(f);
  return [
    name ? `Candidate: ${name}` : null,
    has("headline") ? fields.headline : null,
    has("summary") ? fields.summary : null,
    has("key_skills") ? `Key skills: ${fields.key_skills.join(", ")}` : null,
    has("experience_highlights") ? `Experience highlights:\n${fields.experience_highlights.map((h) => `- ${h}`).join("\n")}` : null,
    has("rate") ? `Rate: ${fields.rate}` : null,
    has("availability") ? `Availability: ${fields.availability}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function syncItems(job: LoadedJob, candidateId: string) {
  const ctx = await people(job, candidateId);
  const pending = await db.submission.findFirst({ where: { jobId: job.id, candidateId, status: PENDING }, orderBy: { createdAt: "desc" } });
  const open = await db.approvalItem.findFirst({ where: { jobId: job.id, candidateId, kind: "submission", status: PENDING } });
  if (!pending) {
    if (open) await db.approvalItem.update({ where: { id: open.id }, data: { status: "approved", decidedAt: new Date() } });
    return;
  }
  const name = pending.anonymized ? `${candidateRef(candidateId)} (${ctx.candidate.fullName})` : ctx.candidate.fullName;
  const detail = `Account manager: review the profile and send it to ${ctx.client.name}${ctx.contact ? ` (${ctx.contact.email})` : " (no email yet: add one on Clients first)"}. ${pending.anonymized ? "Anonymized for this client. " : ""}Rate: ${(pending.data as SubmissionData).rate}.${pending.previousSubmissionId ? " Rewritten after your comment." : ""}`;
  if (open) await db.approvalItem.update({ where: { id: open.id }, data: { detail } });
  else {
    await db.approvalItem.create({
      data: { kind: "submission", step: 7, status: PENDING, title: `Send to client: ${name} · ${job.title}`, detail, clientId: job.clientId, jobId: job.id, candidateId },
    });
  }
}

// ---------- draft ----------

// Drafts one submission (or a redraft after a reject). Rate missing or without an amount -> "Rate needed" in the
// approval queue instead (spec edge case "block submission, ask recruiter"). Returns a problem instead of throwing.
async function prepare(job: LoadedJob, candidateId: string, opts: RunOptions, previous?: { id: string; fields: SubmissionFields; comment: string }): Promise<Problem | null> {
  const ctx = await people(job, candidateId);
  if (!ctx.pre || !ctx.profile) return { candidateId, runs: [], error: "No pre-screen or profile for this candidate" };
  const format = SUBMISSION_FORMAT;
  const rate = confirmedRateOf(ctx.pre);
  const problem = rateProblem(rate, format);
  if (problem) {
    const open = await db.approvalItem.findFirst({ where: { jobId: job.id, candidateId, kind: "submission_rate", status: PENDING } });
    if (!open) {
      await db.approvalItem.create({
        data: {
          kind: "submission_rate",
          step: 7,
          status: PENDING,
          title: `Rate needed: ${ctx.candidate.fullName} · ${job.title}`,
          detail: `Submission blocked: ${problem} Confirm the rate with the candidate, then type it here (e.g. "${format.notes.match(/EUR/) ? "€55/hr" : "$55/hr"}") and the profile is prepared.`,
          clientId: job.clientId,
          jobId: job.id,
          candidateId,
        },
      });
    }
    return null;
  }

  // Claim the candidate, so two runs never draft the same submission.
  const { count } = await db.prescreen.updateMany({
    where: { id: ctx.pre.id, OR: [{ submissionStartedAt: null }, { submissionStartedAt: { lt: new Date(Date.now() - CLAIM_EXPIRES_MS) } }] },
    data: { submissionStartedAt: new Date() },
  });
  if (!count) return null;
  const release = () => db.prescreen.update({ where: { id: ctx.pre!.id }, data: { submissionStartedAt: null } });
  try {
    await ensureBudget(job.id, 7);
    const r = await runSubmissionAgent({
      jobId: job.id,
      clientId: job.clientId,
      spec: job.spec,
      format,
      candidateId,
      fullName: ctx.candidate.fullName,
      profile: ctx.profile,
      screening: ctx.screening,
      prescreen: ctx.summary,
      rate: rate!,
      previousDraft: previous ? { fields: previous.fields, comment: previous.comment } : undefined,
      extraTags: opts.extraTags,
    });
    if (!r.data) return { candidateId, runs: r.runs, error: r.error };
    await db.submission.create({
      data: {
        jobId: job.id,
        candidateId,
        clientId: job.clientId,
        status: PENDING,
        anonymized: format.anonymized,
        format,
        data: r.data,
        agentDraft: r.data,
        previousSubmissionId: previous?.id ?? null,
        agentRunIds: r.runs.map((x) => x.runId),
        traceId: r.runs.at(-1)!.traceId,
      },
    });
    await syncItems(job, candidateId);
    return null;
  } finally {
    await release();
  }
}

const wantsSubmission = (p: { status: string; decision: string | null; recommendation: string | null }) =>
  p.status === "summarized" && (p.decision === "submit" || (p.decision === null && p.recommendation === "proceed"));

// Missing Step 7 work for a job (called by the job's Steps 5-7 run): first drafts, and redrafts whose run failed.
export async function submissionStep(job: LoadedJob, opts: RunOptions = {}) {
  const prescreens = (await db.prescreen.findMany({ where: { jobId: job.id } })).filter(wantsSubmission);
  const subs = await db.submission.findMany({ where: { jobId: job.id } });
  const problems: Problem[] = [];
  try {
    for (const p of prescreens) {
      const mine = subs.filter((s) => s.candidateId === p.candidateId);
      const orphanReject = mine.find((s) => s.status === "rejected" && !mine.some((x) => x.previousSubmissionId === s.id));
      const problem = !mine.length
        ? await prepare(job, p.candidateId, opts)
        : orphanReject
          ? await prepare(job, p.candidateId, opts, { id: orphanReject.id, fields: orphanReject.data as SubmissionData, comment: orphanReject.rejectComment ?? "" })
          : null;
      if (problem) problems.push(problem);
    }
  } finally {
    await queueJobProblem(job, 7, "submission", problems);
    await flushTelemetry();
  }
}

// "Rate needed": the recruiter types the confirmed rate; the caller then starts the job's run (drafts it).
export async function setConfirmedRate(jobId: string, candidateId: string, rate: string): Promise<WorkflowResult> {
  const problem = rateProblem(rate, SUBMISSION_FORMAT);
  if (problem) return { ok: false, message: problem.replace("the candidate's rate is", "you typed") };
  await db.prescreen.update({ where: { jobId_candidateId: { jobId, candidateId } }, data: { confirmedRate: rate.trim() } });
  const items = await db.approvalItem.findMany({ where: { jobId, candidateId, kind: "submission_rate", status: PENDING } });
  for (const i of items) await db.approvalItem.update({ where: { id: i.id }, data: { status: "approved", decidedAt: new Date(), detail: `${i.detail ?? ""} Rate confirmed: ${rate.trim()}.` } });
  return { ok: true, message: `Rate saved (${rate.trim()}). The submission agent is writing the profile (about 20s).`, jobId };
}

// ---------- account manager: approve (= send) / reject (= redraft) / don't submit ----------

// Anonymization holds after edits too: nothing identifying reaches the client, whoever typed it.
async function checkEdits(sub: { anonymized: boolean; candidateId: string; format: unknown }, fields: SubmissionFields): Promise<string | null> {
  const format = sub.format as SubmissionFormat;
  for (const f of format.fields) {
    const v = fields[f];
    if (Array.isArray(v) ? !v.filter((x) => x.trim()).length : !v.trim()) return `"${f.replaceAll("_", " ")}" can't be empty (the client's template needs it).`;
  }
  if (!sub.anonymized) return null;
  const [candidate, profile] = await Promise.all([
    db.candidate.findUniqueOrThrow({ where: { id: sub.candidateId } }),
    db.candidateProfile.findUnique({ where: { candidateId: sub.candidateId } }),
  ]);
  const employers = ((profile?.data as CandidateProfileData | undefined)?.job_history ?? []).map((j) => j.company);
  const hits = identifyingDetails(fieldsText(fields), { fullName: candidate.fullName, employers });
  return hits.length ? `This client gets anonymized profiles: remove ${hits.join(", ")}.` : null;
}

const clean = (f: SubmissionFields): SubmissionFields => ({
  headline: f.headline.trim(),
  summary: f.summary.trim(),
  key_skills: f.key_skills.map((x) => x.trim()).filter(Boolean),
  experience_highlights: f.experience_highlights.map((x) => x.trim()).filter(Boolean),
  rate: f.rate.trim(),
  availability: f.availability.trim(),
});
const sameFields = (a: SubmissionFields, b: SubmissionFields) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

export async function approveSubmission(submissionId: string, edited: SubmissionFields): Promise<WorkflowResult> {
  const parsed = submissionFieldsSchema.safeParse(edited);
  if (!parsed.success) return { ok: false, message: "The profile is incomplete." };
  const fields = clean(parsed.data);
  const sub = await db.submission.findUniqueOrThrow({ where: { id: submissionId } });
  if (sub.status !== PENDING) return { ok: false, message: "This submission was already decided." };
  const problem = await checkEdits(sub, fields);
  if (problem) return { ok: false, message: problem };
  const job = await loadJob(sub.jobId);
  const ctx = await people(job, sub.candidateId);
  if (!ctx.contact) return { ok: false, message: NO_CLIENT_EMAIL };
  const format = sub.format as SubmissionFormat;
  const data: SubmissionData = { ...(sub.data as SubmissionData), ...fields };
  const msg = await sendToClient({
    submissionId,
    data,
    toEmail: ctx.contact.email,
    subject: `Candidate for ${job.title}: ${sub.anonymized ? candidateRef(sub.candidateId) : ctx.candidate.fullName}`,
    body: `Hi ${ctx.contact.name?.split(/\s+/)[0] || "there"},\n\nPlease find a candidate for the ${job.title} role below.\n\n${submissionText(fields, format, sub.anonymized ? candidateRef(sub.candidateId) : ctx.candidate.fullName)}\n\nBest regards,\nHireloop`,
  });
  if (!msg) return { ok: false, message: "This submission was already decided." };
  if ("error" in msg) return { ok: false, message: `Not sent: ${msg.error}. The submission is still waiting; try again.` };
  await db.pipelineEntry.updateMany({ where: { jobId: sub.jobId, candidateId: sub.candidateId, stage: { in: ["prescreened", "replied"] } }, data: { stage: "submitted" } });
  await recordPrescreenDecision(sub.jobId, sub.candidateId, "submit");
  await score(sub.traceId, { approved_without_edits: sameFields(fields, sub.agentDraft as SubmissionData) ? 1 : 0 });
  await syncItems(job, sub.candidateId);
  await flushTelemetry();
  const via = msg.gmailMessageId ? "through Gmail" : "via the mock inbox (not a test address)";
  return { ok: true, message: `Sent to ${ctx.client.name} (${ctx.contact.email}) ${via}. Stage: submitted.`, jobId: sub.jobId };
}

// Reject with a comment: the draft is kept as "rejected" and the agent writes a new one (waits ~20s).
export async function rejectSubmission(submissionId: string, comment: string, opts: RunOptions = {}): Promise<WorkflowResult> {
  if (!comment.trim()) return { ok: false, message: "Add a comment so the agent knows what to change." };
  const sub = await db.submission.findUniqueOrThrow({ where: { id: submissionId } });
  const { count } = await db.submission.updateMany({ where: { id: submissionId, status: PENDING }, data: { status: "rejected", rejectComment: comment.trim(), decidedAt: new Date() } });
  if (!count) return { ok: false, message: "This submission was already decided." };
  await score(sub.traceId, { approved_without_edits: 0 });
  const job = await loadJob(sub.jobId);
  try {
    const problem = await prepare(job, sub.candidateId, opts, { id: sub.id, fields: sub.data as SubmissionData, comment: comment.trim() });
    if (problem) await queueJobProblem(job, 7, "submission redraft", [problem]);
    await syncItems(job, sub.candidateId);
    await flushTelemetry();
    const next = await db.submission.findFirst({ where: { previousSubmissionId: sub.id } });
    return problem || !next
      ? { ok: false, message: "Rejected, but the redraft failed or went over budget; see the approval queue (Try again)." }
      : { ok: true, message: "Redrafted. The new version is below.", jobId: sub.jobId };
  } catch (e) {
    if (e instanceof PausedForBudget) return { ok: false, message: "Rejected, but the job reached its budget: the redraft waits for 'Continue' in the approval queue." };
    throw e;
  }
}

// "Don't submit": nothing goes to the client; the recruiter's call is saved (and scored for "proceed").
export async function withdrawSubmission(submissionId: string): Promise<WorkflowResult> {
  const sub = await db.submission.findUniqueOrThrow({ where: { id: submissionId } });
  const { count } = await db.submission.updateMany({ where: { id: submissionId, status: PENDING }, data: { status: "withdrawn", decidedAt: new Date() } });
  if (!count) return { ok: false, message: "This submission was already decided." };
  await recordPrescreenDecision(sub.jobId, sub.candidateId, "dont_submit");
  const items = await db.approvalItem.findMany({ where: { jobId: sub.jobId, candidateId: sub.candidateId, kind: "submission", status: PENDING } });
  for (const i of items) await db.approvalItem.update({ where: { id: i.id }, data: { status: "rejected", decidedAt: new Date() } });
  await flushTelemetry();
  return { ok: true, message: "Not submitted. Nothing was sent to the client.", jobId: sub.jobId };
}
