"use server";

import {
  addToShortlist,
  approveShortlist,
  canStartPipeline,
  continueOverBudget,
  editSpecAndResource,
  stopOverBudget,
  type ShortlistDecision,
} from "@/agents/pipeline/workflow";
import { canStartOutreach, reviewClassification, runFollowUps } from "@/agents/outreach/workflow";
import type { Intent } from "@/agents/outreach/schema";
import { decidePrescreen, startPrescreenNow, type PrescreenDecision } from "@/agents/prescreen/workflow";
import { db } from "@/lib/db";
import { closeJob, reopenJob } from "@/agents/pipeline/close-job";
import { asState, type ActionState } from "../action-state";
import { createGoogleEventNow } from "@/agents/scheduling/workflow";
import { checkCandidateReplies, repliesSummary } from "@/agents/outreach/gmail-replies";
import { GoogleNotConnectedError } from "@/agents/tools/google-auth";
import { continueJobInBackground, startPipelineInBackground } from "../pipeline-background";
import { approveSubmission, rejectSubmission, setConfirmedRate, withdrawSubmission } from "@/agents/submission/workflow";
import type { SubmissionFields } from "@/agents/submission/schema";
import { recordOutcome } from "@/agents/feedback/outcomes";
import type { OutcomeKind } from "@/config/feedback";
import { clientConfirms, clientDeclinesTime, clientRejects, markNoShow, requestInterview, retryScheduling, runSchedulingReminders, setCandidateTimeZone } from "@/agents/scheduling/workflow";

// Jobs page: "Start sourcing" / "Resume".
export async function startPipelineAction(jobId: string): Promise<ActionState> {
  return asState(async () => startPipelineInBackground(await canStartPipeline(jobId)));
}

// Approving the shortlist starts Step 5: first-message drafts are written in the background.
export async function approveShortlistAction(jobId: string, decisions: ShortlistDecision[]): Promise<ActionState> {
  return asState(async () => startPipelineInBackground(await approveShortlist(jobId, decisions)));
}

// Shortlist "reject": edit the approved spec, then sourcing re-runs and everyone is re-screened.
export async function editSpecAndResourceAction(jobId: string, spec: unknown, comment: string): Promise<ActionState> {
  return asState(async () => startPipelineInBackground(await editSpecAndResource(jobId, spec, comment)));
}

// Approval queue: job budget reached.
export async function continueOverBudgetAction(itemId: string): Promise<ActionState> {
  return asState(async () => startPipelineInBackground(await continueOverBudget(itemId)));
}

export async function stopOverBudgetAction(itemId: string): Promise<ActionState> {
  return asState(() => stopOverBudget(itemId));
}

// ---------- Step 5 (Job page) ----------

// "Draft outreach": jobs shortlisted before Phase 3, or to draft for candidates added since.
export async function startOutreachAction(jobId: string): Promise<ActionState> {
  return asState(async () => startPipelineInBackground(await canStartOutreach(jobId)));
}

// "Run follow-ups now": drafts the follow-ups that are due (FOLLOW_UP_AFTER_DAYS after the last message).
export async function runFollowUpsAction(jobId: string): Promise<ActionState> {
  return asState(() => runFollowUps(jobId));
}

export async function reviewClassificationAction(messageId: string, correct: boolean, intent?: Intent): Promise<ActionState> {
  return asState(() => reviewClassification(messageId, correct, intent));
}

// ---------- Step 6 (Job page, approval queue) ----------

// "Start pre-screen": send the questions to a candidate who replied (no approval needed).
export async function startPrescreenAction(jobId: string, candidateId: string): Promise<ActionState> {
  return asState(() => startPrescreenNow(jobId, candidateId));
}

// After reading the summary: prepare a submission (Step 7 drafts it in the background), or don't submit.
export async function decidePrescreenAction(jobId: string, candidateId: string, decision: PrescreenDecision): Promise<ActionState> {
  return asState(async () => {
    const r = await decidePrescreen(jobId, candidateId, decision);
    return decision === "submit" ? continueJobInBackground(r) : r;
  });
}

// ---------- Step 7 (approval queue, submission screen) ----------

// "Rate needed": the confirmed rate, then the profile is drafted in the background.
export async function setConfirmedRateAction(jobId: string, candidateId: string, rate: string): Promise<ActionState> {
  return asState(async () => continueJobInBackground(await setConfirmedRate(jobId, candidateId, rate)));
}

