// Gmail inbound (docs/specs/11-gmail-inbound.md): emails under label `Briefs` -> client briefs.
// Each email is saved once in inbound_emails (status = where it is), so "Check inbox" can run any number of times and
// every decision is a database status (approval queue), never in-memory state.
import { randomUUID } from "node:crypto";
import { FREEBUSY_SCOPE, INBOUND_MAX_BODY_CHARS, INBOUND_MAX_PER_CHECK } from "@/config/google";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import type { WorkflowResult } from "../job-spec/workflow";
import { rejectSpec } from "../job-spec/workflow";
import { getTelemetry, flushTelemetry } from "../telemetry";
import { listNewBriefEmails, type ParsedEmail } from "../tools/gmail";
import { getGoogleAccount } from "../tools/google-auth";
import { checkCandidateReplies, repliesSummary } from "../outreach/gmail-replies";
import { runInboundClassifier } from "./agent";
import type { InboundStatus } from "./schema";

const STEP = 1;
type Inbound = Awaited<ReturnType<typeof db.inboundEmail.findUniqueOrThrow>>;
type Outcome = InboundStatus | "skipped";

// ---------- Check inbox ----------

// Briefs under the label, then candidates' replies in the threads the app started (docs/specs/12-gmail-outreach.md).
export async function checkInbox(): Promise<WorkflowResult & { jobIds: string[] }> {
  const { emails, more, account } = await listNewBriefEmails(INBOUND_MAX_PER_CHECK, async (ids) => {
    const seen = await db.inboundEmail.findMany({ where: { gmailMessageId: { in: ids } }, select: { gmailMessageId: true } });
    return new Set(seen.map((s) => s.gmailMessageId));
  });
  const briefs = emails.length
    ? summary(await ingestEmails(emails, account)) + (more ? ` ${more} more waiting: click Check inbox again.` : "")
    : "No new briefs.";
  const r = await checkCandidateReplies({ account });
  return { ok: true, message: [briefs, repliesSummary(r)].filter(Boolean).join(" "), jobIds: r.jobIds };
}

function summary(counts: Record<Outcome, number>) {
  const total = Object.entries(counts).filter(([k]) => k !== "skipped").reduce((n, [, v]) => n + v, 0);
  const parts = [
    counts.brief && `${counts.brief} new brief${counts.brief > 1 ? "s" : ""}`,
    counts.update && `${counts.update} client update${counts.update > 1 ? "s" : ""}`,
    counts.waiting_sender && `${counts.waiting_sender} from an unknown sender (see To do)`,
    counts.ignored && `${counts.ignored} not a brief (see Not briefs)`,
    counts.failed && `${counts.failed} failed (see Approval queue)`,
  ].filter(Boolean);
  return `${total} new email${total === 1 ? "" : "s"}: ${parts.join(", ") || "nothing to do"}.`;
}

// Saves and processes emails, oldest first. Also used by tests with hand-made emails (no Gmail).
// `account` = the recruiter's own address (their replies inside a brief thread are skipped).
export async function ingestEmails(emails: ParsedEmail[], account: string, opts: { extraTags?: string[] } = {}): Promise<Record<Outcome, number>> {
  const counts: Record<Outcome, number> = { new: 0, brief: 0, update: 0, ignored: 0, waiting_sender: 0, not_client: 0, failed: 0, deleted: 0, cleared: 0, skipped: 0 };
  for (const e of [...emails].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())) {
    const saved = await saveEmail(e);
    if (!saved) {
      counts.skipped++;
      continue;
    }
    counts[await route(saved, account.toLowerCase(), opts.extraTags)]++;
  }
  return counts;
}

// null = already seen (Gmail message id is unique).
async function saveEmail(e: ParsedEmail): Promise<Inbound | null> {
  if (await db.inboundEmail.findUnique({ where: { gmailMessageId: e.gmailMessageId } })) return null;
  const body = e.truncated ? `${e.body}\n\n[Email was longer; cut at ${INBOUND_MAX_BODY_CHARS.toLocaleString("en")} characters.]` : e.body;
  try {
    return await db.inboundEmail.create({
      data: {
        gmailMessageId: e.gmailMessageId,
        gmailThreadId: e.gmailThreadId,
        fromName: e.fromName,
        fromEmail: e.fromEmail.toLowerCase(),
        subject: e.subject,
        body,
        attachmentNames: e.attachmentNames,
        receivedAt: e.receivedAt,
        status: "new",
      },
    });
  } catch {
    return null; // a parallel click saved it first
  }
}

