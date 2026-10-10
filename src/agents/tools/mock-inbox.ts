// mock_inbox: the `messages` table is the outbox and inbox. Called by app code only (the agents get the thread in
// their prompt and need no tools).
// Real Gmail (docs/specs/12-gmail-outreach.md): emails to candidates are delivered through Gmail to the address in their
// profile (test.inbox+<n>@example.com), which must be on the send allow-list. Emails to the client (Step 7 submission,
// Step 8 client emails) go through Gmail to the client contact itself when that address is on the allow-list, else
// they're only recorded here (docs/specs/13-gmail-client-emails.md).
import { isSendAllowed } from "@/config/google";
import { db } from "@/lib/db";
import { gmailTransport, realGmailAllowed } from "./gmail";

export type ThreadMessage = Awaited<ReturnType<typeof getThread>>[number];

// Everything in one candidate's thread for one job, oldest first (drafts included).
export async function getThread(jobId: string, candidateId: string) {
  const rows = await db.message.findMany({ where: { jobId, candidateId } });
  return rows.sort((a, b) => (a.sentAt ?? a.createdAt).getTime() - (b.sentAt ?? b.createdAt).getTime());
}

// Messages between us and the client (kept in the candidate's thread for the record; never shown to the
// candidate-facing agents): Step 7 submission, Step 8 scheduling emails to the client, and the client's replies.
export const CLIENT_KINDS = ["submission", "scheduling_client", "client"];

// Sent and received messages with the candidate only, as plain text for an agent's prompt.
export function threadText(thread: ThreadMessage[]): string {
  const real = thread.filter((m) => (m.status === "sent" || m.status === "received") && !CLIENT_KINDS.includes(m.kind));
  if (!real.length) return "(no messages yet)";
  return real
    .map((m) => {
      const who = m.direction === "outbound" ? "Recruiter (us)" : "Candidate";
      const when = (m.sentAt ?? m.createdAt).toISOString().slice(0, 10);
      return `--- ${who}, ${when}${m.direction === "outbound" ? `, subject: ${m.subject}` : ""}\n${m.body}`;
    })
    .join("\n\n");
}

// Candidate-facing kinds that go through Gmail, to the candidate's own address.
const GMAIL_KINDS = ["first", "follow_up", "reply", "prescreen", "scheduling"];
// Client-facing kinds: through Gmail to the contact's own address, only if it's allow-listed. Their own thread.
const CLIENT_GMAIL_KINDS = ["submission", "scheduling_client"];

type Delivered = { gmailMessageId: string; gmailThreadId: string; deliveredTo: string } | null;

// Sends one message through Gmail, in the candidate's existing Gmail thread for this job if there is one.
// null = not delivered (client not allow-listed, or an automated test). Throws if Gmail refuses or a candidate's address
// isn't allowed (caller rolls back).
async function deliver(messageId: string): Promise<Delivered> {
  const m = await db.message.findUniqueOrThrow({ where: { id: messageId } });
  const toClient = CLIENT_GMAIL_KINDS.includes(m.kind);
  const to = toClient ? (m.toEmail && isSendAllowed(m.toEmail) ? m.toEmail.toLowerCase() : null) : GMAIL_KINDS.includes(m.kind) ? (m.toEmail?.toLowerCase() ?? null) : null;
  if (!to || !realGmailAllowed()) return null; // automated tests without a fake Gmail: recorded only
  if (!isSendAllowed(to)) throw new Error(`${to} isn't on the send allow-list (GOOGLE_SEND_ALLOWLIST)`);
  const earlier = await db.message.findMany({
    where: { jobId: m.jobId, candidateId: m.candidateId, gmailThreadId: { not: null }, direction: "outbound", kind: { in: toClient ? CLIENT_GMAIL_KINDS : GMAIL_KINDS } },
    orderBy: { sentAt: "asc" },
  });
  const first = earlier[0];
  // Gmail keeps a reply in a thread only if the subject matches, so later emails use "Re: <first subject>".
  const subject = first ? `Re: ${first.subject.replace(/^(Re:\s*)+/i, "")}` : m.subject;
  const body = m.footer ? `${m.body}\n\n${m.footer}` : m.body;
  const sent = await gmailTransport.send({ to, subject, body, threadId: first?.gmailThreadId });
  return { ...sent, deliveredTo: to };
}

