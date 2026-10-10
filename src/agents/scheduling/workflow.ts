// Step 8 workflow (docs/specs/08-scheduling-agent.md): the client asks for an interview -> code finds up to 3 times
// (both calendars, 09:00-19:00 local for both sides) -> the agent writes the options email (no approval) -> the
// candidate picks one (the agent reads the reply) -> the client confirms -> booked in mock_calendar, confirmations
// to both. "Run reminders now" sends reminders and nudges. Anything unclear goes to the recruiter (escalated).
// Driven by database state (interview status), so it can stop and resume anywhere.
import { db } from "@/lib/db";
import { MAX_RESCHEDULES, NUDGE_AFTER_HOURS, REMINDER_BEFORE_HOURS, BUSINESS_DAYS_AHEAD, INTERVIEW_MINUTES } from "@/config/scheduling";
import { OPT_OUT_LINE, SENDER_SIGNATURE } from "@/config/outreach";
import { cityOf, slotLine, timeZoneOfLocation, withinWorkingHours } from "@/lib/timezones";
import type { WorkflowResult } from "../job-spec/workflow";
import type { CandidateProfileData } from "../enrichment/schema";
import { getTelemetry, flushTelemetry } from "../telemetry";
import { getThread, send, sendWithoutApproval, CLIENT_KINDS } from "../tools/mock-inbox";
import { settleClientReply } from "../client-reply/workflow";
import { calendarTransport, realCalendarAllowed } from "../tools/google-calendar";
import { getGoogleAccount } from "../tools/google-auth";
import { FREEBUSY_SCOPE, isSendAllowed } from "@/config/google";
import { book, cancel } from "../tools/bookings";
import { ensureBudget, loadJob, PausedForBudget, queueJobProblem, score, type LoadedJob, type Problem } from "../pipeline/shared";
import { candidateRef } from "../submission/workflow";
import { codeOnlyTrace, runOptionsEmail, runReadReply } from "./agent";
import { findSlots } from "./slots";
import { SLOTS_MARKER, type SchedulingReply } from "./schema";

export type RunOptions = { extraTags?: string[]; now?: Date };
// Marks a candidate message as a reply about interview times (read by the scheduling agent, never by the classifier).
export const SCHEDULING_INTENT = "scheduling_reply";
const HOUR = 3600_000;
const OPEN = ["proposed", "rescheduled"]; // options sent, waiting for the candidate
const ACTIVE = ["finding", ...OPEN, "awaiting_client", "confirmed"];

type Interview = NonNullable<Awaited<ReturnType<typeof db.interview.findUnique>>>;
const slotsOf = (iv: Interview) => (iv.proposedSlots as string[]).map((s) => new Date(s));

// ---------- context ----------

async function people(job: LoadedJob, iv: Pick<Interview, "candidateId" | "submissionId">) {
  const [candidate, profileRow, client, brief, sub, thread] = await Promise.all([
    db.candidate.findUniqueOrThrow({ where: { id: iv.candidateId } }),
    db.candidateProfile.findUnique({ where: { candidateId: iv.candidateId } }),
    db.client.findUniqueOrThrow({ where: { id: job.clientId } }),
    db.clientBrief.findUnique({ where: { id: job.jobSpec.briefId } }),
    db.submission.findUnique({ where: { id: iv.submissionId } }),
    getThread(job.id, iv.candidateId),
  ]);
  const profile = profileRow?.data as CandidateProfileData | undefined;
  // First name as in our earlier emails ("Hi Oleksandr,"): profiles can be in Cyrillic.
  const greeted = thread.filter((m) => m.direction === "outbound" && m.status === "sent" && !CLIENT_KINDS.includes(m.kind)).map((m) => m.body.match(/^Hi ([^,\n]+),/)?.[1]).filter(Boolean).at(-1);
  return {
    candidate,
    firstName: greeted ?? candidate.fullName.split(/\s+/)[0],
    email: profile?.contacts.email ?? null,
    location: profile?.location ?? null,
    client,
    contactFirst: brief?.fromName.split(/\s+/)[0] ?? "there",
    // How the client knows the candidate: anonymized submissions use the reference, never the name.
    forClient: sub?.anonymized ? candidateRef(iv.candidateId) : candidate.fullName,
  };
}
type People = Awaited<ReturnType<typeof people>>;

const optionsList = (slots: Date[], readerTz: string, otherTz: string) => slots.map((d, i) => `${i + 1}. ${slotLine(d, readerTz, otherTz)}`).join("\n");

// ---------- templated messages (no AI) ----------

async function toCandidate(job: LoadedJob, iv: Interview, p: People, subject: string, body: string, runIds: string[] = [], traceId: string | null = null) {
  if (!p.email) return null;
  return sendWithoutApproval({ jobId: job.id, candidateId: iv.candidateId, kind: "scheduling", toEmail: p.email, subject, body, footer: OPT_OUT_LINE, agentRunIds: runIds, traceId });
}
async function toClient(job: LoadedJob, iv: Interview, p: People, body: string) {
  return sendWithoutApproval({
    jobId: job.id,
    candidateId: iv.candidateId,
    kind: "scheduling_client",
    toEmail: iv.clientEmail,
    subject: `Interview: ${p.forClient} · ${job.title}`,
    body: `Hi ${p.contactFirst},\n\n${body}\n\nBest regards,\nHireloop`,
    footer: null,
    agentRunIds: [],
    traceId: null,
  });
}
const subjectFor = (job: LoadedJob) => `Interview for the ${job.title} role`;

