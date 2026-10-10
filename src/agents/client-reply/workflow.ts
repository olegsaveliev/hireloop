// Client replies from real Gmail (docs/specs/13-gmail-client-emails.md). The reply is saved in the candidate's thread
// (kind "client"), Haiku suggests which button to click, and a "Client replied" item waits in the approval queue.
// The account manager decides with the existing buttons (Client wants interview / rejected / confirms / can't make it).
import { db } from "@/lib/db";
import { slotLine } from "@/lib/timezones";
import type { RunOptions } from "../pipeline/workflow";
import { getTelemetry, flushTelemetry } from "../telemetry";
import type { ParsedEmail } from "../tools/gmail";
import { receiveFromClient } from "../tools/mock-inbox";
import { runClientReplyHint } from "./agent";
import { HINT_LABELS, type ClientReplyHint, type ClientSituation } from "./schema";

export async function receiveClientReply(jobId: string, candidateId: string, email: ParsedEmail, opts: RunOptions = {}) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const [interview, entry, outcome, candidate, sub] = await Promise.all([
    db.interview.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } }),
    db.pipelineEntry.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } }),
    db.outcome.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } }),
    db.candidate.findUnique({ where: { id: candidateId } }),
    db.submission.findFirst({ where: { jobId, candidateId, status: "sent" } }),
  ]);
  const msg = await receiveFromClient({
    jobId,
    candidateId,
    subject: email.subject,
    body: email.body || "(no text in the email)",
    receivedAt: email.receivedAt,
    gmailMessageId: email.gmailMessageId,
    gmailThreadId: email.gmailThreadId,
  });

  const situation: ClientSituation =
    interview?.status === "awaiting_client" ? "awaiting_client" : !interview && entry?.stage === "submitted" ? "submission_sent" : "other_stage";
  let hint: ClientReplyHint | null = null;
  if (!outcome) {
    const r = await runClientReplyHint({
      situation,
      reply: msg.body,
      jobTitle: job.title,
      candidateRef: sub?.anonymized ? "the candidate (anonymized)" : (candidate?.fullName ?? candidateId),
      pickedTime: interview?.chosenSlot ? slotLine(interview.chosenSlot, interview.clientTz, interview.candidateTz ?? interview.clientTz) : null,
      jobId,
      clientId: job.clientId,
      extraTags: opts.extraTags,
    });
    if (r.data) {
      hint = r.data;
      await db.message.update({ where: { id: msg.id }, data: { classification: { ...r.data, situation }, agentRunIds: r.runs.map((x) => x.runId), traceId: r.runs.at(-1)!.traceId } });
    }
  }

  const name = candidate?.fullName ?? candidateId;
  const excerpt = msg.body.length > 240 ? `${msg.body.slice(0, 240)}…` : msg.body;
  const detail = `“${excerpt}”${hint ? ` · AI hint: ${HINT_LABELS[hint.suggestion]} (${hint.reason})` : outcome ? " · This candidate already has a final outcome." : " · AI hint unavailable."}`;
  const open = await db.approvalItem.findFirst({ where: { jobId, candidateId, kind: "client_replied", status: "awaiting_approval" } });
  if (open) await db.approvalItem.update({ where: { id: open.id }, data: { detail } });
  else {
    await db.approvalItem.create({
      data: { kind: "client_replied", step: interview ? 8 : 7, status: "awaiting_approval", title: `Client replied: ${name} (${job.title})`, detail, clientId: job.clientId, jobId, candidateId },
    });
  }
  await flushTelemetry();
  return hint ? `client replied, AI hint: ${HINT_LABELS[hint.suggestion]}` : "client replied";
}

// The latest real (Gmail) client reply for this candidate that came after our latest email to the client.
async function unansweredRealReply(jobId: string, candidateId: string) {
  const lastOut = await db.message.findFirst({ where: { jobId, candidateId, direction: "outbound", kind: { in: ["submission", "scheduling_client"] }, status: "sent" }, orderBy: { sentAt: "desc" } });
  return db.message.findFirst({
    where: { jobId, candidateId, direction: "inbound", kind: "client", gmailMessageId: { not: null }, ...(lastOut?.sentAt ? { sentAt: { gt: lastOut.sentAt } } : {}) },
    orderBy: { sentAt: "desc" },
  });
}

// Called by the client buttons. If the client really replied (Gmail), the button only records the decision: scores
// hint_followed, closes the "Client replied" item, and returns true (the caller writes no simulated client reply).
export async function settleClientReply(jobId: string, candidateId: string, clicked: string): Promise<boolean> {
  const real = await unansweredRealReply(jobId, candidateId);
  await db.approvalItem.updateMany({ where: { jobId, candidateId, kind: "client_replied", status: "awaiting_approval" }, data: { status: "approved", decidedAt: new Date() } });
  if (!real) return false;
  const hint = real.classification as (ClientReplyHint & { scored?: boolean }) | null;
  if (hint?.suggestion && real.traceId && !hint.scored) {
    getTelemetry().langfuse.score.create({ traceId: real.traceId, name: "hint_followed", value: hint.suggestion === clicked ? 1 : 0, comment: `hint ${hint.suggestion}, clicked ${clicked}` });
    await db.message.update({ where: { id: real.id }, data: { classification: { ...hint, scored: true } } });
    await flushTelemetry();
  }
  return true;
}
