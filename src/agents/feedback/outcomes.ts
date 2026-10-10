// Step 9: record a candidate's final outcome (docs/specs/09-feedback-loop.md). No AI.
// The outcome becomes a final_outcome score (hired = 1, rejected by client / withdrew = 0, the reason as the comment)
// on the candidate's earlier traces: screening, pre-screen summary, submission. Then the recruiter's corrections from
// earlier steps are collected into the agents' datasets (src/agents/feedback/corrections.ts).
import { db } from "@/lib/db";
import { MIN_REASON_CHARS, OUTCOMES, OUTCOMES_FOR_STAGE, protectedInReason, type OutcomeKind } from "@/config/feedback";
import type { WorkflowResult } from "../job-spec/workflow";
import { getTelemetry, flushTelemetry } from "../telemetry";
import { cancel } from "../tools/bookings";
import { syncOutreachItem } from "../outreach/workflow";
import { cancelGoogleEvent } from "../scheduling/workflow";
import { collectCorrections } from "./corrections";

export type ScoredTrace = { agent: string; traceId: string };

// Interviews still being arranged, or booked for later, are cancelled when the candidate is out.
const ACTIVE_INTERVIEW = ["finding", "times_draft", "proposed", "rescheduled", "awaiting_client", "escalated"];

// The traces that get final_outcome: the agents that judged this candidate (decision J in the Phase 5 plan).
export async function outcomeTraces(jobId: string, candidateId: string): Promise<ScoredTrace[]> {
  const [screening, prescreen, submissions] = await Promise.all([
    db.screeningResult.findFirst({ where: { jobId, candidateId, current: true } }),
    db.prescreen.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } }),
    db.submission.findMany({ where: { jobId, candidateId }, orderBy: { createdAt: "desc" } }),
  ]);
  const submission = submissions.find((s) => s.status === "sent") ?? submissions[0];
  return [
    { agent: "screening-agent", traceId: screening?.traceId },
    { agent: "prescreen-agent", traceId: prescreen?.traceId },
    { agent: "submission-agent", traceId: submission?.traceId },
  ].filter((t): t is ScoredTrace => !!t.traceId);
}

export function checkReason(reason: string): string | null {
  const r = reason.trim();
  if (r.length < MIN_REASON_CHARS) return "Add a short reason (a few words), e.g. “accepted another offer” or “client chose a candidate with more AWS”.";
  const hits = protectedInReason(r);
  if (hits.length)
    return `Please rewrite the reason without protected attributes (found: ${hits.join(", ")}). Keep it about the job, e.g. “personal reasons” or “system design interview was weak”.`;
  return null;
}

export async function recordOutcome(jobId: string, candidateId: string, outcome: OutcomeKind, reason: string): Promise<WorkflowResult> {
  if (!OUTCOMES[outcome]) return { ok: false, message: "Pick an outcome." };
  const problem = checkReason(reason);
  if (problem) return { ok: false, message: problem };
  const entry = await db.pipelineEntry.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
  if (!entry) return { ok: false, message: "This candidate isn't in this job's pipeline." };
  const existing = await db.outcome.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
  // "Client rejected" (Step 8 button) already moved the stage; the outcome then adds the reason.
  const stageBefore = existing?.stageBefore ?? (entry.stage === "client_rejected" ? "submitted" : entry.stage);
  const allowed = existing ? OUTCOMES_FOR_STAGE[stageBefore] : OUTCOMES_FOR_STAGE[entry.stage];
  if (!allowed?.includes(outcome))
    return { ok: false, message: `“${OUTCOMES[outcome].label}” doesn't fit a candidate at stage “${entry.stage.replaceAll("_", " ")}”${allowed ? ` (possible: ${allowed.map((o) => OUTCOMES[o].label).join(", ")})` : ""}.` };

  const def = OUTCOMES[outcome];
  const row = await db.outcome.upsert({
    where: { jobId_candidateId: { jobId, candidateId } },
    create: { jobId, candidateId, outcome, reason: reason.trim(), stageBefore },
    update: { outcome, reason: reason.trim() },
  });
  await db.pipelineEntry.update({ where: { id: entry.id }, data: { stage: def.stage } });
  const cleaned = await closeCandidate(jobId, candidateId, outcome);

  // final_outcome on the earlier traces. Fixed score ids: recording again replaces the value instead of adding one.
  const traces = await outcomeTraces(jobId, candidateId);
  const { langfuse } = getTelemetry();
  for (const t of traces) {
    langfuse.score.create({ id: `final-outcome-${row.id}-${t.agent}`, traceId: t.traceId, name: "final_outcome", value: def.score, comment: `${def.label}: ${reason.trim()}` });
  }
  await db.outcome.update({ where: { id: row.id }, data: { scoredTraces: traces } });
  await flushTelemetry();

  // Corrections from earlier steps -> the agents' datasets (also done by the weekly job).
  const collected = await collectCorrections();

  const where = traces.map((t) => t.agent.replace("-agent", "")).join(", ");
  return {
    ok: true,
    message:
      `${existing ? "Updated" : "Recorded"}: ${def.label}. ` +
      (traces.length ? `final_outcome = ${def.score} added to ${traces.length} earlier trace(s) (${where}).` : "No earlier agent traces found for this candidate.") +
      (cleaned ? ` ${cleaned}` : "") +
      (collected.added ? ` ${collected.added} new correction(s) added to the datasets.` : ""),
    jobId,
  };
}

// The candidate is finished: nothing more goes out and nothing waits for a human. Returns what was cleaned up.
async function closeCandidate(jobId: string, candidateId: string, outcome: OutcomeKind): Promise<string> {
  const done: string[] = [];
  const now = new Date();
  const iv = await db.interview.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
  const bookedLater = iv?.status === "confirmed" && !!iv.confirmedSlot && iv.confirmedSlot > now;
  if (iv && (ACTIVE_INTERVIEW.includes(iv.status) || (bookedLater && outcome !== "hired"))) {
    await cancel(iv.calendarEventIds as string[]);
    await db.interview.update({ where: { id: iv.id }, data: { status: "cancelled", calendarEventIds: [] } });
    done.push("interview cancelled (calendar freed)");
    const google = await cancelGoogleEvent(iv); // specs/14: the real event, if the app created one
    if (google) done.push(google);
  }
  const drafts = await db.message.updateMany({ where: { jobId, candidateId, direction: "outbound", status: "awaiting_approval" }, data: { status: "cancelled", decidedAt: now } });
  if (drafts.count) {
    await syncOutreachItem(jobId);
    done.push(`${drafts.count} unsent draft(s) cancelled`);
  }
  const subs = await db.submission.updateMany({ where: { jobId, candidateId, status: "awaiting_approval" }, data: { status: "withdrawn", decidedAt: now } });
  if (subs.count) done.push("pending submission withdrawn");
  const items = await db.approvalItem.findMany({ where: { jobId, candidateId, status: "awaiting_approval" } });
  for (const i of items) {
    await db.approvalItem.update({ where: { id: i.id }, data: { status: "dismissed", decidedAt: now, detail: `${i.detail ?? ""} Closed: final outcome recorded.`.trim() } });
  }
  if (items.length) done.push(`${items.length} queue item(s) closed`);
  return done.length ? `Also: ${done.join(", ")}.` : "";
}