const setStatus = (id: string, status: InboundStatus, data: { reason?: string | null; briefId?: string | null } = {}) =>
  db.inboundEmail.update({ where: { id }, data: { status, ...data } });

export const DECLINED_THREAD_REASON = "Same thread as a brief you declined.";

// The rules from the spec, in order.
async function route(email: Inbound, account: string, extraTags?: string[]): Promise<Outcome> {
  // A conversation with a candidate (Step 5 v2) is never a brief, even if it carries the Briefs label.
  if (await db.message.findFirst({ where: { gmailThreadId: email.gmailThreadId }, select: { id: true } })) {
    await setStatus(email.id, "ignored", { reason: "A conversation with a candidate (replies are read by Check inbox / Check replies)." });
    return "ignored";
  }
  // Same thread as an existing brief: a client update (code rule, no AI). The recruiter's own replies are skipped.
  const brief = await db.clientBrief.findFirst({ where: { gmailThreadId: email.gmailThreadId } });
  if (brief) {
    if (email.fromEmail === account) {
      await setStatus(email.id, "ignored", { reason: "Your own reply in a brief's thread.", briefId: brief.id });
      return "ignored";
    }
    await appendUpdate(brief.id, email);
    return "update";
  }
  // The thread's brief was declined / deleted: later emails in it go to Not briefs (code rule, no AI; "This is a brief" still works).
  if (await db.inboundEmail.findFirst({ where: { gmailThreadId: email.gmailThreadId, status: "deleted" }, select: { id: true } })) {
    await setStatus(email.id, "ignored", { reason: DECLINED_THREAD_REASON });
    return "ignored";
  }
  // The thread's first email is waiting for the recruiter to decide who the sender is: wait with it.
  const waiting = await db.inboundEmail.findFirst({ where: { gmailThreadId: email.gmailThreadId, status: "waiting_sender", id: { not: email.id } } });
  if (waiting) {
    await setStatus(email.id, "waiting_sender", { reason: "Same thread as an email from a sender you haven't linked yet." });
    return "waiting_sender";
  }
  return classifyAndRoute(email, extraTags);
}

async function classifyAndRoute(email: Inbound, extraTags?: string[]): Promise<Outcome> {
  const contact = await db.clientContact.findUnique({ where: { email: email.fromEmail } });
  const { data, runs, error } = await runInboundClassifier(
    { ...email, attachmentNames: email.attachmentNames as string[] },
    { clientId: contact?.clientId, metadata: { gmail_message_id: email.gmailMessageId, gmail_thread_id: email.gmailThreadId }, extraTags },
  );
  const last = runs[runs.length - 1];
  await db.inboundEmail.update({ where: { id: email.id }, data: { agentRunId: last?.runId, traceId: last?.traceId } });
  if (!data) {
    const stopped = runs.some((r) => r.status === "stopped_over_budget");
    await setStatus(email.id, "failed", { reason: error });
    await db.approvalItem.create({
      data: {
        kind: stopped ? "stopped_run" : "failed_run",
        step: STEP,
        status: "awaiting_approval",
        title: stopped ? "Stopped: over budget" : "Failed: couldn't sort an email",
        detail: `Email “${email.subject}” from ${email.fromEmail}. ${stopped ? "The run went above 3x its budget; nothing was saved." : (error ?? "")}`.trim(),
        clientId: contact?.clientId,
        inboundEmailId: email.id,
        agentRunId: last?.runId,
      },
    });
    return "failed";
  }
  if (data.kind === "not_brief") {
    await setStatus(email.id, "ignored", { reason: data.reason });
    return "ignored";
  }
  await db.inboundEmail.update({ where: { id: email.id }, data: { reason: data.reason } });
  return routeBrief(email);
}