export type SendResult = { ok: true } | { ok: false; error: string | null }; // error null = already decided

// Send = the approved draft goes out. The ONLY place an approved draft becomes "sent" ("never send without
// approval"): the draft is claimed first (awaiting_approval -> sending), so a double click can't send twice.
// If Gmail refuses, the draft goes back to awaiting_approval and nothing is marked sent.
export async function send(messageId: string, edits: { subject: string; body: string }): Promise<SendResult> {
  const { count } = await db.message.updateMany({
    where: { id: messageId, direction: "outbound", status: "awaiting_approval", toEmail: { not: null } },
    data: { status: "sending", subject: edits.subject, body: edits.body },
  });
  if (count !== 1) return { ok: false, error: null };
  let delivered: Delivered;
  try {
    delivered = await deliver(messageId);
  } catch (e) {
    await db.message.update({ where: { id: messageId }, data: { status: "awaiting_approval" } });
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await db.message.update({ where: { id: messageId }, data: { status: "sent", sentAt: new Date(), decidedAt: new Date(), ...delivered } });
  return { ok: true };
}

// Messages that go out with no human click (prototype decision, confirmed in the Phase 0 review): templated, low risk.
// Step 8 scheduling messages (to the candidate and the client). Step 6 pre-screen questions need approval since
// 2026-10-08 (send screen).
// Like send(), never to a candidate who said no or asked to stop.
const NO_APPROVAL_KINDS = ["scheduling", "scheduling_client"];

export async function sendWithoutApproval(args: {
  jobId: string;
  candidateId: string;
  kind: string;
  toEmail: string;
  subject: string;
  body: string;
  footer: string | null; // opt-out line for candidates; null for messages to the client
  agentRunIds: string[];
  traceId: string | null;
}) {
  if (!NO_APPROVAL_KINDS.includes(args.kind)) throw new Error(`Messages of kind "${args.kind}" need approval before sending`);
  const entry = await db.pipelineEntry.findUnique({ where: { jobId_candidateId: { jobId: args.jobId, candidateId: args.candidateId } } });
  if (!entry || entry.stage === "declined") return null;
  const now = new Date();
  const msg = await db.message.create({
    data: { ...args, direction: "outbound", status: "sending", agentDraft: { subject: args.subject, body: args.body }, sentAt: now, decidedAt: now },
  });
  try {
    const delivered = await deliver(msg.id);
    return db.message.update({ where: { id: msg.id }, data: { status: "sent", ...delivered } });
  } catch (e) {
    // Gmail refused: kept as send_failed, with "Try again" in the approval queue. The flow goes on (as if sent).
    await db.approvalItem.create({
      data: {
        kind: "gmail_send_failed",
        step: args.kind === "prescreen" ? 6 : 8,
        status: "awaiting_approval",
        title: "Failed: Gmail send",
        detail: `“${args.subject}” to ${args.candidateId} wasn't sent: ${e instanceof Error ? e.message : String(e)}`,
        jobId: args.jobId,
        candidateId: args.candidateId,
      },
    });
    return db.message.update({ where: { id: msg.id }, data: { status: "send_failed" } });
  }
}

// "Try again" on a "Failed: Gmail send" item: re-sends that candidate's failed no-click emails, oldest first.
export async function retryGmailSend(itemId: string): Promise<{ ok: boolean; message: string }> {
  const item = await db.approvalItem.findUniqueOrThrow({ where: { id: itemId } });
  const failed = await db.message.findMany({ where: { jobId: item.jobId!, candidateId: item.candidateId!, status: "send_failed" }, orderBy: { createdAt: "asc" } });
  try {
    for (const m of failed) {
      const delivered = await deliver(m.id);
      await db.message.update({ where: { id: m.id }, data: { status: "sent", sentAt: new Date(), ...delivered } });
    }
  } catch (e) {
    return { ok: false, message: `Still failing: ${e instanceof Error ? e.message : String(e)}` };
  }
  await db.approvalItem.updateMany({ where: { kind: "gmail_send_failed", jobId: item.jobId, candidateId: item.candidateId, status: "awaiting_approval" }, data: { status: "approved", decidedAt: new Date() } });
  return { ok: true, message: `${failed.length} email(s) sent.` };
}

// Step 7: an approved submission goes to the client (mock_inbox.send_to_client). The ONLY way a submission leaves:
// it only works on a submission still awaiting approval (claimed atomically, so a double click sends once).
// The message is kept in the candidate's thread for this job, addressed to the client contact.
// Through Gmail when the client contact is allow-listed (specs/13); if Gmail refuses, the submission goes back to
// awaiting_approval and the error is returned.
export async function sendToClient(args: { submissionId: string; data: object; toEmail: string; subject: string; body: string }): Promise<Awaited<ReturnType<typeof db.message.create>> | { error: string } | null> {
  // Never "send" to nobody: a client with no email can't get a submission (2026-10-10).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.toEmail.trim())) return { error: "the client has no email address yet; add one on the Clients page" };
  const now = new Date();
  const { count } = await db.submission.updateMany({
    where: { id: args.submissionId, status: "awaiting_approval" },
    data: { status: "sent", data: args.data, decidedAt: now },
  });
  if (count !== 1) return null;
  const sub = await db.submission.findUniqueOrThrow({ where: { id: args.submissionId } });
  const created = await db.message.create({
    data: {
      jobId: sub.jobId,
      candidateId: sub.candidateId,
      direction: "outbound",
      kind: "submission",
      status: "sending",
      toEmail: args.toEmail,
      subject: args.subject,
      body: args.body,
      agentDraft: sub.agentDraft ?? undefined,
      agentRunIds: sub.agentRunIds ?? [],
      traceId: sub.traceId,
      sentAt: now,
      decidedAt: now,
    },
  });
  let msg: typeof created;
  try {
    msg = await db.message.update({ where: { id: created.id }, data: { status: "sent", ...(await deliver(created.id)) } });
  } catch (e) {
    await db.message.delete({ where: { id: created.id } });
    await db.submission.update({ where: { id: sub.id }, data: { status: "awaiting_approval", decidedAt: null } });
    return { error: e instanceof Error ? e.message : String(e) };
  }
  await db.submission.update({ where: { id: sub.id }, data: { messageId: msg.id } });
  return msg;
}

// A candidate's reply arrives: from Gmail (gmail ids set), or from an automated test.
export async function receive(args: { jobId: string; candidateId: string; body: string; receivedAt?: Date; gmailMessageId?: string; gmailThreadId?: string }) {
  const thread = await getThread(args.jobId, args.candidateId);
  const lastSent = thread.filter((m) => m.status === "sent" && !CLIENT_KINDS.includes(m.kind)).at(-1);
  return db.message.create({
    data: {
      jobId: args.jobId,
      candidateId: args.candidateId,
      direction: "inbound",
      kind: "inbound",
      status: "received",
      subject: lastSent ? `Re: ${lastSent.subject.replace(/^(Re:\s*)+/i, "")}` : "(reply)",
      body: args.body,
      sentAt: args.receivedAt ?? new Date(),
      gmailMessageId: args.gmailMessageId,
      gmailThreadId: args.gmailThreadId,
    },
  });
}

// Step 8: the client's reply about a candidate, read from Gmail (specs/13). Recorded in the candidate's thread for
// this job; intent "client_reply" so the candidate reply classifier never picks it up.
export async function receiveFromClient(args: { jobId: string; candidateId: string; subject: string; body: string; receivedAt?: Date; gmailMessageId?: string; gmailThreadId?: string }) {
  return db.message.create({
    data: {
      jobId: args.jobId,
      candidateId: args.candidateId,
      direction: "inbound",
      kind: "client",
      status: "received",
      intent: "client_reply",
      subject: args.subject,
      body: args.body,
      sentAt: args.receivedAt ?? new Date(),
      gmailMessageId: args.gmailMessageId,
      gmailThreadId: args.gmailThreadId,
    },
  });
}
