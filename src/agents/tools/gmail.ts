// Real Gmail (docs/specs/11-gmail-inbound.md). Replaces mock_inbox for inbound briefs; sending is used from Step 5 on.
// Guardrails: reads only messages with label `Briefs`; never changes, labels or deletes anything in Gmail;
// sends only to addresses in GOOGLE_SEND_ALLOWLIST (and their "+" variants, docs/specs/12-gmail-outreach.md).
import { gmail, type gmail_v1 } from "@googleapis/gmail";
import type { OAuth2Client } from "google-auth-library";
import { BRIEFS_LABEL, INBOUND_MAX_BODY_CHARS, isSendAllowed } from "@/config/google";
import { withGoogle } from "./google-auth";

// One Gmail message, as the inbound workflow uses it. Tests build these by hand (no Gmail needed).
export type ParsedEmail = {
  gmailMessageId: string;
  gmailThreadId: string;
  fromName: string;
  fromEmail: string; // lowercase
  subject: string;
  body: string; // plain text, quoted earlier replies removed, max INBOUND_MAX_BODY_CHARS
  truncated: boolean;
  attachmentNames: string[];
  receivedAt: Date;
};

const api = (auth: OAuth2Client) => gmail({ version: "v1", auth });

// "Anna Kowalska <anna@x.com>" or "anna@x.com" -> name + lowercase email.
export function parseFrom(header: string): { name: string; email: string } {
  const m = header.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (m ? m[2] : header).trim().toLowerCase();
  const name = (m?.[1] ?? "").trim() || email.split("@")[0];
  return { name, email };
}

const decode = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Cut the quoted earlier conversation from a reply ("On ... wrote:" in English, Ukrainian, Polish, Russian Gmail;
// lines starting with ">"). Forwarded messages are kept whole (their content is the brief).
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const marker = /^(On .+wrote:|.+ (пише|пишет|napisał\(a\)|napisał|napisała):|-----Original Message-----)\s*$/;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Gmail sometimes wraps the "On ... wrote:" line in two.
    const joined = i + 1 < lines.length ? `${line} ${lines[i + 1]}` : line;
    if (marker.test(line.trim()) || (/^On /.test(line.trim()) && /wrote:\s*$/.test(joined.trim()) && !/wrote:/.test(line))) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

function walk(part: gmail_v1.Schema$MessagePart | undefined, found: { plain: string[]; html: string[]; attachments: string[] }) {
  if (!part) return found;
  if (part.filename) found.attachments.push(part.filename);
  else if (part.mimeType === "text/plain" && part.body?.data) found.plain.push(decode(part.body.data));
  else if (part.mimeType === "text/html" && part.body?.data) found.html.push(decode(part.body.data));
  for (const p of part.parts ?? []) walk(p, found);
  return found;
}

export function parseMessage(m: gmail_v1.Schema$Message): ParsedEmail {
  const header = (name: string) => m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
  const { name, email } = parseFrom(header("From"));
  const parts = walk(m.payload, { plain: [], html: [], attachments: [] });
  const raw = parts.plain.length ? parts.plain.join("\n") : htmlToText(parts.html.join("\n"));
  const cleaned = stripQuoted(raw);
  return {
    gmailMessageId: m.id!,
    gmailThreadId: m.threadId!,
    fromName: name,
    fromEmail: email,
    subject: header("Subject").trim() || "(no subject)",
    body: cleaned.slice(0, INBOUND_MAX_BODY_CHARS),
    truncated: cleaned.length > INBOUND_MAX_BODY_CHARS,
    attachmentNames: parts.attachments,
    receivedAt: m.internalDate ? new Date(Number(m.internalDate)) : new Date(),
  };
}

// New messages under label `Briefs`, oldest first, at most `max`. `isSeen` filters out messages already processed.
// Returns how many more are waiting.
export async function listNewBriefEmails(max: number, isSeen: (ids: string[]) => Promise<Set<string>>): Promise<{ emails: ParsedEmail[]; more: number; account: string }> {
  return withGoogle(async (auth, account) => {
    const g = api(auth);
    const labels = (await g.users.labels.list({ userId: "me" })).data.labels ?? [];
    const label = labels.find((l) => l.name?.toLowerCase() === BRIEFS_LABEL.toLowerCase());
    if (!label?.id) throw new Error(`Gmail label "${BRIEFS_LABEL}" not found in ${account}. Create it in Gmail and put brief emails there.`);

    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await g.users.messages.list({ userId: "me", labelIds: [label.id], maxResults: 100, pageToken });
      ids.push(...(page.data.messages ?? []).map((x) => x.id!).filter(Boolean));
      pageToken = page.data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < 500);

    const seen = await isSeen(ids);
    const fresh = ids.filter((id) => !seen.has(id)).reverse(); // Gmail lists newest first
    const emails: ParsedEmail[] = [];
    for (const id of fresh.slice(0, max)) {
      emails.push(parseMessage((await g.users.messages.get({ userId: "me", id, format: "full" })).data));
    }
    emails.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    return { emails, more: Math.max(0, fresh.length - max), account };
  });
}