// A brief: known sender -> brief for their client; unknown -> waits at the top of the Briefs page ("Which client is
// this?"). Not an approval-queue item: it's inbox sorting, not approving AI work (changed after the first walkthrough).
async function routeBrief(email: Inbound): Promise<Outcome> {
  const contact = await db.clientContact.findUnique({ where: { email: email.fromEmail } });
  if (contact) {
    await createBrief(email, contact.clientId);
    return "brief";
  }
  await setStatus(email.id, "waiting_sender");
  return "waiting_sender";
}

async function createBrief(email: Inbound, clientId: string) {
  const brief = await db.clientBrief.create({
    data: {
      id: `brief-${randomUUID().slice(0, 8)}`,
      clientId,
      fromName: email.fromName,
      fromEmail: email.fromEmail,
      subject: email.subject,
      body: email.body,
      receivedAt: email.receivedAt,
      source: "gmail",
      gmailThreadId: email.gmailThreadId,
      gmailMessageId: email.gmailMessageId,
      attachmentNames: email.attachmentNames as string[],
    },
  });
  await setStatus(email.id, "brief", { briefId: brief.id });
  return brief;
}

// A later email in a brief's thread: appended to the brief. If the brief already has a spec, the recruiter decides.
async function appendUpdate(briefId: string, email: Inbound) {
  const brief = await db.clientBrief.findUniqueOrThrow({ where: { id: briefId } });
  const attachments = [...new Set([...((brief.attachmentNames as string[] | null) ?? []), ...(email.attachmentNames as string[])])];
  await db.clientBrief.update({
    where: { id: briefId },
    data: {
      body: `${brief.body}\n\n--- Update from ${email.fromName} <${email.fromEmail}>, ${dateTime(email.receivedAt)} ---\n${email.body}`,
      updateCount: { increment: 1 },
      attachmentNames: attachments,
    },
  });
  await setStatus(email.id, "update", { briefId, reason: "Same thread as an existing brief." });

  const specs = await db.jobSpec.findMany({ where: { briefId, status: { in: ["awaiting_approval", "approved"] } } });
  if (!specs.length) return;
  const waiting = specs.filter((s) => s.status === "awaiting_approval");
  const titles = specs.map((s) => (s.spec as { title: string }).title).join(", ");
  await db.approvalItem.create({
    data: {
      kind: "client_update",
      step: STEP,
      status: "awaiting_approval",
      title: `Client update: ${brief.subject}`,
      detail:
        `${email.fromName}: “${email.body.slice(0, 280)}${email.body.length > 280 ? "…" : ""}”` +
        (waiting.length ? ` Spec waiting for approval: ${titles}.` : ` Spec already approved: ${titles}. Change it from the job's shortlist screen (Edit spec and re-source) if needed.`),
      clientId: brief.clientId,
      briefId,
      jobSpecId: (waiting[0] ?? specs[0]).id,
      inboundEmailId: email.id,
    },
  });
}

// ---------- approval queue decisions ----------

async function loadItem(itemId: string, kind: string) {
  const item = await db.approvalItem.findUniqueOrThrow({ where: { id: itemId } });
  if (item.kind !== kind) throw new Error(`Not a ${kind} item.`);
  if (item.status !== "awaiting_approval") throw new Error(`This item is already ${item.status}.`);
  if (!item.inboundEmailId) throw new Error("This item has no email.");
  const email = await db.inboundEmail.findUniqueOrThrow({ where: { id: item.inboundEmailId } });
  return { item, email };
}

// An email waiting for "Which client is this?" on the Briefs page.
async function loadWaiting(inboundId: string) {
  const email = await db.inboundEmail.findUniqueOrThrow({ where: { id: inboundId } });
  if (email.status !== "waiting_sender") throw new Error(`This email is already ${email.status.replace("_", " ")}.`);
  return email;
}

const closeItem = (itemId: string, status: "approved" | "rejected" | "dismissed", clientId?: string) =>
  db.approvalItem.update({ where: { id: itemId }, data: { status, decidedAt: new Date(), ...(clientId ? { clientId } : {}) } });