// Langfuse scores on the interview's trace. Fixed ids, so a later value replaces the earlier one.
function interviewScores(iv: Pick<Interview, "id" | "traceId">, scores: Record<string, number>) {
  if (!iv.traceId) return;
  for (const [name, value] of Object.entries(scores)) getTelemetry().langfuse.score.create({ id: `${name}-${iv.id}`, traceId: iv.traceId, name, value });
}

// ---------- Google Calendar (docs/specs/14-google-calendar.md) ----------

// The recruiter's busy times from Google (free/busy only). checked = false: not connected, permission missing,
// automated test, or Google failed; times are then found from the mock calendars only, as before.
async function recruiterBusy(now: Date): Promise<{ busy: { start: Date; end: Date }[]; checked: boolean }> {
  if (!realCalendarAllowed()) return { busy: [], checked: false };
  if (!calendarTransport.fake) {
    const account = await getGoogleAccount();
    if (!account || account.lastError || !account.scopes.split(" ").includes(FREEBUSY_SCOPE)) return { busy: [], checked: false };
  }
  try {
    return { busy: await calendarTransport.busyTimes(now, new Date(now.getTime() + (BUSINESS_DAYS_AHEAD + 4) * 24 * HOUR)), checked: true };
  } catch {
    return { busy: [], checked: false };
  }
}

// The real event for a confirmed interview: Meet link, invites to the candidate and the client (allow-listed addresses only).
// Returns the Meet link, or null (mock only / failed: a "Google Calendar: event not created" item is queued on failure).
async function createGoogleEvent(job: LoadedJob, iv: Interview, p: People): Promise<string | null> {
  if (!realCalendarAllowed() || !iv.confirmedSlot) return null;
  const guests = [p.email, iv.clientEmail].filter((x): x is string => !!x && isSendAllowed(x)).map((x) => x.toLowerCase());
  try {
    const ev = await calendarTransport.createEvent({
      summary: `Interview: ${p.forClient} · ${job.title}`,
      description: `Interview for the ${job.title} role (${p.client.name}).\nBooked by Hireloop.`,
      start: iv.confirmedSlot,
      end: new Date(iv.confirmedSlot.getTime() + INTERVIEW_MINUTES * 60_000),
      guests,
    });
    await db.interview.update({ where: { id: iv.id }, data: { googleEventId: ev.eventId, googleEventLink: ev.htmlLink, meetLink: ev.meetLink } });
    await db.approvalItem.updateMany({ where: { jobId: job.id, candidateId: iv.candidateId, kind: "google_event_failed", status: "awaiting_approval" }, data: { status: "approved", decidedAt: new Date() } });
    return ev.meetLink;
  } catch (e) {
    const open = await db.approvalItem.findFirst({ where: { jobId: job.id, candidateId: iv.candidateId, kind: "google_event_failed", status: "awaiting_approval" } });
    const detail = `The interview is booked, but the Google Calendar event wasn't created: ${e instanceof Error ? e.message : String(e)}`;
    if (open) await db.approvalItem.update({ where: { id: open.id }, data: { detail } });
    else {
      await db.approvalItem.create({
        data: { kind: "google_event_failed", step: 8, status: "awaiting_approval", title: `Google Calendar: event not created · ${p.candidate.fullName}`, detail, clientId: job.clientId, jobId: job.id, candidateId: iv.candidateId },
      });
    }
    return null;
  }
}

// "Create Google event" (interviews booked before specs/14) and "Try again" on the failed item. Google sends the invites.
export async function createGoogleEventNow(interviewId: string): Promise<WorkflowResult> {
  const iv = await db.interview.findUniqueOrThrow({ where: { id: interviewId } });
  if (iv.status !== "confirmed" || !iv.confirmedSlot) return { ok: false, message: "Only a booked interview gets a calendar event." };
  if (iv.googleEventId) return { ok: false, message: "This interview already has its Google Calendar event." };
  const job = await loadJob(iv.jobId);
  const meet = await createGoogleEvent(job, iv, await people(job, iv));
  const after = await db.interview.findUniqueOrThrow({ where: { id: iv.id } });
  return after.googleEventId
    ? { ok: true, message: `Event created in your Google Calendar${meet ? " with a Meet link" : ""}; Google sent the invites.`, jobId: job.id }
    : { ok: false, message: "The event wasn't created; see the approval queue." };
}

// A cancelled interview (Step 9 outcome): the app's own event is deleted and Google notifies the guests.
export async function cancelGoogleEvent(iv: Pick<Interview, "id" | "googleEventId">): Promise<string | null> {
  if (!iv.googleEventId || !realCalendarAllowed()) return null;
  try {
    await calendarTransport.deleteEvent(iv.googleEventId);
    await db.interview.update({ where: { id: iv.id }, data: { googleEventId: null, googleEventLink: null, meetLink: null } });
    return "Google Calendar event cancelled (guests notified)";
  } catch (e) {
    return `Google Calendar event NOT cancelled (${e instanceof Error ? e.message : String(e)}): delete it in Google Calendar`;
  }
}

// ---------- escalation (spec: "Escalate to recruiter on any conflict") ----------

