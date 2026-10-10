// Gmail outreach tests (docs/specs/12-gmail-outreach.md "Test cases"), with a fake Gmail: sends are recorded in memory and
// threads are served from memory, so no Google login is needed and no real email goes out.
// Real runs: 2 Haiku reply classifications + 3 Sonnet pre-screen question runs (draft, redraft, re-draft after a
// reply), ~$0.05.
// Uses a throwaway job on cand-013 (profile already cached); everything it creates is deleted at the end.
// Run with: npm run test:gmail-outreach
import { config } from "dotenv";
config({ path: ".env.local" });

import type { JobSpecData } from "@/agents/job-spec/schema";
import { toTestInbox } from "@/lib/test-inbox";

const SPEC: JobSpecData = {
  title: "Senior React Developer",
  seniority: "senior",
  must_have: ["React", "TypeScript", "Next.js"],
  nice_to_have: ["GraphQL"],
  dealbreakers: [],
  location: ["Remote, EU"],
  rate_range: "around 50 EUR/h",
  selling_points: ["6 months", "Fully remote"],
  open_questions: [],
};
const CAND = "cand-013";
const ACCOUNT = "recruiter@test.local";
const TO = toTestInbox("test.inbox+13@example.com"); // cand-013's address in its profile

async function main() {
  process.env.GOOGLE_SEND_ALLOWLIST = "test.inbox@example.com";
  const { db } = await import("@/lib/db");
  const gmail = await import("@/agents/tools/gmail");
  const { isSendAllowed } = await import("@/config/google");
  const { approveDrafts, rejectDraft, receiveReply } = await import("@/agents/outreach/workflow");
  const { checkCandidateReplies } = await import("@/agents/outreach/gmail-replies");
  const { sendWithoutApproval, retryGmailSend } = await import("@/agents/tools/mock-inbox");
  const { ingestEmails } = await import("@/agents/inbound/workflow");
  type ParsedEmail = import("@/agents/tools/gmail").ParsedEmail;

  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
  };

  // ---------- fake Gmail ----------
  // threadId = what the app asked for (null for a new thread); gotThread = the thread it ended up in.
  const sent: (import("@/agents/tools/gmail").SendArgs & { id: string; gotThread: string })[] = [];
  const threads = new Map<string, ParsedEmail[]>();
  let failNext: string | null = null;
  let n = 0;
  gmail.gmailTransport.send = async (args) => {
    if (failNext) {
      const msg = failNext;
      failNext = null;
      throw new Error(msg);
    }
    const id = `fake-msg-${++n}`;
    const threadId = args.threadId ?? `fake-thread-${n}`;
    sent.push({ ...args, id, gotThread: threadId });
    const list = threads.get(threadId) ?? [];
    list.push({ gmailMessageId: id, gmailThreadId: threadId, fromName: "Recruiter", fromEmail: ACCOUNT, subject: args.subject, body: args.body, truncated: false, attachmentNames: [], receivedAt: new Date(Date.now() + n * 1000) });
    threads.set(threadId, list);
    return { gmailMessageId: id, gmailThreadId: threadId };
  };
  gmail.gmailTransport.fake = true;
  gmail.gmailTransport.getThread = async (threadId) => threads.get(threadId) ?? [];

  // ---------- free checks ----------
  console.log("\n--- Allow-list (no AI) ---");
  check("Allow-list: + variant allowed", isSendAllowed("test.inbox+39@example.com"));
  check("Allow-list: other address refused", !isSendAllowed("andriy.k@example.com") && !isSendAllowed("test.inbox@other.com"));

  // ---------- throwaway job ----------
  const brief = await db.clientBrief.create({ data: { id: `brief-test-${Date.now().toString(36)}`, clientId: "client-brightline", fromName: "Test", fromEmail: "t@test", subject: "[test] gmail outreach", body: "test", receivedAt: new Date(), source: "manual" } });
  const specRow = await db.jobSpec.create({ data: { briefId: brief.id, clientId: "client-brightline", status: "approved", agentDraft: SPEC, spec: SPEC, agentRunIds: [], decidedAt: new Date() } });
  const job = await db.job.create({ data: { jobSpecId: specRow.id, clientId: "client-brightline", title: `[test] ${SPEC.title}`, status: "outreach" } });
  const jobId = job.id;
  await db.pipelineEntry.create({ data: { jobId, candidateId: CAND, stage: "shortlisted", matchedOn: ["react"] } });
  const draft = (kind: string, subject: string, sequenceStep: number | null) =>
    db.message.create({ data: { jobId, candidateId: CAND, direction: "outbound", kind, sequenceStep, status: "awaiting_approval", toEmail: TO, subject, body: "Hi Olena,\n\nA React role for you.\n\nAnna", footer: "Not interested? Reply 'stop'.", agentDraft: { subject, body: "x" } } });
  const startedAt = new Date();
  let inboundEmailIds: string[] = [];

  try {
    console.log("\n--- Sending ---");
    const d1 = await draft("first", "Senior React role, remote EU", 1);
    const r1 = await approveDrafts([{ messageId: d1.id, subject: d1.subject, body: d1.body }]);
    const m1 = await db.message.findUniqueOrThrow({ where: { id: d1.id } });
    const stage = (await db.pipelineEntry.findUniqueOrThrow({ where: { jobId_candidateId: { jobId, candidateId: CAND } } })).stage;
    check("Approve sends one Gmail email to the candidate's own address, with the opt-out line", sent.length === 1 && sent[0].to === TO && sent[0].body.includes("Reply 'stop'") && !sent[0].threadId, r1.message);
    check("Message sent with Gmail ids and deliveredTo; candidate contacted", m1.status === "sent" && m1.gmailThreadId === "fake-thread-1" && m1.deliveredTo === TO && stage === "contacted");
    await approveDrafts([{ messageId: d1.id, subject: d1.subject, body: d1.body }]);
    check("Approving again sends nothing (claimed once)", sent.length === 1);

    const d2 = await draft("follow_up", "Following up", 2);
    await db.message.update({ where: { id: d2.id }, data: { toEmail: "olena@example.com" } });
    const r2a = await approveDrafts([{ messageId: d2.id, subject: d2.subject, body: d2.body }]);
    check("Address not on the allow-list: refused, draft stays waiting, nothing sent", !r2a.ok && r2a.message.includes("allow-list") && sent.length === 1 && (await db.message.findUniqueOrThrow({ where: { id: d2.id } })).status === "awaiting_approval", r2a.message);
    await db.message.update({ where: { id: d2.id }, data: { toEmail: TO } });
    failNext = "Gmail login expired";
    const r2 = await approveDrafts([{ messageId: d2.id, subject: d2.subject, body: d2.body }]);
    check("Gmail failure: draft stays waiting, error shown", !r2.ok && r2.message.includes("Gmail login expired") && (await db.message.findUniqueOrThrow({ where: { id: d2.id } })).status === "awaiting_approval", r2.message);
    const r2b = await approveDrafts([{ messageId: d2.id, subject: d2.subject, body: d2.body }]);
    check("Retry: follow-up goes into the same Gmail thread as 'Re: <first subject>'", r2b.ok && sent.length === 2 && sent[1].threadId === "fake-thread-1" && sent[1].subject === "Re: Senior React role, remote EU", sent[1].subject);

    console.log("\n--- No-click emails ---");
    const toClient = await sendWithoutApproval({ jobId, candidateId: CAND, kind: "scheduling_client", toEmail: "client@brightline.example", subject: "Times", body: "x", footer: null, agentRunIds: [], traceId: null });
    check("Client email stays mock only (not in Gmail)", sent.length === 2 && toClient?.status === "sent" && !toClient.gmailMessageId);
    failNext = "network down";
    const failed = await sendWithoutApproval({ jobId, candidateId: CAND, kind: "scheduling", toEmail: TO, subject: "Interview times", body: "x", footer: null, agentRunIds: [], traceId: null });
    const item = await db.approvalItem.findFirst({ where: { jobId, kind: "gmail_send_failed", status: "awaiting_approval" } });
    check("No-click Gmail failure: send_failed + 'Failed: Gmail send' item", failed?.status === "send_failed" && !!item, item?.detail ?? "");
    const retry = await retryGmailSend(item!.id);
    check("Try again sends it in the thread, item closed", retry.ok && (await db.message.findUniqueOrThrow({ where: { id: failed!.id } })).status === "sent" && sent.at(-1)?.threadId === "fake-thread-1" && (await db.approvalItem.findUniqueOrThrow({ where: { id: item!.id } })).status === "approved", retry.message);
    // Remove the scheduling test message so the reply below goes to the normal classifier (not Step 8).
    await db.message.deleteMany({ where: { id: { in: [failed!.id, toClient!.id] } } });

    console.log("\n--- Replies (Haiku classifier + Sonnet pre-screen, ~$0.02) ---");
    const thread = threads.get("fake-thread-1")!;
    thread.push({ gmailMessageId: "fake-own-note", gmailThreadId: "fake-thread-1", fromName: "Recruiter", fromEmail: ACCOUNT, subject: "Re: x", body: "a note I typed in Gmail myself", truncated: false, attachmentNames: [], receivedAt: new Date(Date.now() + 50_000) });
    thread.push({ gmailMessageId: "fake-reply-1", gmailThreadId: "fake-thread-1", fromName: "the test inbox", fromEmail: "test.inbox@example.com", subject: "Re: Senior React role, remote EU", body: "Hi Anna, yes, sounds interesting. Happy to talk this week.", truncated: false, attachmentNames: [], receivedAt: new Date(Date.now() + 60_000) });
    const before = sent.length;
    const rep = await checkCandidateReplies({ jobId, account: ACCOUNT, runOptions: { extraTags: ["test"] } });
    const inbound = await db.message.findFirst({ where: { jobId, direction: "inbound" } });
    check("Reply found in the thread (own note skipped), saved with its Gmail id", rep.replies === 1 && inbound?.gmailMessageId === "fake-reply-1", rep.notes.join(" "));
    check("Reply classified like a simulated reply", inbound?.intent === "interested", `${inbound?.intent}`);
    const preDraft = await db.message.findFirst({ where: { jobId, kind: "prescreen" } });
    check("Interested → pre-screen questions drafted, NOT sent (approval needed)", preDraft?.status === "awaiting_approval" && sent.length === before && (await db.prescreen.findFirst({ where: { jobId } }))?.status === "questions_draft", preDraft?.status ?? "none");

    console.log("    (rejecting the questions with a comment, Sonnet rewrites them ~$0.013)");
    const rej = await rejectDraft(preDraft!.id, "Ask about GraphQL experience too.", { extraTags: ["test"] });
    const pre2 = await db.message.findFirst({ where: { jobId, kind: "prescreen", status: "awaiting_approval" } });
    const preRow = await db.prescreen.findFirst({ where: { jobId } });
    check("Reject with a comment → new questions draft that follows it", rej.ok && !!pre2 && pre2.previousMessageId === preDraft!.id && /graphql/i.test(pre2.body) && preRow?.questionsMessageId === pre2.id, rej.message);
    await approveDrafts([{ messageId: pre2!.id, subject: pre2!.subject, body: pre2!.body }]);
    const pre = await db.message.findUniqueOrThrow({ where: { id: pre2!.id } });
    check("Approve → questions sent through Gmail in the same thread; pre-screen waits for answers", pre.status === "sent" && pre.gmailThreadId === "fake-thread-1" && sent.length === before + 1 && sent.at(-1)!.threadId === "fake-thread-1" && (await db.prescreen.findFirst({ where: { jobId } }))?.status === "questions_sent", pre.subject);
    const rep2 = await checkCandidateReplies({ jobId, account: ACCOUNT, runOptions: { extraTags: ["test"] } });
    check("Checking again: nothing new", rep2.replies === 0 && (await db.message.count({ where: { jobId, direction: "inbound" } })) === 1);

    console.log("\n--- A reply before the questions are sent ---");
    // Second candidate on the same job: questions drafted, then the candidate writes again before we send them.
    await db.pipelineEntry.create({ data: { jobId, candidateId: "cand-041", stage: "contacted", matchedOn: ["react"] } });
    await db.message.create({ data: { jobId, candidateId: "cand-041", direction: "outbound", kind: "first", status: "sent", toEmail: "x@example.com", subject: "React role", body: "Hi", sentAt: new Date() } });
    await receiveReply(jobId, "cand-041", "Yes, interested!", { extraTags: ["test"] });
    const firstQ = await db.message.findFirst({ where: { jobId, candidateId: "cand-041", kind: "prescreen" } });
    await receiveReply(jobId, "cand-041", "One more thing: I'd love to hear more, happy to answer any questions. Still very interested.", { receivedAt: new Date(Date.now() + 120_000), extraTags: ["test"] });
    const qs = await db.message.findMany({ where: { jobId, candidateId: "cand-041", kind: "prescreen" }, orderBy: { createdAt: "asc" } });
    check("Old questions draft cancelled; fresh draft written after the new reply", firstQ?.status === "awaiting_approval" && qs[0].status === "cancelled" && qs.at(-1)?.status === "awaiting_approval" && qs.length === 2, qs.map((q) => q.status).join(", "));

    console.log("\n--- Briefs ---");
    const tagged: ParsedEmail = { ...thread.at(-1)!, gmailMessageId: `fake-labelled-${Date.now()}` };
    const c = await ingestEmails([tagged], ACCOUNT, { extraTags: ["test"] });
    const e = await db.inboundEmail.findUniqueOrThrow({ where: { gmailMessageId: tagged.gmailMessageId } });
    inboundEmailIds = [e.id];
    check("A candidate thread with the Briefs label is not a brief (no classifier run)", c.ignored === 1 && e.status === "ignored" && !e.agentRunId, e.reason ?? "");

    const runs = await db.agentRun.findMany({ where: { createdAt: { gte: startedAt } } });
    console.log(`\nCost of this test run: ${runs.length} run(s), $${runs.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}`);
  } finally {
    await db.inboundEmail.deleteMany({ where: { id: { in: inboundEmailIds } } });
    await db.approvalItem.deleteMany({ where: { jobId } });
    await db.agentRun.updateMany({ where: { jobId }, data: { jobId: null } });
    await db.job.delete({ where: { id: jobId } }); // messages, pipeline, pre-screen go with it
    await db.jobSpec.delete({ where: { id: specRow.id } });
    await db.clientBrief.delete({ where: { id: brief.id } });
  }
  console.log(`\n${failures ? `${failures} FAILED` : "All checks passed"}.`);
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
