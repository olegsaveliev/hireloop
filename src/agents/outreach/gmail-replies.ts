// Replies from real Gmail. Looks at every Gmail thread the app started (no label needed):
// - a candidate thread (specs/12): each new message goes to receiveReply (classified, summarized or read by Step 8);
// - a client thread (specs/13: submission, Step 8 client emails): receiveClientReply (saved + AI hint + queue item).
// Each Gmail message is processed once (its id is stored on the inbound message, unique).
import { db } from "@/lib/db";
import type { RunOptions } from "../pipeline/workflow";
import { gmailTransport, realGmailAllowed } from "../tools/gmail";
import { getGoogleAccount, GoogleNotConnectedError } from "../tools/google-auth";
import { receiveClientReply } from "../client-reply/workflow";
import { receiveReply } from "./workflow";

// Our emails to the client (specs/13): replies in these threads come from the client, not the candidate.
const CLIENT_THREAD_KINDS = ["submission", "scheduling_client"];

// `jobIds`: jobs that got a candidate reply, so the caller can let the job's Steps 5-7 run continue (e.g. "proceed" -> Step 7).
export type RepliesResult = { threads: number; replies: number; notes: string[]; jobIds: string[] };

// `account` = the recruiter's address (their own messages in a thread are skipped). Tests pass it; the app reads it
// from the Google login.
export async function checkCandidateReplies(opts: { jobId?: string; account?: string; runOptions?: RunOptions } = {}): Promise<RepliesResult> {
  const account = (opts.account ?? (await getGoogleAccount())?.email ?? "").toLowerCase();
  if (!account) throw new GoogleNotConnectedError("Gmail is not connected. Click Connect Gmail on the Briefs page.");

  const threads = await db.message.findMany({
    where: { direction: "outbound", gmailThreadId: { not: null }, ...(opts.jobId ? { jobId: opts.jobId } : {}) },
    select: { jobId: true, candidateId: true, gmailThreadId: true, kind: true },
    distinct: ["gmailThreadId"],
  });
  const result: RepliesResult = { threads: threads.length, replies: 0, notes: [], jobIds: [] };
  if (!realGmailAllowed()) return result; // automated tests without a fake Gmail
  for (const t of threads) {
    const known = new Set(
      (await db.message.findMany({ where: { gmailThreadId: t.gmailThreadId }, select: { gmailMessageId: true } })).map((m) => m.gmailMessageId),
    );
    const emails = await gmailTransport.getThread(t.gmailThreadId!);
    for (const e of emails) {
      if (known.has(e.gmailMessageId) || e.fromEmail === account) continue;
      try {
        if (CLIENT_THREAD_KINDS.includes(t.kind)) {
          result.replies++;
          result.notes.push(`${t.candidateId}: ${await receiveClientReply(t.jobId, t.candidateId, e, opts.runOptions)} (see the approval queue).`);
          continue;
        }
        const r = await receiveReply(t.jobId, t.candidateId, e.body || "(no text in the email)", {
          ...opts.runOptions,
          receivedAt: e.receivedAt,
          gmailMessageId: e.gmailMessageId,
          gmailThreadId: e.gmailThreadId,
        });
        result.replies++;
        result.notes.push(`${t.candidateId}: ${r.message}`);
        if (r.ok && !result.jobIds.includes(t.jobId)) result.jobIds.push(t.jobId);
      } catch (err) {
        // Usually a parallel click that saved the same reply first (unique Gmail id). The next check retries anything else.
        result.notes.push(`${t.candidateId}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      }
    }
  }
  return result;
}

export const repliesSummary = (r: RepliesResult) =>
  r.replies
    ? `${r.replies} new repl${r.replies === 1 ? "y" : "ies"}: ${r.notes.join(" ")}`
    : r.threads
      ? `No new replies (${r.threads} conversation${r.threads === 1 ? "" : "s"} checked).`
      : "";
