// Step 8 output schemas. The agent never states a time: it writes the email around a {{slots}} marker (the app
// puts in the times, with both time zones) and reads replies into a slot number. Guardrails checked in code.
import { z } from "zod";

export const SLOTS_MARKER = "{{slots}}";
export const MAX_EMAIL_WORDS = 110;

// Anything that looks like a time or date: the agent must leave those to the app's slot list.
const TIME_OR_DATE =
  /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s?(?:am|pm)\b|\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(?:utc|gmt|cet|cest|eet|eest|est|edt)\b/i;
export const timesIn = (text: string) => text.replaceAll(SLOTS_MARKER, "").match(TIME_OR_DATE)?.[0] ?? null;

const cyrillic = /[Ѐ-ӿ]/;

export const optionsEmailSchema = (ctx: { clientName?: string }) =>
  z
    .object({
      candidate_id: z.string(),
      body: z.string().min(1),
    })
    .superRefine((o, c) => {
      const markers = o.body.split(SLOTS_MARKER).length - 1;
      if (markers !== 1) c.addIssue({ code: "custom", path: ["body"], message: `must contain ${SLOTS_MARKER} exactly once (found ${markers})` });
      const t = timesIn(o.body);
      if (t) c.addIssue({ code: "custom", path: ["body"], message: `don't write times, days or time zones ("${t}"); the app inserts them at ${SLOTS_MARKER}` });
      const words = o.body.replaceAll(SLOTS_MARKER, "").split(/\s+/).filter(Boolean).length;
      if (words > MAX_EMAIL_WORDS) c.addIssue({ code: "custom", path: ["body"], message: `${words} words, max ${MAX_EMAIL_WORDS}` });
      if (cyrillic.test(o.body)) c.addIssue({ code: "custom", path: ["body"], message: "write in English with Latin letters" });
      if (ctx.clientName && o.body.toLowerCase().includes(ctx.clientName.split(/\s+/)[0].toLowerCase())) {
        c.addIssue({ code: "custom", path: ["body"], message: "don't name the client" });
      }
    });
export type OptionsEmail = z.infer<ReturnType<typeof optionsEmailSchema>>;

export const REPLY_INTENTS = ["pick", "reschedule", "decline", "acknowledge", "other"] as const;
export type SchedulingIntent = (typeof REPLY_INTENTS)[number];

// `slotCount` = how many options the candidate was offered (0 when none are open, e.g. after booking).
export const schedulingReplySchema = (slotCount: number) =>
  z
    .object({
      candidate_id: z.string(),
      intent: z.enum(REPLY_INTENTS),
      slot_number: z.number().int().nullable(),
      summary: z.string().min(1).max(300),
    })
    .superRefine((o, c) => {
      if (o.intent === "pick" && (o.slot_number === null || o.slot_number < 1 || o.slot_number > slotCount)) {
        c.addIssue({ code: "custom", path: ["slot_number"], message: slotCount ? `pick needs slot_number 1-${slotCount}` : "no options are open: use reschedule, acknowledge or other" });
      }
      if (o.intent !== "pick" && o.slot_number !== null) c.addIssue({ code: "custom", path: ["slot_number"], message: "slot_number only for pick" });
    });
export type SchedulingReply = z.infer<ReturnType<typeof schedulingReplySchema>>;
