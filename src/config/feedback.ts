// Step 9 feedback loop settings, in one place (docs/specs/09-feedback-loop.md).
import { PROTECTED_TOPICS } from "./prescreen";

export const OUTCOMES = {
  hired: { label: "Hired", score: 1, stage: "hired" },
  rejected_by_client: { label: "Rejected by client", score: 0, stage: "client_rejected" },
  withdrew: { label: "Candidate withdrew", score: 0, stage: "withdrew" },
} as const;
export type OutcomeKind = keyof typeof OUTCOMES;

// Which outcomes fit which pipeline stage: hired only after the client interviewed; the client can only reject a
// candidate it was sent; a candidate can withdraw any time after replying.
export const OUTCOMES_FOR_STAGE: Record<string, OutcomeKind[]> = {
  replied: ["withdrew"],
  prescreened: ["withdrew"],
  submitted: ["rejected_by_client", "withdrew"],
  client_rejected: ["rejected_by_client"],
  interview: ["hired", "rejected_by_client", "withdrew"],
};
// Once an outcome is recorded the stage is hired | client_rejected | withdrew; recording again (to fix a mistake)
// uses the stage from before the first outcome.

export const MIN_REASON_CHARS = 5;

// Guardrail: outcome reasons must not include protected attributes. Same word lists as the pre-screen (age,
// family, health, religion, nationality) plus gender, sexual orientation and "too old/young". A hit blocks the form.
const OUTCOME_ONLY_TOPICS: { topic: string; pattern: RegExp }[] = [
  { topic: "age", pattern: /\b(too (old|young)|retire\w*|elderly)\b/i },
  // Pronouns are fine ("he accepted another offer"); words about gender are not.
  { topic: "gender", pattern: /\b(gender|female|male|woman|women|girl|lady)\b/i },
  { topic: "sexual orientation", pattern: /\b(sexual orientation|gay|lesbian|bisexual|transgender|LGBT\w*)\b/i },
];

export function protectedInReason(reason: string): string[] {
  return [...new Set([...PROTECTED_TOPICS, ...OUTCOME_ONLY_TOPICS].filter((t) => t.pattern.test(reason)).map((t) => t.topic))];
}

// Corrections: a recruiter-overridden screening score passes the eval if the agent lands within this many points.
export const SCORE_TOLERANCE = 10;

// Weekly job: the summary looks at this many days back. "Run now" on the Feedback page; hosted: Trigger.dev schedule.
export const WEEKLY_PERIOD_DAYS = 7;
// The summary lists at most this many issues, most frequent first.
export const MAX_SUMMARY_ISSUES = 5;

// "Close position" on the Job page (2026-10-10): why the recruiter closed it. Saved on the job for reporting.
export const CLOSE_REASONS = {
  no_candidates: "No suitable candidates",
  client_cancelled: "Client cancelled the role",
  filled_elsewhere: "Filled elsewhere",
  other: "Other",
} as const;
export type CloseReason = keyof typeof CLOSE_REASONS;
