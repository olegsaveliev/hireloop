// Gmail client emails tests (docs/specs/13-gmail-client-emails.md "Test cases"), with a fake Gmail (no login, nothing sent).
// Real runs: 2 Haiku client-reply hints, 1 Haiku scheduling options email, ~$0.01.
// Throwaway job on cand-039 whose brief came from an allow-listed client contact; everything is deleted at the end.
// Run with: npm run test:gmail-client
import { config } from "dotenv";
config({ path: ".env.local" });

import type { JobSpecData } from "@/agents/job-spec/schema";
import { toTestInbox } from "@/lib/test-inbox";

const SPEC: JobSpecData = {
  title: "Senior React Developer",
  seniority: "senior",
  must_have: ["React", "TypeScript", "Next.js"],
  nice_to_have: [],
  dealbreakers: [],
  location: ["Remote, EU"],
  rate_range: "around 50 EUR/h",
  selling_points: [],
  open_questions: [],
};
const CAND = "cand-039";
const ACCOUNT = "recruiter@test.local";
const CONTACT = toTestInbox("test.inbox@example.com"); // the seeded client contact

async function main() {
  process.env.GOOGLE_SEND_ALLOWLIST = CONTACT;
  const { db } = await import("@/lib/db");
  const gmail = await import("@/agents/tools/gmail");
  const { approveSubmission } = await import("@/agents/submission/workflow");
  const { requestInterview, clientConfirms, createGoogleEventNow } = await import("@/agents/scheduling/workflow");
  const { checkCandidateReplies } = await import("@/agents/outreach/gmail-replies");
  const { sendWithoutApproval } = await import("@/agents/tools/mock-inbox");
  const { ingestEmails } = await import("@/agents/inbound/workflow");
  const { SUBMISSION_FORMAT } = await import("@/config/submission");
  type ParsedEmail = import("@/agents/tools/gmail").ParsedEmail;

  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
  };

  // ---------- fake Gmail ----------
  const sent: (import("@/agents/tools/gmail").SendArgs & { gotThread: string })[] = [];
  const threads = new Map<string, ParsedEmail[]>();
  let n = 0;
  const mail = (threadId: string, from: string, subject: string, body: string): ParsedEmail => ({
    gmailMessageId: `fake-c-${++n}`, gmailThreadId: threadId, fromName: from.split("@")[0], fromEmail: from, subject, body, truncated: false, attachmentNames: [], receivedAt: new Date(Date.now() + n * 60_000),
  });
  gmail.gmailTransport.send = async (args) => {
    const threadId = args.threadId ?? `fake-c-thread-${n + 1}`;
    const m = mail(threadId, ACCOUNT, args.subject, args.body);
    sent.push({ ...args, gotThread: threadId });
    threads.set(threadId, [...(threads.get(threadId) ?? []), m]);
    return { gmailMessageId: m.gmailMessageId, gmailThreadId: threadId };
  };
  gmail.gmailTransport.fake = true;
  gmail.gmailTransport.getThread = async (threadId) => threads.get(threadId) ?? [];
  // ---------- fake Google Calendar (specs/14) ----------
  const cal = await import("@/agents/tools/google-calendar");
  const events: (import("@/agents/tools/google-calendar").EventArgs & { id: string })[] = [];
  const deleted: string[] = [];
  let calFail: string | null = null;
  // The recruiter is busy for the next 2 days: no proposed time may fall in it.
  const busyUntil = new Date(Date.now() + 48 * 3600_000);
  cal.calendarTransport.fake = true;
  cal.calendarTransport.busyTimes = async () => [{ start: new Date(), end: busyUntil }];
  cal.calendarTransport.createEvent = async (a) => {
    if (calFail) throw new Error(calFail);
    const id = `fake-event-${events.length + 1}`;
    events.push({ ...a, id });
    return { eventId: id, htmlLink: `https://calendar.example/${id}`, meetLink: `https://meet.google.com/fake-${events.length}` };
  };
  cal.calendarTransport.deleteEvent = async (id) => {
    deleted.push(id);
  };
  const reply = (threadId: string, body: string) => threads.get(threadId)!.push(mail(threadId, CONTACT, "Re: x", body));

  // ---------- throwaway job: Mykola pre-screened, submission waiting for the account manager ----------
  const brief = await db.clientBrief.create({ data: { id: `brief-test-${Date.now().toString(36)}`, clientId: "client-brightline", fromName: "John Smith", fromEmail: CONTACT, subject: "[test] client emails", body: "test", receivedAt: new Date(), source: "manual" } });
  const specRow = await db.jobSpec.create({ data: { briefId: brief.id, clientId: "client-brightline", status: "approved", agentDraft: SPEC, spec: SPEC, agentRunIds: [], decidedAt: new Date() } });
  const job = await db.job.create({ data: { jobSpecId: specRow.id, clientId: "client-brightline", title: `[test] ${SPEC.title}`, status: "outreach" } });
  const jobId = job.id;
  await db.pipelineEntry.create({ data: { jobId, candidateId: CAND, stage: "prescreened", matchedOn: ["react"] } });
  await db.message.create({ data: { jobId, candidateId: CAND, direction: "outbound", kind: "first", status: "sent", toEmail: "mykola@mail.example", subject: "React role", body: "Hi Mykola", sentAt: new Date() } });
  const fields = { headline: "Senior React Developer", summary: "10 years of frontend.", key_skills: ["React", "TypeScript", "Next.js"], experience_highlights: ["Migrated pages to Next.js"], rate: "€55/hr", availability: "From 1 December" };
  const sub = await db.submission.create({
    data: { jobId, candidateId: CAND, clientId: "client-brightline", status: "awaiting_approval", anonymized: false, format: SUBMISSION_FORMAT, data: { ...fields, candidate_id: CAND, client_id: "client-brightline", anonymized: false, highlight_sources: [] }, agentDraft: { ...fields, candidate_id: CAND, client_id: "client-brightline", anonymized: false, highlight_sources: [] } },
  });
  const startedAt = new Date();

  try {
    console.log("\n--- Step 7: submission through Gmail ---");
    const a = await approveSubmission(sub.id, fields);
    const subMsg = await db.message.findFirst({ where: { jobId, kind: "submission" } });
    check("Approve & send → Gmail, to the client contact itself, new thread", a.ok && sent.length === 1 && sent[0].to === CONTACT && !sent[0].threadId && subMsg?.status === "sent" && !!subMsg.gmailThreadId, a.message);
    const clientThread = subMsg!.gmailThreadId!;

    console.log("\n--- Client reply → AI hint (Haiku) ---");
    reply(clientThread, "Thanks John here. Mykola looks strong, can we talk to him next week?");
    const r1 = await checkCandidateReplies({ jobId, account: ACCOUNT, runOptions: { extraTags: ["test"] } });
    const cr = await db.message.findFirst({ where: { jobId, kind: "client", direction: "inbound" } });
    const item = await db.approvalItem.findFirst({ where: { jobId, kind: "client_replied", status: "awaiting_approval" } });
    const hint = cr?.classification as { suggestion?: string } | null;
    check("Client reply saved (from Gmail), not sent to the candidate classifier", r1.replies === 1 && !!cr?.gmailMessageId && cr.intent === "client_reply", r1.notes.join(" "));
    check("AI hint: wants_interview; 'Client replied' item in the queue", hint?.suggestion === "wants_interview" && !!item?.detail?.includes("AI hint"), item?.detail ?? "none");
    const r1b = await checkCandidateReplies({ jobId, account: ACCOUNT, runOptions: { extraTags: ["test"] } });
    check("Checking again: processed once", r1b.replies === 0);

    console.log("\n--- Button: Client wants interview (Haiku options email) ---");
    const ri = await requestInterview(sub.id, { extraTags: ["test"] });
    const clientMsgs = await db.message.count({ where: { jobId, kind: "client" } });
    check("Button records the decision: no simulated client reply, item closed", ri.ok && clientMsgs === 1 && !(await db.approvalItem.findFirst({ where: { jobId, kind: "client_replied", status: "awaiting_approval" } })), ri.message);
    check("hint_followed scored once (marked on the reply)", !!((await db.message.findUniqueOrThrow({ where: { id: cr!.id } })).classification as { scored?: boolean }).scored);

    console.log("\n--- Step 8: client email in the same thread ---");
    const ivDraft = await db.interview.findUniqueOrThrow({ where: { jobId_candidateId: { jobId, candidateId: CAND } } });
    const timesDraft = await db.message.findFirst({ where: { jobId, kind: "scheduling", status: "awaiting_approval" } });
    const sentBefore = sent.length;
    check("Interview times drafted, not sent (approval needed)", ivDraft.status === "times_draft" && !!timesDraft && sent.length === sentBefore, ivDraft.status);
    check("Proposed times avoid the recruiter's busy hours (Google free/busy)", (ivDraft.proposedSlots as string[]).every((x) => new Date(x) >= busyUntil) && (timesDraft!.agentDraft as { calendarChecked?: boolean }).calendarChecked === true, (ivDraft.proposedSlots as string[]).join(", "));
    // The recruiter moves the first time one hour later (client asked for later), then sends.
    const { approveInterviewTimes } = await import("@/agents/scheduling/workflow");
    const { withinWorkingHours } = await import("@/lib/timezones");
    const drafted = (ivDraft.proposedSlots as string[]).map((x) => new Date(x));
    const later = new Date(drafted[0].getTime() + 3600_000);
    const edited = [withinWorkingHours(later, ivDraft.candidateTz!) && withinWorkingHours(later, ivDraft.clientTz) ? later : drafted[0], ...drafted.slice(1)].map((x) => x.toISOString());
    const bad = await approveInterviewTimes(ivDraft.id, { subject: timesDraft!.subject, body: timesDraft!.body, slots: ["2026-10-12T02:00:00.000Z"] });
    check("A time outside working hours is refused", !bad.ok && /Outside 09:00-19:00/.test(bad.message), bad.message);
    const ok = await approveInterviewTimes(ivDraft.id, { subject: timesDraft!.subject, body: timesDraft!.body, slots: edited });
    const iv = await db.interview.findUniqueOrThrow({ where: { id: ivDraft.id } });
    check("Approve with an edited time → sent through Gmail; the interview uses the edited times", ok.ok && iv.status === "proposed" && JSON.stringify(iv.proposedSlots) === JSON.stringify([...edited].sort()) && sent.length === sentBefore + 1 && !sent.at(-1)!.body.includes("{{slots}}"), ok.message);
    const slot = new Date((iv.proposedSlots as string[])[0]);
    await db.interview.update({ where: { id: iv.id }, data: { status: "awaiting_client", chosenSlot: slot } });
    await sendWithoutApproval({ jobId, candidateId: CAND, kind: "scheduling_client", toEmail: CONTACT, subject: "Interview: Mykola", body: "Can you confirm this time?", footer: null, agentRunIds: [], traceId: null });
    const ask = await db.message.findFirst({ where: { jobId, kind: "scheduling_client" }, orderBy: { createdAt: "desc" } });
    check("'Please confirm' goes to the client in the submission's thread, as Re: <submission subject>", ask?.gmailThreadId === clientThread && sent.at(-1)?.threadId === clientThread && sent.at(-1)!.subject.startsWith("Re: Candidate for"), sent.at(-1)?.subject);

    reply(clientThread, "Yes, that time works for us. See you then.");
    await checkCandidateReplies({ jobId, account: ACCOUNT, runOptions: { extraTags: ["test"] } });
    const cr2 = await db.message.findFirst({ where: { jobId, kind: "client", direction: "inbound" }, orderBy: { sentAt: "desc" } });
    check("AI hint after a picked time: confirms_time", (cr2?.classification as { suggestion?: string } | null)?.suggestion === "confirms_time" && cr2?.id !== cr?.id, JSON.stringify(cr2?.classification));
    calFail = "Google said no";
    const conf = await clientConfirms(iv.id);
    check("Client confirms: booked, no simulated reply, item closed", conf.ok && (await db.message.count({ where: { jobId, kind: "client" } })) === 2 && !(await db.approvalItem.findFirst({ where: { jobId, kind: "client_replied", status: "awaiting_approval" } })), conf.message);
    const failItem = await db.approvalItem.findFirst({ where: { jobId, kind: "google_event_failed", status: "awaiting_approval" } });
    check("Google Calendar failure: booking stands, 'event not created' item", !!failItem && (await db.interview.findUniqueOrThrow({ where: { id: iv.id } })).status === "confirmed" && !events.length, failItem?.detail ?? "none");
    calFail = null;
    const again = await createGoogleEventNow(iv.id);
    const ivEv = await db.interview.findUniqueOrThrow({ where: { id: iv.id } });
    check("Try again → event with Meet link; guests = candidate + allow-listed client; item closed", again.ok && events.length === 1 && JSON.stringify(events[0].guests) === JSON.stringify([toTestInbox("test.inbox+39@example.com"), CONTACT]) && !!ivEv.meetLink && (await db.approvalItem.findUniqueOrThrow({ where: { id: failItem!.id } })).status === "approved", again.message);
    check("Event title names the candidate and the job; 60 minutes at the confirmed time", /Interview: Mykola Ostapenko · \[test\] Senior React Developer/.test(events[0].summary) && events[0].start.getTime() === ivEv.confirmedSlot!.getTime() && events[0].end.getTime() - events[0].start.getTime() === 3600_000, events[0].summary);
    check("Create twice: refused", !(await createGoogleEventNow(iv.id)).ok);

    // A normal confirm with Google working: Meet link in both confirmation emails.
    await db.interview.update({ where: { id: iv.id }, data: { status: "awaiting_client", confirmedSlot: null, googleEventId: null, meetLink: null, googleEventLink: null, calendarEventIds: [] } });
    await db.calendarEvent.deleteMany({ where: { interviewId: iv.id } });
    await db.message.create({ data: { jobId, candidateId: CAND, direction: "inbound", kind: "client", status: "received", intent: "client_reply", subject: "Re", body: "ok", sentAt: new Date() } });
    const conf2 = await clientConfirms(iv.id);
    const confMsgs = (await db.message.findMany({ where: { jobId, kind: { in: ["scheduling", "scheduling_client"] } }, orderBy: { createdAt: "desc" }, take: 2 }));
    check("Confirmations to both sides include the Meet link", conf2.ok && events.length === 2 && confMsgs.length === 2 && confMsgs.every((m) => m.body.includes("https://meet.google.com/fake-2")), conf2.message);

    // Fictional client contact: not invited.
    const ev2 = events[1].id;
    await db.interview.update({ where: { id: iv.id }, data: { googleEventId: null, clientEmail: "dana@brightline-payments.example" } });
    await createGoogleEventNow(iv.id);
    check("Fictional client address: not invited (only the candidate)", JSON.stringify(events[2]?.guests) === JSON.stringify([toTestInbox("test.inbox+39@example.com")]), JSON.stringify(events[2]?.guests));

    // Final outcome "withdrew" cancels the interview and its Google event.
    const { recordOutcome } = await import("@/agents/feedback/outcomes");
    const out = await recordOutcome(jobId, CAND, "withdrew", "Accepted another offer before the interview");
    check("No dataset correction from this test job (nothing pushed to Langfuse)", !(await db.datasetCorrection.count({ where: { jobId } })), `${await db.datasetCorrection.count({ where: { jobId } })}`);
    check("Withdrew → interview cancelled and the app's Google event deleted (guests notified)", out.ok && deleted.includes(events[2].id) && !deleted.includes(ev2) && (await db.interview.findUniqueOrThrow({ where: { id: iv.id } })).status === "cancelled", out.message);

    console.log("\n--- Fictional client contact, briefs ---");
    const before = sent.length;
    const mock = await sendWithoutApproval({ jobId, candidateId: CAND, kind: "scheduling_client", toEmail: "dana@brightline-payments.example", subject: "x", body: "x", footer: null, agentRunIds: [], traceId: null });
    check("Fictional client address: mock only, not refused, not redirected", mock?.status === "sent" && !mock.gmailMessageId && sent.length === before);
    const tagged = { ...threads.get(clientThread)!.at(-1)!, gmailMessageId: `fake-labelled-${Date.now()}` };
    const c = await ingestEmails([tagged], ACCOUNT, { extraTags: ["test"] });
    const e = await db.inboundEmail.findUniqueOrThrow({ where: { gmailMessageId: tagged.gmailMessageId } });
    check("A client thread with the Briefs label is not a brief", c.ignored === 1 && !e.agentRunId);
    await db.inboundEmail.delete({ where: { id: e.id } });

    const runs = await db.agentRun.findMany({ where: { createdAt: { gte: startedAt } } });
    console.log(`\nCost of this test run: ${runs.length} run(s), $${runs.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}`);
  } finally {
    const ivs = await db.interview.findMany({ where: { jobId }, select: { id: true } });
    await db.calendarEvent.deleteMany({ where: { interviewId: { in: ivs.map((x) => x.id) } } });
    await db.approvalItem.deleteMany({ where: { jobId } });
    await db.datasetCorrection.deleteMany({ where: { jobId } });
    await db.agentRun.updateMany({ where: { jobId }, data: { jobId: null } });
    await db.job.delete({ where: { id: jobId } });
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