// Every email from this sender that was waiting: new threads become briefs, later ones in a thread become updates.
async function releaseWaiting(fromEmail: string, clientId: string): Promise<number> {
  const waiting = await db.inboundEmail.findMany({ where: { fromEmail, status: "waiting_sender" }, orderBy: { receivedAt: "asc" } });
  // Emails from other senders waiting in this sender's threads (e.g. a colleague cc'd) follow the thread.
  const threads = [...new Set(waiting.map((w) => w.gmailThreadId))];
  const inThreads = await db.inboundEmail.findMany({ where: { gmailThreadId: { in: threads }, status: "waiting_sender", fromEmail: { not: fromEmail } } });
  let briefs = 0;
  for (const e of [...waiting, ...inThreads].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())) {
    const brief = await db.clientBrief.findFirst({ where: { gmailThreadId: e.gmailThreadId } });
    if (brief) await appendUpdate(brief.id, e);
    else {
      await createBrief(e, clientId);
      briefs++;
    }
  }
  return briefs;
}

// "Which client is this?" -> an existing client.
export async function linkSender(inboundId: string, clientId: string): Promise<WorkflowResult> {
  const email = await loadWaiting(inboundId);
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) return { ok: false, message: "Choose a client." };
  await db.clientContact.upsert({ where: { email: email.fromEmail }, create: { email: email.fromEmail, clientId, name: email.fromName }, update: { clientId, name: email.fromName } });
  const n = await releaseWaiting(email.fromEmail, clientId);
  return { ok: true, message: `${email.fromEmail} linked to ${client.name}. ${n} brief${n === 1 ? "" : "s"} added to the inbox; their next emails go straight to ${client.name}.` };
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "client";

// "Which client is this?" -> a new client.
export async function createClientForSender(inboundId: string, input: { name: string; country: string; timezone: string }): Promise<WorkflowResult> {
  const problem = checkNewClient(input);
  if (problem) return { ok: false, message: problem };
  await loadWaiting(inboundId);
  return linkSender(inboundId, await createClient(input));
}

// A new client's name, country and time zone: the problem to show, or null if they're fine.
export function checkNewClient(input: { name: string; country: string; timezone: string }): string | null {
  if (!input.name.trim() || !input.country.trim()) return "Add the client's name and country.";
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    return "Choose a time zone.";
  }
  return null;
}

// A client's email (where submissions go, 2026-10-10): the problem to show, or null if it's fine to save.
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function checkClientEmail(email: string, clientId?: string): Promise<string | null> {
  if (!email) return "Add the client's email: submissions are sent there.";
  if (!EMAIL.test(email)) return "That email doesn't look right.";
  const taken = await db.clientContact.findUnique({ where: { email }, include: { client: { select: { name: true } } } });
  if (taken && taken.clientId !== clientId) return `${email} already belongs to ${taken.client.name}.`;
  return null;
}

// Clients page "Edit email": sets the client's email (its first contact), keeping its place as the first one.
export async function setClientEmail(clientId: string, input: { email: string; name: string }): Promise<WorkflowResult> {
  const email = input.email.trim().toLowerCase();
  const problem = await checkClientEmail(email, clientId);
  if (problem) return { ok: false, message: problem };
  const first = await db.clientContact.findFirst({ where: { clientId }, orderBy: { createdAt: "asc" } });
  const name = input.name.trim() || null;
  await db.$transaction([
    db.clientContact.deleteMany({ where: { email: { in: [email, ...(first ? [first.email] : [])] } } }),
    db.clientContact.create({ data: { email, clientId, name, createdAt: first?.createdAt } }),
  ]);
  return { ok: true, message: `Saved. Submissions now go to ${email}.` };
}

// Saves a new client (checked with checkNewClient first) and returns its id, e.g. "client-haldor-mobility".
export async function createClient(input: { name: string; country: string; timezone: string }): Promise<string> {
  const name = input.name.trim();
  let id = `client-${slug(name)}`;
  while (await db.client.findUnique({ where: { id } })) id = `client-${slug(name)}-${randomUUID().slice(0, 4)}`;
  await db.client.create({ data: { id, name, country: input.country.trim(), timezone: input.timezone } });
  return id;
}