async function escalate(job: LoadedJob, iv: Interview, reason: string) {
  const traceId = iv.traceId ?? (await codeOnlyTrace({ jobId: job.id, clientId: job.clientId, candidateId: iv.candidateId, reason }));
  const updated = await db.interview.update({ where: { id: iv.id }, data: { status: "escalated", escalationReason: reason, traceId } });
  interviewScores(updated, { escalated: 1 });
  const candidate = await db.candidate.findUniqueOrThrow({ where: { id: iv.candidateId } });
  const detail = `${reason} Sort it out with both sides by hand, then mark this handled, or use “Try again” on the Job page to send new times.`;
  const open = await db.approvalItem.findFirst({ where: { jobId: job.id, candidateId: iv.candidateId, kind: "scheduling", status: "awaiting_approval" } });
  if (open) await db.approvalItem.update({ where: { id: open.id }, data: { detail } });
  else {
    await db.approvalItem.create({
      data: { kind: "scheduling", step: 8, status: "awaiting_approval", title: `Scheduling needs you: ${candidate.fullName} · ${job.title}`, detail, clientId: job.clientId, jobId: job.id, candidateId: iv.candidateId },
    });
  }
}

async function closeSchedulingItems(jobId: string, candidateId: string) {
  const items = await db.approvalItem.findMany({ where: { jobId, candidateId, kind: "scheduling", status: "awaiting_approval" } });
  for (const i of items) await db.approvalItem.update({ where: { id: i.id }, data: { status: "approved", decidedAt: new Date() } });
}

// ---------- 1. find times + options email ----------

// Finds times and drafts the options email (sent after the recruiter approves it, with the times editable: changed
// 2026-10-08, see approveInterviewTimes). Escalates when there's no time zone or no overlap.
// Returns a problem (failed/stopped run) instead of throwing; the interview stays "finding" for Try again.
async function proposeTimes(job: LoadedJob, ivIn: Interview, opts: RunOptions, candidateNote?: string): Promise<Problem | null> {
  const iv = await db.interview.update({ where: { id: ivIn.id }, data: { status: "finding" } });
  const p = await people(job, iv);
  const entry = await db.pipelineEntry.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId: iv.candidateId } } });
  if (entry?.stage === "declined") return escalate(job, iv, "The candidate said no or asked to stop, so no times were sent.").then(() => null);
  if (!p.email) return escalate(job, iv, "The candidate has no email address.").then(() => null);
  if (!iv.candidateTz) return escalate(job, iv, `The candidate's time zone is unknown (location: ${p.location ?? "not stated"}).`).then(() => null);
  const recruiter = await recruiterBusy(opts.now ?? new Date());
  const slots = await findSlots({
    candidate: { person: iv.candidateId, tz: iv.candidateTz },
    client: { person: iv.clientEmail, tz: iv.clientTz },
    now: opts.now,
    exclude: [...(iv.pastSlots as string[]), ...(iv.proposedSlots as string[])].map((s) => new Date(s)),
    busy: recruiter.busy,
  });
  if (!slots.length) {
    await escalate(job, iv, `No time in the next ${BUSINESS_DAYS_AHEAD} business days is free for both and inside 09:00-19:00 for both (${cityOf(iv.candidateTz)} / ${cityOf(iv.clientTz)}).`);
    return null;
  }
  await ensureBudget(job.id, 8);
  const mode = iv.rescheduleCount > 0 ? "reschedule" : "first";
  const r = await runOptionsEmail({ jobId: job.id, clientId: job.clientId, candidateId: iv.candidateId, firstName: p.firstName, jobTitle: job.title, slotCount: slots.length, mode, candidateNote, clientName: p.client.name, extraTags: opts.extraTags });
  if (!r.data) return { candidateId: iv.candidateId, runs: r.runs, error: r.error };
  const last = r.runs.at(-1)!;
  // The draft keeps the {{slots}} marker: the times are filled in when the recruiter approves (they may change them).
  const text = r.data.body.trim();
  await db.message.updateMany({ where: { jobId: job.id, candidateId: iv.candidateId, kind: "scheduling", status: "awaiting_approval" }, data: { status: "cancelled", decidedAt: new Date() } });
  await db.message.create({
    data: {
      jobId: job.id,
      candidateId: iv.candidateId,
      direction: "outbound",
      kind: "scheduling",
      status: "awaiting_approval",
      toEmail: p.email,
      subject: subjectFor(job),
      body: text,
      footer: OPT_OUT_LINE,
      agentDraft: { subject: subjectFor(job), body: text, slots: slots.map((d) => d.toISOString()), calendarChecked: recruiter.checked },
      agentRunIds: r.runs.map((x) => x.runId),
      traceId: last.traceId,
    },
  });
  await db.interview.update({
    where: { id: iv.id },
    data: {
      status: "times_draft",
      pastSlots: [...(iv.pastSlots as string[]), ...(iv.proposedSlots as string[])],
      proposedSlots: slots.map((d) => d.toISOString()),
      chosenSlot: null,
      nudgedAt: null,
      traceId: iv.traceId ?? last.traceId,
      agentRunIds: [...(iv.agentRunIds as string[]), ...r.runs.map((x) => x.runId)],
    },
  });
  const candidate = await db.candidate.findUniqueOrThrow({ where: { id: iv.candidateId } });
  const detail = `${slots.length} interview time(s) ready${mode === "reschedule" ? " after a reschedule request" : ""}${recruiter.checked ? ", avoiding your busy times" : " (your Google Calendar wasn't checked)"}. Check and edit the times and the email before it goes to the candidate.`;
  const open = await db.approvalItem.findFirst({ where: { jobId: job.id, candidateId: iv.candidateId, kind: "interview_times", status: "awaiting_approval" } });
  if (open) await db.approvalItem.update({ where: { id: open.id }, data: { detail } });
  else {
    await db.approvalItem.create({
      data: { kind: "interview_times", step: 8, status: "awaiting_approval", title: `Send interview times: ${candidate.fullName} · ${job.title}`, detail, clientId: job.clientId, jobId: job.id, candidateId: iv.candidateId },
    });
  }
  return null;
}