export async function approveSubmissionAction(submissionId: string, fields: SubmissionFields): Promise<ActionState> {
  return asState(() => approveSubmission(submissionId, fields));
}

export async function rejectSubmissionAction(submissionId: string, comment: string): Promise<ActionState> {
  return asState(() => rejectSubmission(submissionId, comment));
}

export async function withdrawSubmissionAction(submissionId: string): Promise<ActionState> {
  return asState(() => withdrawSubmission(submissionId));
}

// ---------- Step 8 (Job page) ----------

// The client's answer to a submission, recorded after their reply arrives in Gmail (specs/13).
export async function requestInterviewAction(submissionId: string): Promise<ActionState> {
  return asState(() => requestInterview(submissionId));
}

export async function clientRejectsAction(submissionId: string): Promise<ActionState> {
  return asState(() => clientRejects(submissionId));
}

export async function clientConfirmsAction(interviewId: string): Promise<ActionState> {
  return asState(() => clientConfirms(interviewId));
}

export async function clientDeclinesTimeAction(interviewId: string): Promise<ActionState> {
  return asState(() => clientDeclinesTime(interviewId));
}

export async function markNoShowAction(interviewId: string): Promise<ActionState> {
  return asState(() => markNoShow(interviewId));
}

export async function retrySchedulingAction(interviewId: string): Promise<ActionState> {
  return asState(() => retryScheduling(interviewId));
}

// "Run reminders now" (no timers locally): reminders 24h before, nudges after 48h without an answer.
export async function runSchedulingRemindersAction(jobId: string): Promise<ActionState> {
  return asState(() => runSchedulingReminders(jobId));
}

// ---------- Step 9 (Job page) ----------

// "Record outcome": hired / rejected by client / withdrew + reason (no AI). Scores the earlier traces, collects
// corrections into the datasets.
export async function recordOutcomeAction(jobId: string, candidateId: string, outcome: OutcomeKind, reason: string): Promise<ActionState> {
  return asState(() => recordOutcome(jobId, candidateId, outcome, reason));
}

// Job page "Check replies": candidates' replies from real Gmail for this job (docs/specs/12-gmail-outreach.md).
export async function checkRepliesAction(jobId: string): Promise<ActionState> {
  return asState(async () => {
    try {
      const r = await checkCandidateReplies({ jobId });
      // A reply can unlock the next step (e.g. pre-screen "proceed" -> Step 7): the job's run continues in the background.
      if (r.jobIds.length) await continueJobInBackground({ ok: true, message: "", jobId });
      return { ok: true, message: repliesSummary(r) || "No Gmail conversations for this job yet." };
    } catch (e) {
      if (e instanceof GoogleNotConnectedError) return { ok: false, message: e.message };
      throw e;
    }
  });
}

// Interviews booked before Google Calendar (specs/14): create the real event once.
export async function createGoogleEventAction(interviewId: string): Promise<ActionState> {
  return asState(() => createGoogleEventNow(interviewId));
}

// Job page: clicking a Candidate / Client tab marks its new emails (received or sent) as seen; the "New" tag goes.
export async function markSeenAction(messageIds: string[]): Promise<void> {
  if (!messageIds.length) return;
  await db.message.updateMany({ where: { id: { in: messageIds }, seenAt: null }, data: { seenAt: new Date() } });
}

// Interview tab: set the candidate's time zone (unknown from their location) and find times again.
export async function setCandidateTimeZoneAction(interviewId: string, tz: string): Promise<ActionState> {
  return asState(() => setCandidateTimeZone(interviewId, tz));
}

// Job page, Not shortlisted tab: put a candidate on the shortlist; outreach drafts their first message (job in outreach).
export async function addToShortlistAction(jobId: string, candidateId: string): Promise<ActionState> {
  return asState(async () => continueJobInBackground(await addToShortlist(jobId, candidateId)));
}

// Job page: "Close position" (with a reason) and "Reopen" (src/agents/pipeline/close-job.ts).
export async function closeJobAction(jobId: string, reason: string, note: string): Promise<ActionState> {
  return asState(() => closeJob(jobId, reason, note));
}
export async function reopenJobAction(jobId: string): Promise<ActionState> {
  return asState(async () => {
    const r = await reopenJob(jobId);
    // Back in outreach: replies that came in meanwhile get read, missing work is redone.
    return continueJobInBackground(r);
  });
}
