import { z } from "zod";

// Client reply hint (docs/specs/13-gmail-client-emails.md): which button the account manager should probably click.
export const CLIENT_SITUATIONS = {
  submission_sent: ["wants_interview", "rejected", "question", "other"],
  awaiting_client: ["confirms_time", "cant_make_time", "question", "other"],
  other_stage: ["question", "other"],
} as const;
export type ClientSituation = keyof typeof CLIENT_SITUATIONS;

export const clientReplyHintSchema = (situation: ClientSituation) =>
  z.object({
    suggestion: z.enum(CLIENT_SITUATIONS[situation] as unknown as [string, ...string[]]),
    reason: z.string().min(1).max(300),
    quote: z.string().max(300).nullable(),
  });
export type ClientReplyHint = { suggestion: string; reason: string; quote: string | null };

// What the hint means on screen (the button it points at).
export const HINT_LABELS: Record<string, string> = {
  wants_interview: "wants an interview → Client wants interview",
  rejected: "passes on the candidate → Client rejected",
  confirms_time: "confirms the time → Client confirms",
  cant_make_time: "can't make the time → Client can't make it",
  question: "asks a question → answer them first (no button yet)",
  other: "nothing to decide yet",
};