export type TimesDecision = { subject: string; body: string; slots: string[] }; // slots: ISO times (UTC)

// "Approve & send" on the interview-times screen: the recruiter's times (edited, added or removed) go into the email
// at {{slots}}, the email is sent (Gmail when set up), and the candidate's pick is later read against these times.
export async function approveInterviewTimes(interviewId: string, d: TimesDecision): Promise<WorkflowResult> {
  const iv = await db.interview.findUniqueOrThrow({ where: { id: interviewId } });
  if (iv.status !== "times_draft") return { ok: false, message: "These times were already decided." };
  const draft = await db.message.findFirst({ where: { jobId: iv.jobId, candidateId: iv.candidateId, kind: "scheduling", status: "awaiting_approval" }, orderBy: { createdAt: "desc" } });
  if (!draft) return { ok: false, message: "No times email is waiting for this interview." };
  if (!d.subject.trim() || !d.body.trim()) return { ok: false, message: "Subject and text can't be empty." };
  if (d.body.split(SLOTS_MARKER).length - 1 !== 1) return { ok: false, message: `Keep ${SLOTS_MARKER} exactly once in the text: that's where the times go.` };
  const slots = [...new Set(d.slots)].map((x) => new Date(x)).sort((a, b) => a.getTime() - b.getTime());
  if (!slots.length || slots.length > 5 || slots.some((x) => isNaN(x.getTime()))) return { ok: false, message: "Give 1 to 5 valid times." };
  if (slots.some((x) => x.getTime() < Date.now())) return { ok: false, message: "A time is in the past." };
  const ctz = iv.candidateTz ?? iv.clientTz;
  // Guardrail (spec 08): never outside 09:00-19:00 local time, for either side.
  const outside = slots.filter((x) => !withinWorkingHours(x, ctz) || !withinWorkingHours(x, iv.clientTz));
  if (outside.length) return { ok: false, message: `Outside 09:00-19:00 on a weekday for one side: ${outside.map((x) => slotLine(x, ctz, iv.clientTz)).join("; ")}.` };

  const body = `${d.body.replace(SLOTS_MARKER, optionsList(slots, ctz, iv.clientTz)).trim()}\n\n${SENDER_SIGNATURE}`;
  const entry = await db.pipelineEntry.findUnique({ where: { jobId_candidateId: { jobId: iv.jobId, candidateId: iv.candidateId } } });
  if (entry?.stage === "declined") return { ok: false, message: "The candidate said no or asked to stop: nothing sent." };
  const result = await send(draft.id, { subject: d.subject.trim(), body });
  if (!result.ok) return { ok: false, message: result.error ? `Not sent: ${result.error}` : "These times were already decided." };
  const agent = draft.agentDraft as { subject: string; body: string; slots: string[] } | null;
  const unedited = !!agent && agent.subject === d.subject.trim() && agent.body.trim() === d.body.trim() && JSON.stringify(agent.slots) === JSON.stringify(slots.map((x) => x.toISOString()));
  await score(draft.traceId, { approved_without_edits: unedited ? 1 : 0 });
  await db.interview.update({
    where: { id: iv.id },
    data: {
      status: iv.rescheduleCount > 0 ? "rescheduled" : "proposed",
      proposedSlots: slots.map((x) => x.toISOString()),
      messagesToConfirm: { increment: 1 },
      lastSentAt: new Date(),
      nudgedAt: null,
    },
  });
  await db.approvalItem.updateMany({ where: { jobId: iv.jobId, candidateId: iv.candidateId, kind: "interview_times", status: "awaiting_approval" }, data: { status: "approved", decidedAt: new Date() } });
  await flushTelemetry();
  return { ok: true, message: `${slots.length} time(s) sent to the candidate${unedited ? "" : " (with your edits)"}.`, jobId: iv.jobId };
}

