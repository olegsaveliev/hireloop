// Step 7 submission settings, in one place (docs/specs/07-submission-agent.md).
import { currencyOf, parseRate, periodOf } from "@/lib/rates";

export const SUBMISSION_FIELDS = ["headline", "summary", "key_skills", "experience_highlights", "rate", "availability"] as const;
export type SubmissionField = (typeof SUBMISSION_FIELDS)[number];

// The submission format: what the client gets and how it's written.
export type SubmissionFormat = { anonymized: boolean; tone: string; fields: SubmissionField[]; notes: string };

// The one Hireloop format, used for every client (since 2026-10-09 clients no longer have their own).
// `anonymized: true` would hide the name, contacts and employers (the agent and the code checks still support it).
export const SUBMISSION_FORMAT: SubmissionFormat = {
  anonymized: false,
  tone: "clear, friendly, professional",
  fields: [...SUBMISSION_FIELDS],
  notes: "Hireloop format. Rate as confirmed with the candidate. Max one page.",
};

// What the rate must be in, read from the format's notes ("Rate as EUR per hour").
export function requiredRateUnit(format: SubmissionFormat) {
  const rateNote = format.notes.match(/rate[^.]*/i)?.[0] ?? "";
  return { currency: currencyOf(rateNote), period: periodOf(rateNote) };
}

// "Rate not confirmed" (spec edge case): no rate, or not in the currency/period the client asks for.
// Returns why it can't be used, or null when it's fine.
export function rateProblem(rate: string | null | undefined, format: SubmissionFormat): string | null {
  if (!rate?.trim()) return "The pre-screen has no confirmed rate.";
  const r = parseRate(rate);
  if (!r) return `"${rate}" has no amount.`;
  const want = requiredRateUnit(format);
  if (want.currency && r.currency !== want.currency) return `The client wants the rate in ${want.currency}${want.period ? ` per ${want.period}` : ""}; the candidate's rate is "${rate}".`;
  if (want.period && r.period !== want.period) return `The client wants the rate per ${want.period}; the candidate's rate is "${rate}".`;
  return null;
}
