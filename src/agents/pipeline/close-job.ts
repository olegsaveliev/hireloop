// "Close position" / "Reopen" on the Job page (2026-10-10). Closing stops the job for good unless reopened: nothing
// more runs or goes out, nothing waits for a human. What happened is kept (messages, outcomes, runs).
import { db } from "@/lib/db";
import { CLOSE_REASONS, type CloseReason } from "@/config/feedback";
import type { WorkflowResult } from "../job-spec/workflow";
import { cancel } from "../tools/bookings";
import { cancelGoogleEvent } from "../scheduling/workflow";

// Interviews still being arranged; booked ones count too when they are still ahead.
const ARRANGING = ["finding", "times_draft", "proposed", "rescheduled", "awaiting_client", "escalated"];
const CLOSED_ALREADY = ["closed", "stopped"];

// What closing would cancel, for the confirm box.
export async function closeImpact(jobId: string) {
  const now = new Date();
  const [drafts, items, interviews, submissions] = await Promise.all([
    db.message.count({ where: { jobId, direction: "outbound", status: "awaiting_approval" } }),
    db.approvalItem.count({ where: { jobId, status: "awaiting_approval" } }),
    db.interview.findMany({ where: { jobId } }),
    db.submission.count({ where: { jobId, status: "awaiting_approval" } }),
  ]);
  const arranging = interviews.filter((i) => ARRANGING.includes(i.status)).length;
  const booked = interviews.filter((i) => i.status === "confirmed" && !!i.confirmedSlot && i.confirmedSlot > now).length;
  return { drafts, items, arranging, booked, submissions };
}

export async function closeJob(jobId: string, reason: string, note: string): Promise<WorkflowResult> {
  if (!(reason in CLOSE_REASONS)) return { ok: false, message: "Choose why the position is closed." };
  if (reason === "other" && !note.trim()) return { ok: false, message: "Add a short note when the reason is Other." };
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (CLOSED_ALREADY.includes(job.status)) return { ok: false, message: "This job is already closed." };
  if (await db.pipelineEntry.count({ where: { jobId, stage: "hired" } })) return { ok: false, message: "Someone was hired on this job; it's done already." };
  const now = new Date();
  // Status first (only if it didn't change meanwhile), so a running agent step stops at its next check.
  const { count } = await db.job.updateMany({
    where: { id: jobId, status: job.status },
    data: { status: "closed", statusBeforeClose: job.status, closedAt: now, closeReason: reason, closeNote: note.trim() || null, pipelineUpdatedAt: now },
  });
  if (!count) return { ok: false, message: "The job changed meanwhile; try again." };

  const done: string[] = [];
  const drafts = await db.message.updateMany({ where: { jobId, direction: "outbound", status: "awaiting_approval" }, data: { status: "cancelled", decidedAt: now } });
  if (drafts.count) done.push(`${drafts.count} unsent draft(s) cancelled`);
  const subs = await db.submission.updateMany({ where: { jobId, status: "awaiting_approval" }, data: { status: "withdrawn", decidedAt: now } });
  if (subs.count) done.push(`${subs.count} submission(s) not sent`);
  for (const iv of await db.interview.findMany({ where: { jobId } })) {
    const bookedLater = iv.status === "confirmed" && !!iv.confirmedSlot && iv.confirmedSlot > now;
    if (!ARRANGING.includes(iv.status) && !bookedLater) continue;
    await cancel(iv.calendarEventIds as string[]);
    await db.interview.update({ where: { id: iv.id }, data: { status: "cancelled", calendarEventIds: [] } });
    const google = await cancelGoogleEvent(iv);
    done.push(google ? `interview cancelled (${google})` : "interview cancelled");
  }
  const items = await db.approvalItem.updateMany({ where: { jobId, status: "awaiting_approval" }, data: { status: "dismissed", decidedAt: now } });
  if (items.count) done.push(`${items.count} approval item(s) cleared`);
  return { ok: true, message: `Position closed: ${CLOSE_REASONS[reason as CloseReason].toLowerCase()}.${done.length ? ` ${done.join("; ")}.` : ""}`, jobId };
}

// Undo a close: back to where it was. Cancelled drafts and interviews stay cancelled (the agents redo missing work).
export async function reopenJob(jobId: string): Promise<WorkflowResult> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status !== "closed") return { ok: false, message: "This job isn't closed." };
  await db.job.update({ where: { id: jobId }, data: { status: resumeStatus(job.statusBeforeClose), closedAt: null, closeReason: null, closeNote: null, statusBeforeClose: null, pipelineUpdatedAt: new Date() } });
  return { ok: true, message: "Reopened. The job is back where it was.", jobId };
}

// A job closed while agents were working goes back to the step that resumes that work.
function resumeStatus(status: string | null): string {
  if (status === "drafting_outreach") return "outreach";
  if (status === "sourcing" || status === "enriching" || status === "screening") return "ready_for_sourcing";
  return status ?? "ready_for_sourcing";
}