// What hangs off a client, for the Clients page. Briefs or jobs (with their specs, submissions, interviews) keep it.
export async function clientUsage(clientId: string) {
  const [briefs, jobs, senders, pastJobs] = await Promise.all([
    db.clientBrief.count({ where: { clientId } }),
    db.job.count({ where: { clientId } }),
    db.clientContact.count({ where: { clientId } }),
    db.pastJob.count({ where: { clientId } }),
  ]);
  return { briefs, jobs, senders, pastJobs };
}

// The bin on the Clients page: only for a client with no briefs and no jobs. Its known senders and past jobs go with it
// (a sender's next email then asks "Which client is this?" again).
export async function deleteClient(clientId: string): Promise<WorkflowResult> {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) return { ok: false, message: "This client is already gone." };
  const used = await clientUsage(clientId);
  const specs = await db.jobSpec.count({ where: { clientId } });
  if (used.briefs || used.jobs || specs) return { ok: false, message: `${client.name} still has briefs or jobs. Move or delete its briefs first.` };
  await db.$transaction([
    db.clientContact.deleteMany({ where: { clientId } }),
    db.pastJob.deleteMany({ where: { clientId } }),
    db.client.delete({ where: { id: clientId } }),
  ]);
  return { ok: true, message: `${client.name} deleted.` };
}

// "Not a client": the sender's waiting emails are set aside. A later brief from them asks again.
export async function markNotClient(inboundId: string): Promise<WorkflowResult> {
  const email = await loadWaiting(inboundId);
  const { count } = await db.inboundEmail.updateMany({ where: { fromEmail: email.fromEmail, status: "waiting_sender" }, data: { status: "not_client" } });
  return { ok: true, message: `${count} email${count === 1 ? "" : "s"} from ${email.fromEmail} set aside (not a client).` };
}

// "Clear" on the Not briefs tab (one email, or all of them): the text is erased and the email leaves the page. The row
// stays with its Gmail message id, so "Check Gmail" doesn't import (and pay to sort) it again. Can't be undone.
export async function clearNotBriefs(inboundId?: string): Promise<WorkflowResult> {
  const { count } = await db.inboundEmail.updateMany({
    where: { status: { in: ["ignored", "not_client"] }, ...(inboundId ? { id: inboundId } : {}) },
    data: { status: "cleared", body: "", attachmentNames: [] },
  });
  return { ok: true, message: `${count} email${count === 1 ? "" : "s"} cleared.` };
}

// "This is a brief" on an ignored email: the classifier was wrong.
export async function markAsBrief(inboundId: string): Promise<WorkflowResult> {
  const email = await db.inboundEmail.findUniqueOrThrow({ where: { id: inboundId } });
  if (email.status !== "ignored" && email.status !== "not_client") return { ok: false, message: `This email is already ${email.status}.` };
  const wasClassifier = email.status === "ignored" && !!email.traceId;
  await db.inboundEmail.update({ where: { id: inboundId }, data: { classifierWrong: wasClassifier, reason: `${email.reason ?? ""} (recruiter: this is a brief)`.trim() } });
  if (wasClassifier) {
    const { langfuse } = getTelemetry();
    langfuse.score.create({ traceId: email.traceId!, name: "classifier_correct", value: 0, comment: "Recruiter clicked This is a brief" });
    await flushTelemetry();
  }
  const outcome = await routeBrief(email);
  return outcome === "brief"
    ? { ok: true, message: "Added to the inbox as a brief." }
    : { ok: true, message: "Unknown sender: choose the client at the top of the Briefs page." };
}