// "Client wants interview": the button the account manager clicks after the client's reply arrives in Gmail (specs/13).
export async function requestInterview(submissionId: string, opts: RunOptions = {}): Promise<WorkflowResult> {
  const sub = await db.submission.findUniqueOrThrow({ where: { id: submissionId } });
  if (sub.status !== "sent") return { ok: false, message: "Only a submission sent to the client can lead to an interview." };
  if (await db.interview.findUnique({ where: { jobId_candidateId: { jobId: sub.jobId, candidateId: sub.candidateId } } })) return { ok: false, message: "The client's answer was already recorded." };
  const job = await loadJob(sub.jobId);
  const brief = await db.clientBrief.findUniqueOrThrow({ where: { id: job.jobSpec.briefId } });
  const client = await db.client.findUniqueOrThrow({ where: { id: job.clientId } });
  const profile = (await db.candidateProfile.findUnique({ where: { candidateId: sub.candidateId } }))?.data as CandidateProfileData | undefined;
  // The client answers once: submitted -> interview (atomic, so a double click or a "Client rejected" before wins).
  const { count } = await db.pipelineEntry.updateMany({ where: { jobId: job.id, candidateId: sub.candidateId, stage: "submitted" }, data: { stage: "interview" } });
  if (!count) {
    const entry = await db.pipelineEntry.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId: sub.candidateId } } });
    return { ok: false, message: entry?.stage === "declined" ? "The candidate said no or asked to stop: no interview." : "The client's answer was already recorded." };
  }
  let iv: Interview;
  try {
    iv = await db.interview.create({
      data: {
        jobId: job.id,
        candidateId: sub.candidateId,
        clientId: job.clientId,
        submissionId,
        status: "finding",
        candidateTz: timeZoneOfLocation(profile?.location),
        clientTz: client.timezone,
        clientEmail: (sub.messageId && (await db.message.findUnique({ where: { id: sub.messageId } }))?.toEmail) || brief.fromEmail, // where the submission went
      },
    });
  } catch {
    return { ok: false, message: "The client's answer was already recorded." }; // double click: unique (job, candidate)
  }
  // The client's reply is already in the thread (from Gmail): the button only records the decision (specs/13).
  await settleClientReply(job.id, sub.candidateId, "wants_interview");
  await score(sub.traceId, { client_accepted_for_interview: 1 });
  try {
    const problem = await proposeTimes(job, iv, opts);
    if (problem) await queueJobProblem(job, 8, "scheduling: options email", [problem]);
    await flushTelemetry();
    const now = await db.interview.findUniqueOrThrow({ where: { id: iv.id } });
    if (problem) return { ok: false, message: "Recorded. Writing the email with times failed or went over budget; see the approval queue (Try again)." };
    return now.status === "escalated"
      ? { ok: true, message: `Recorded. Scheduling needs you: ${now.escalationReason} (see the approval queue)`, jobId: job.id }
      : { ok: true, message: `Recorded. ${(now.proposedSlots as string[]).length} interview times are ready for your approval (approval queue → Send interview times).`, jobId: job.id };
  } catch (e) {
    if (e instanceof PausedForBudget) return { ok: false, message: "Recorded. The job reached its budget: the times are sent after 'Continue' in the approval queue." };
    throw e;
  }
}

// "Client rejected": no interview. Step 9 records the outcome and reason.
export async function clientRejects(submissionId: string): Promise<WorkflowResult> {
  const sub = await db.submission.findUniqueOrThrow({ where: { id: submissionId } });
  if (sub.status !== "sent") return { ok: false, message: "This submission wasn't sent to the client." };
  if (await db.interview.findUnique({ where: { jobId_candidateId: { jobId: sub.jobId, candidateId: sub.candidateId } } })) return { ok: false, message: "An interview is already being scheduled." };
  const { count } = await db.pipelineEntry.updateMany({ where: { jobId: sub.jobId, candidateId: sub.candidateId, stage: "submitted" }, data: { stage: "client_rejected" } });
  if (!count) return { ok: false, message: "The client's answer was already recorded." };
  await settleClientReply(sub.jobId, sub.candidateId, "rejected");
  await score(sub.traceId, { client_accepted_for_interview: 0 });
  await flushTelemetry();
  return { ok: true, message: "Recorded: the client passed on this candidate. Stage: client rejected.", jobId: sub.jobId };
}

// ---------- 2. the candidate's reply ----------

