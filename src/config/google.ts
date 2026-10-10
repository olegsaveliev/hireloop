// Gmail + Google Calendar settings (docs/specs/11-gmail-inbound.md). Keys and URLs come from .env.local.

// Asked once at "Connect Gmail". Send and calendar are used by later steps (5 and 8).
export const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy"; // added 2026-10-08 (specs/14)
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  FREEBUSY_SCOPE,
];

// The app reads only messages with this Gmail label (case doesn't matter).
export const BRIEFS_LABEL = "Briefs";

// Max new emails one "Check inbox" click processes (oldest first).
export const INBOUND_MAX_PER_CHECK = 20;

// Longer email bodies are cut (noted on the brief).
export const INBOUND_MAX_BODY_CHARS = 20_000;

// The classifier only needs the start of an email to tell a brief from "thanks, talk tomorrow".
export const CLASSIFIER_MAX_BODY_CHARS = 4_000;

// Addresses the app may send email to (from Step 5 on): the test inbox plus the allow-list (both set in the Keys menu
// or .env.local). Everything else is refused in code.
export const sendAllowlist = () =>
  [process.env.GOOGLE_TEST_INBOX ?? "", process.env.GOOGLE_SEND_ALLOWLIST ?? ""]
    .join(",")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

// Allowed: an address on the allow-list, or a "+" variant of one (demo candidates are <test inbox>+39@…).
export function isSendAllowed(address: string): boolean {
  const a = address.trim().toLowerCase();
  const base = a.replace(/\+[^@]*@/, "@");
  return sendAllowlist().some((x) => x === a || x === base);
}