export class SendNotAllowedError extends Error {}

export type SendArgs = { to: string; subject: string; body: string; threadId?: string | null };
export type SentEmail = { gmailMessageId: string; gmailThreadId: string };

// The only function that sends real email. Refuses any address not on the allow-list (.env.local).
// With a threadId, the email goes into that Gmail thread as a reply (In-Reply-To = the thread's last message).
export async function sendEmail(args: SendArgs): Promise<SentEmail> {
  if (isTestScript()) throw new Error("Real Gmail is off inside automated tests (scripts/tests/*, eval).");
  const to = args.to.trim().toLowerCase();
  if (!isSendAllowed(to)) throw new SendNotAllowedError(`Not sent: ${to} is not in GOOGLE_SEND_ALLOWLIST (prototype sends only to test addresses).`);
  return withGoogle(async (auth, from) => {
    const g = api(auth);
    let inReplyTo: string | null = null;
    if (args.threadId) {
      const t = await g.users.threads.get({ userId: "me", id: args.threadId, format: "metadata", metadataHeaders: ["Message-ID"] });
      const last = t.data.messages?.at(-1);
      inReplyTo = last?.payload?.headers?.find((h) => h.name?.toLowerCase() === "message-id")?.value ?? null;
    }
    const headers = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(args.subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    ];
    const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${args.body}`).toString("base64url");
    const res = await g.users.messages.send({ userId: "me", requestBody: { raw, threadId: args.threadId ?? undefined } });
    return { gmailMessageId: res.data.id!, gmailThreadId: res.data.threadId! };
  });
}

// Every message in a Gmail thread, oldest first (used to find candidates' replies in threads the app started).
export async function getThreadEmails(threadId: string): Promise<ParsedEmail[]> {
  if (isTestScript()) throw new Error("Real Gmail is off inside automated tests (scripts/tests/*, eval).");
  return withGoogle(async (auth) => {
    const t = await api(auth).users.threads.get({ userId: "me", id: threadId, format: "full" });
    return (t.data.messages ?? []).map(parseMessage).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  });
}

// The Gmail calls the app makes for candidate and client emails. Tests swap these for a fake Gmail (no login needed)
// and set `fake: true`.
export const gmailTransport = { send: sendEmail, getThread: getThreadEmails, fake: false };

// Guardrail (added 2026-10-08 after test emails reached the test inbox): automated tests and evals (scripts/tests/*,
// scripts/evals/*) never use real Gmail. Their emails stay in the mock inbox, unless the test installed a fake Gmail.
export const isTestScript = () => /scripts[\\/](tests|evals)[\\/]/.test(process.argv[1] ?? "");
export const realGmailAllowed = () => gmailTransport.fake || !isTestScript();

export const gmailThreadUrl = (threadId: string) => `https://mail.google.com/mail/u/0/#all/${threadId}`;