async function readReply(job: LoadedJob, ivIn: Interview, inboundId: string, opts: RunOptions): Promise<Problem | null> {
  const inbound = await db.message.findUniqueOrThrow({ where: { id: inboundId } });
  let iv = ivIn;
  if (!ACTIVE.includes(iv.status)) {
    // Escalated / no-show: the recruiter has it. Saved, not read by the agent.
    const note: SchedulingReply = { candidate_id: iv.candidateId, intent: "other", slot_number: null, summary: "Not read by the agent: this interview is with the recruiter." };
    await db.message.update({ where: { id: inbound.id }, data: { classification: note } });
    return null;
  }
  const p = await people(job, iv);
  const options = OPEN.includes(iv.status) && iv.candidateTz ? slotsOf(iv).map((d) => slotLine(d, iv.candidateTz!, iv.clientTz)) : [];
  await ensureBudget(job.id, 8);
  const r = await runReadReply({ jobId: job.id, clientId: job.clientId, candidateId: iv.candidateId, options, status: iv.status, reply: inbound.body, extraTags: opts.extraTags });
  if (!r.data) return { candidateId: iv.candidateId, runs: r.runs, error: r.error };
  const c = r.data;
  await db.message.update({ where: { id: inbound.id }, data: { classification: c, agentRunIds: r.runs.map((x) => x.runId), traceId: r.runs.at(-1)!.traceId } });
  iv = await db.interview.update({ where: { id: iv.id }, data: { agentRunIds: [...(iv.agentRunIds as string[]), ...r.runs.map((x) => x.runId)] } });

  if (c.intent === "pick") {
    const chosen = slotsOf(iv)[c.slot_number! - 1];
    // Guardrail, checked again before anything goes out.
    if (!withinWorkingHours(chosen, iv.candidateTz!) || !withinWorkingHours(chosen, iv.clientTz)) {
      await escalate(job, iv, "The chosen time is outside 09:00-19:00 for one side.");
      return null;
    }
    const msg = await toClient(job, iv, p, `${p.forClient} can do the interview for the ${job.title} role at:\n${slotLine(chosen, iv.clientTz, iv.candidateTz!)}\n\nPlease reply to confirm, or tell us if that time doesn't work.`);
    await db.interview.update({
      where: { id: iv.id },
      data: { status: "awaiting_client", chosenSlot: chosen, messagesToConfirm: { increment: msg ? 1 : 0 }, lastSentAt: msg?.sentAt ?? iv.lastSentAt, nudgedAt: null },
    });
    return null;
  }
  if (c.intent === "acknowledge") return null;
  if (c.intent === "decline") return escalate(job, iv, `The candidate no longer wants the interview: ${c.summary}`).then(() => null);
  if (c.intent === "other") return escalate(job, iv, `The candidate's reply needs a person: ${c.summary}`).then(() => null);

  // Reschedule. The second request goes to the recruiter (spec edge case); a booked interview stays booked until then.
  if (iv.rescheduleCount + 1 > MAX_RESCHEDULES) {
    await db.interview.update({ where: { id: iv.id }, data: { rescheduleCount: { increment: 1 } } });
    await escalate(job, iv, `The candidate asked to reschedule a second time: ${c.summary}`);
    return null;
  }
  const was = iv.confirmedSlot ?? iv.chosenSlot;
  if (was && ["awaiting_client", "confirmed"].includes(iv.status)) {
    await toClient(job, iv, p, `${p.forClient} asked to move the interview planned for ${slotLine(was, iv.clientTz, iv.candidateTz!)}. We'll come back with a new time shortly.`);
  }
  await cancel(iv.calendarEventIds as string[]);
  iv = await db.interview.update({
    where: { id: iv.id },
    data: { rescheduleCount: { increment: 1 }, confirmedSlot: null, calendarEventIds: [], reminderSentAt: null, pastSlots: [...(iv.pastSlots as string[]), ...(was ? [was.toISOString()] : [])] },
  });
  return proposeTimes(job, iv, opts, inbound.body);
}

// A candidate's message while an interview is being scheduled (read from Gmail by Check replies).
export async function receiveSchedulingReply(jobId: string, candidateId: string, inboundId: string, opts: RunOptions = {}): Promise<WorkflowResult> {
  await db.message.update({ where: { id: inboundId }, data: { intent: SCHEDULING_INTENT } });
  const job = await loadJob(jobId);
  const iv = await db.interview.findUniqueOrThrow({ where: { jobId_candidateId: { jobId, candidateId } } });
  // Times not sent yet (waiting for the recruiter): no agent reads it; the recruiter sees it next to the times.
  if (iv.status === "times_draft") {
    const inbound = await db.message.findUniqueOrThrow({ where: { id: inboundId } });
    const item = await db.approvalItem.findFirst({ where: { jobId, candidateId, kind: "interview_times", status: "awaiting_approval" } });
    if (item) await db.approvalItem.update({ where: { id: item.id }, data: { detail: `The candidate wrote meanwhile: “${inbound.body.slice(0, 200)}”. ${item.detail ?? ""}`.trim() } });
    return { ok: true, message: "Saved. The interview times aren't sent yet: the candidate's message shows next to them in the approval queue.", jobId };
  }
  try {
    const problem = await readReply(job, iv, inboundId, opts);
    if (problem) await queueJobProblem(job, 8, "scheduling: reading the reply", [problem]);
    await flushTelemetry();
    if (problem) return { ok: false, message: "Reply saved, but reading it failed; see the approval queue (Try again)." };
    const after = await db.interview.findUniqueOrThrow({ where: { id: iv.id } });
    const c = (await db.message.findUniqueOrThrow({ where: { id: inboundId } })).classification as SchedulingReply;
    const next: Record<string, string> = {
      awaiting_client: "The client was asked to confirm that time.",
      rescheduled: "New times were sent to the candidate.",
      proposed: "Nothing to do.",
      confirmed: "Nothing to do: the interview stays booked.",
      escalated: `Scheduling needs you: ${after.escalationReason}`,
    };
    return { ok: true, message: `Agent read: ${c.intent}${c.slot_number ? ` option ${c.slot_number}` : ""}. ${next[after.status] ?? ""}`, jobId };
  } catch (e) {
    if (e instanceof PausedForBudget) return { ok: false, message: "Reply saved. The job reached its budget, so it's read after 'Continue' in the approval queue." };
    throw e;
  }
}

// ---------- 3. the client confirms -> book + confirmations ----------

