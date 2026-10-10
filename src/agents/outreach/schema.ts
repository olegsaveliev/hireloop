// Step 5 outputs (docs/specs/05-outreach-agent.md "Output").
import { z } from "zod";
import { MAX_DRAFT_WORDS } from "@/config/outreach";
import { fold } from "@/lib/candidates";

export const INTENTS = ["interested", "not_interested", "question", "later", "out_of_office"] as const;
export type Intent = (typeof INTENTS)[number];

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

// The client's name (and its main word, e.g. "Brightline" from "Brightline Payments") must not appear.
export function clientNameTerms(clientName: string): string[] {
  const words = clientName.split(/\s+/).filter((w) => w.length >= 4);
  return [...new Set([clientName, words[0]].filter(Boolean))];
}

// Built per run: the app-side checks need the client's name. A failed check = invalid output -> one retry.
export function outreachDraftSchema(clientName: string) {
  const banned = clientNameTerms(clientName).map((t) => fold(t));
  const noClientName = (s: string) => !banned.some((t) => fold(s).includes(t));
  return z.object({
    candidate_id: z.string(),
    subject: z.string().min(1).max(120).refine(noClientName, "Don't name the client in the subject"),
    body: z
      .string()
      .min(1)
      .refine((b) => wordCount(b) < MAX_DRAFT_WORDS, `Body must be under ${MAX_DRAFT_WORDS} words`)
      .refine(noClientName, "Don't name the client in the body"),
    personalization_hooks: z.array(z.string().min(1)).min(1, "Give at least one personalization hook from the profile"),
    sequence_step: z.number().int().nullable(),
  });
}
export type OutreachDraft = z.infer<ReturnType<typeof outreachDraftSchema>>;

export const replyClassificationSchema = z.object({
  intent: z.enum(INTENTS),
  summary: z.string().min(1),
  suggested_reply: z.string().nullable(),
  return_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable(),
});
export type ReplyClassification = z.infer<typeof replyClassificationSchema>;