// "Change client" on a brief, until a spec is created (the spec is built from the client's past jobs and rates).
// A Gmail brief's sender moves too, so their next emails go to the new client.
export async function changeBriefClient(briefId: string, clientId: string): Promise<WorkflowResult> {
  const brief = await db.clientBrief.findUniqueOrThrow({ where: { id: briefId }, include: { jobSpecs: { select: { id: true } } } });
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) return { ok: false, message: "Choose a client." };
  if (brief.clientId === clientId) return { ok: true, message: `Already ${client.name}${client.name.endsWith(".") ? "" : "."}` };
  if (brief.jobSpecs.length) return { ok: false, message: "This brief already has a spec, so its client can't change. Reject the spec, or add the brief again." };
  await db.clientBrief.update({ where: { id: briefId }, data: { clientId } });
  let sender = "";
  if (brief.source === "gmail" && brief.fromEmail) {
    await db.clientContact.upsert({ where: { email: brief.fromEmail }, create: { email: brief.fromEmail, clientId, name: brief.fromName }, update: { clientId } });
    sender = ` ${brief.fromEmail}'s next emails also go to ${client.name}.`;
  }
  // No double dot for names like "Kestrel Health B.V.".
  return { ok: true, message: `Client changed to ${client.name}${client.name.endsWith(".") ? "" : "."}${sender}` };
}

// "+ New client…" in Change client: checks the new client and the brief first (no spec yet), then adds the client and
// moves the brief (and a Gmail sender) to it, as changeBriefClient.
export async function changeBriefToNewClient(briefId: string, input: { name: string; country: string; timezone: string }): Promise<WorkflowResult> {
  const problem = checkNewClient(input);
  if (problem) return { ok: false, message: problem };
  const specs = await db.jobSpec.count({ where: { briefId } });
  if (specs) return { ok: false, message: "This brief already has a spec, so its client can't change. Reject the spec, or add the brief again." };
  return changeBriefClient(briefId, await createClient(input));
}

// "Client update" item: regenerate every waiting spec of the brief with the update (the update is already in the
// brief's text; the comment tells the agent to apply it).
export async function regenerateWithUpdate(itemId: string): Promise<WorkflowResult> {
  const { item, email } = await loadItem(itemId, "client_update");
  const specs = await db.jobSpec.findMany({ where: { briefId: item.briefId!, status: "awaiting_approval" } });
  if (!specs.length) return { ok: false, message: "No spec of this brief is waiting for approval. Approved specs change from the job's shortlist screen." };
  await closeItem(itemId, "approved");
  const comment = `The client sent an update (at the end of the brief, from ${email.fromName}, ${dateTime(email.receivedAt)}). Apply it to the spec: “${email.body.slice(0, 2000)}”`;
  const results = [];
  for (const s of specs) results.push(await rejectSpec(s.id, comment));
  const failed = results.filter((r) => !r.ok);
  return failed.length ? failed[0] : { ok: true, message: `New draft${specs.length > 1 ? "s" : ""} with the client's update in the approval queue.` };
}

export async function dismissInboundItem(itemId: string): Promise<WorkflowResult> {
  await db.approvalItem.update({ where: { id: itemId }, data: { status: "dismissed", decidedAt: new Date() } });
  return { ok: true, message: "Dismissed." };
}

// "Try again" on a failed / stopped classifier run (the email is in the database; Gmail isn't needed).
export async function retryInbound(itemId: string): Promise<WorkflowResult> {
  const item = await db.approvalItem.findUniqueOrThrow({ where: { id: itemId } });
  const email = await db.inboundEmail.findUniqueOrThrow({ where: { id: item.inboundEmailId! } });
  await db.approvalItem.update({ where: { id: itemId }, data: { status: "dismissed", decidedAt: new Date() } });
  const outcome = await classifyAndRoute(email);
  return { ok: outcome !== "failed", message: outcome === "failed" ? "Failed again; see the approval queue." : `Done: ${outcome.replace("_", " ")}.` };
}

// For the Briefs page header.
export async function gmailStatus() {
  const account = await getGoogleAccount();
  // Logins from before specs/14 lack the free/busy permission: the bar asks to connect again.
  const missingCalendar = !!account && !account.scopes.split(" ").includes(FREEBUSY_SCOPE);
  return account
    ? { connected: !account.lastError, email: account.email, error: account.lastError, missingCalendar }
    : { connected: false, email: null, error: null, missingCalendar: false };
}