export async function clientConfirms(interviewId: string): Promise<WorkflowResult> {
  const iv = await db.interview.findUniqueOrThrow({ where: { id: interviewId } });
  if (iv.status !== "awaiting_client" || !iv.chosenSlot) return { ok: false, message: "This interview isn't waiting for the client." };
  // Claim it first, so a double click books once.
  const { count } = await db.interview.updateMany({ where: { id: iv.id, status: "awaiting_client" }, data: { status: "confirmed", confirmedSlot: iv.chosenSlot } });
  if (!count) return { ok: false, message: "Already confirmed." };
  const job = await loadJob(iv.jobId);
  const p = await people(job, iv);
  await settleClientReply(job.id, iv.candidateId, "confirms_time");
  const booked = await book(iv.chosenSlot, [{ person: iv.candidateId, tz: iv.candidateTz! }, { person: iv.clientEmail, tz: iv.clientTz }], `Interview: ${p.forClient} · ${job.title}`, iv.id);
  if ("error" in booked) {
    await db.interview.update({ where: { id: iv.id }, data: { confirmedSlot: null } });
    await escalate(job, { ...iv, status: "confirmed" }, `Booking failed: ${booked.error}.`);
    await flushTelemetry();
    return { ok: false, message: `Booking failed (${booked.error}); see the approval queue.` };
  }
  const slot = iv.chosenSlot;
  // Real event + Meet link (specs/14); without it, the old wording (the client sends the link).
  const meet = await createGoogleEvent(job, { ...iv, status: "confirmed", confirmedSlot: slot }, p);
  const c1 = await toCandidate(job, iv, p, subjectFor(job), `Hi ${p.firstName},\n\nYour interview for the ${job.title} role is booked:\n${slotLine(slot, iv.candidateTz!, iv.clientTz)}\n\n${meet ? `Video call (Google Meet): ${meet}\nA calendar invite is on its way.` : "The client's team will send the video call link."} If anything changes, just reply to this email.\n\n${SENDER_SIGNATURE}`);
  const c2 = await toClient(job, iv, p, `Thanks, the interview with ${p.forClient} is booked:\n${slotLine(slot, iv.clientTz, iv.candidateTz!)}\n\n${meet ? `Video call (Google Meet): ${meet}\nA calendar invite is on its way.` : "Please send the video call link to us and we'll pass it on."}`);
  const done = await db.interview.update({ where: { id: iv.id }, data: { calendarEventIds: booked.eventIds, lastSentAt: c2?.sentAt ?? c1?.sentAt ?? new Date(), nudgedAt: null, escalationReason: null } });
  interviewScores(done, { messages_to_confirm: done.messagesToConfirm, escalated: 0 });
  await closeSchedulingItems(job.id, iv.candidateId);
  await flushTelemetry();
  return { ok: true, message: `Booked in both calendars: ${slotLine(slot, iv.clientTz, iv.candidateTz!)}. Confirmations sent to both.`, jobId: job.id };
}

// The client can't make the time the candidate picked: a conflict, so the recruiter decides (no guessing).
export async function clientDeclinesTime(interviewId: string): Promise<WorkflowResult> {
  const iv = await db.interview.findUniqueOrThrow({ where: { id: interviewId } });
  if (iv.status !== "awaiting_client") return { ok: false, message: "This interview isn't waiting for the client." };
  const job = await loadJob(iv.jobId);
  await settleClientReply(job.id, iv.candidateId, "cant_make_time");
  await escalate(job, iv, "The client can't make the time the candidate picked.");
  await flushTelemetry();
  return { ok: true, message: "Recorded. Scheduling needs you (approval queue).", jobId: job.id };
}

export async function markNoShow(interviewId: string): Promise<WorkflowResult> {
  const iv = await db.interview.findUniqueOrThrow({ where: { id: interviewId } });
  const { count } = await db.interview.updateMany({ where: { id: interviewId, status: "confirmed" }, data: { status: "no_show" } });
  if (!count) return { ok: false, message: "Only a booked interview can be a no-show." };
  const job = await loadJob(iv.jobId);
  const candidate = await db.candidate.findUniqueOrThrow({ where: { id: iv.candidateId } });
  await db.approvalItem.create({
    data: { kind: "scheduling", step: 8, status: "awaiting_approval", title: `No-show: ${candidate.fullName} · ${job.title}`, detail: "The candidate missed the interview. Talk to the candidate and the client, then mark this handled.", clientId: job.clientId, jobId: job.id, candidateId: iv.candidateId },
  });
  return { ok: true, message: "Marked as no-show; it's in the approval queue for you.", jobId: job.id };
}

// "Try again" on an escalated interview (Job page): the recruiter sorted out the problem; find and send new times.
// Interview tab "Save and find times": the recruiter sets the candidate's time zone (it couldn't be read from their
// location), then times are found again as with Try again.
export async function setCandidateTimeZone(interviewId: string, tz: string, opts: RunOptions = {}): Promise<WorkflowResult> {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    return { ok: false, message: "Choose a time zone." };
  }
  const { count } = await db.interview.updateMany({ where: { id: interviewId, status: "escalated" }, data: { candidateTz: tz } });
  if (!count) return { ok: false, message: "Only an interview that needs you can be changed here." };
  return retryScheduling(interviewId, opts);
}

export async function retryScheduling(interviewId: string, opts: RunOptions = {}): Promise<WorkflowResult> {
  const iv = await db.interview.findUniqueOrThrow({ where: { id: interviewId } });
  if (iv.status !== "escalated") return { ok: false, message: "Only an escalated interview can be retried." };
  const job = await loadJob(iv.jobId);
  await cancel(iv.calendarEventIds as string[]);
  // The location may be readable now (more places known, or the profile changed).
  const profile = iv.candidateTz ? null : ((await db.candidateProfile.findUnique({ where: { candidateId: iv.candidateId } }))?.data as CandidateProfileData | undefined);
  const reset = await db.interview.update({
    where: { id: iv.id },
    data: { candidateTz: iv.candidateTz ?? timeZoneOfLocation(profile?.location), status: "finding", escalationReason: null, rescheduleCount: 0, chosenSlot: null, confirmedSlot: null, calendarEventIds: [], reminderSentAt: null },
  });
  await closeSchedulingItems(job.id, iv.candidateId);
  try {
    const problem = await proposeTimes(job, reset, opts);
    if (problem) await queueJobProblem(job, 8, "scheduling: options email", [problem]);
    await flushTelemetry();
    const now = await db.interview.findUniqueOrThrow({ where: { id: iv.id } });
    if (problem) return { ok: false, message: "Writing the email failed or went over budget; see the approval queue (Try again)." };
    return now.status === "escalated" ? { ok: false, message: `Still needs you: ${now.escalationReason}` } : { ok: true, message: "New times sent to the candidate.", jobId: job.id };
  } catch (e) {
    if (e instanceof PausedForBudget) return { ok: false, message: "The job reached its budget: new times are sent after 'Continue' in the approval queue." };
    throw e;
  }
}

// ---------- 4. reminders and nudges ("Run reminders now"; hosted: a Trigger.dev schedule) ----------

// Reminder REMINDER_BEFORE_HOURS before a booked interview; a nudge after NUDGE_AFTER_HOURS without an answer;
// still nothing NUDGE_AFTER_HOURS after the nudge -> the recruiter. `now` is for automated tests only.
export async function runSchedulingReminders(jobId: string, opts: { now?: Date } = {}): Promise<WorkflowResult> {
  const now = opts.now ?? new Date();
  const waited = (since: Date | null, hours: number) => !!since && now.getTime() - since.getTime() >= hours * HOUR;
  const job = await loadJob(jobId);
  const interviews = await db.interview.findMany({ where: { jobId, status: { in: [...OPEN, "awaiting_client", "confirmed"] } } });
  let reminders = 0;
  let nudges = 0;
  let escalated = 0;
  for (const iv of interviews) {
    const p = await people(job, iv);
    const ctz = iv.candidateTz!;
    if (iv.status === "confirmed") {
      const slot = iv.confirmedSlot!;
      const due = !iv.reminderSentAt && slot > now && slot.getTime() - now.getTime() <= REMINDER_BEFORE_HOURS * HOUR;
      if (!due) continue;
      await toCandidate(job, iv, p, subjectFor(job), `Hi ${p.firstName},\n\nA reminder of your interview for the ${job.title} role:\n${slotLine(slot, ctz, iv.clientTz)}\n\nGood luck. If anything changes, just reply to this email.\n\n${SENDER_SIGNATURE}`);
      await toClient(job, iv, p, `A reminder of the interview with ${p.forClient}:\n${slotLine(slot, iv.clientTz, ctz)}`);
      await db.interview.update({ where: { id: iv.id }, data: { reminderSentAt: now } });
      reminders++;
      continue;
    }
    if (iv.nudgedAt) {
      if (waited(iv.nudgedAt, NUDGE_AFTER_HOURS)) {
        await escalate(job, iv, `No answer from the ${iv.status === "awaiting_client" ? "client" : "candidate"} ${NUDGE_AFTER_HOURS}h after a nudge.`);
        escalated++;
      }
      continue;
    }
    if (!waited(iv.lastSentAt, NUDGE_AFTER_HOURS)) continue;
    const msg =
      iv.status === "awaiting_client"
        ? await toClient(job, iv, p, `A quick check: does this time work for the interview with ${p.forClient}?\n${slotLine(iv.chosenSlot!, iv.clientTz, ctz)}`)
        : await toCandidate(job, iv, p, subjectFor(job), `Hi ${p.firstName},\n\nJust checking in about the interview for the ${job.title} role. Do any of these times work?\n${optionsList(slotsOf(iv), ctz, iv.clientTz)}\n\nReply with the option number, or tell me if none of them work.\n\n${SENDER_SIGNATURE}`);
    await db.interview.update({ where: { id: iv.id }, data: { nudgedAt: now, messagesToConfirm: { increment: msg ? 1 : 0 } } });
    nudges++;
  }
  await flushTelemetry();
  const parts = [`${reminders} reminder(s)`, `${nudges} nudge(s)`, escalated ? `${escalated} sent to the approval queue (no answer after a nudge)` : null].filter(Boolean);
  return { ok: true, message: `${parts.join(", ")} sent.`, jobId };
}

// ---------- missing work (called by the job's Steps 5-8 run: Try again, Continue) ----------

export async function schedulingStep(job: LoadedJob, opts: RunOptions = {}) {
  const problems: Problem[] = [];
  try {
    for (const iv of await db.interview.findMany({ where: { jobId: job.id, status: "finding" } })) {
      const p = await proposeTimes(job, iv, opts);
      if (p) problems.push(p);
    }
    // Replies saved but not read yet (the run failed, budget pause, app restarted), oldest first.
    const unread = (await db.message.findMany({ where: { jobId: job.id, intent: SCHEDULING_INTENT }, orderBy: { sentAt: "asc" } })).filter((m) => !m.classification);
    for (const m of unread) {
      const iv = await db.interview.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId: m.candidateId } } });
      if (!iv) continue;
      const p = await readReply(job, iv, m.id, opts);
      if (p) problems.push(p);
    }
  } finally {
    await queueJobProblem(job, 8, "scheduling", problems);
    await flushTelemetry();
  }
}
