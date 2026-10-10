// Langfuse scores each agent is expected to record, copied from each spec's "Langfuse tracing" section.
// Used by `npm run check:langfuse` (docs/specs/10-langfuse-polish.md) to find missing or misspelled scores.
import type { AgentName } from "./budgets";

// When a score is expected on a trace:
// - "every-run": on every run of the agent (a gap here is an error);
// - "pipeline": on successful runs inside a job's pipeline (direct test runs don't get it);
// - "human": only after a recruiter action (approve, reject, override, Correct/Wrong, a reply arriving).
export type ScoreWhen = "every-run" | "pipeline" | "human";

export const EXPECTED_SCORES: Partial<Record<AgentName, Record<string, ScoreWhen>>> = {
  "job-spec-agent": { cost_vs_budget: "every-run", approved_without_edits: "human", fields_edited: "human", rejected: "human" },
  // classifier_correct = 0 when the recruiter clicks "This is a brief" on an ignored email.
  "inbound-classifier": { cost_vs_budget: "every-run", classifier_correct: "human" },
  "sourcing-agent": { cost_vs_budget: "every-run", candidates_found: "pipeline", later_shortlisted_ratio: "human" },
  "enrichment-agent": { cost_vs_budget: "every-run", missing_fields_count: "pipeline" },
  // final_outcome (Step 9): hired = 1, rejected by client / withdrew = 0, on the screening, pre-screen and submission
  // traces of a candidate whose outcome was recorded (docs/specs/09-feedback-loop.md).
  "screening-agent": { cost_vs_budget: "every-run", recruiter_agreement: "human", overrides: "human", final_outcome: "human" },
  "outreach-draft": { cost_vs_budget: "every-run", approved_without_edits: "human", reply_received: "human" },
  "reply-classifier": { cost_vs_budget: "every-run", classifier_correct: "human" },
  // Two kinds of run under one agent: questions and summary. answers_completeness is on summary runs only.
  // approved_without_edits: on the questions run, when the recruiter sends the questions (since 2026-10-08).
  "prescreen-agent": { cost_vs_budget: "every-run", approved_without_edits: "human", answers_completeness: "pipeline", recruiter_agreed_with_recommendation: "human", final_outcome: "human" },
  // hint_followed: 1 if the button the account manager clicked matches the hint, else 0 (specs/13).
  "client-reply-hint": { cost_vs_budget: "every-run", hint_followed: "human" },
  // client_accepted_for_interview is filled in Step 8 (client asks for an interview, or rejects).
  "submission-agent": { cost_vs_budget: "every-run", approved_without_edits: "human", client_accepted_for_interview: "human", final_outcome: "human" },
  // Three kinds of run under one agent: options email, reschedule email, reading a reply. messages_to_confirm and
  // escalated go on the interview's main trace (its first options email) once it's booked or escalated.
  // approved_without_edits: on an options-email run when the recruiter sends the times (since 2026-10-08).
  "scheduling-agent": { cost_vs_budget: "every-run", approved_without_edits: "human", messages_to_confirm: "human", escalated: "human" },
  // Step 9 weekly summary ("Run now" on the Feedback page).
  "feedback-weekly-summary": { cost_vs_budget: "every-run" },
};

// Scores that may appear on any agent's trace without being listed above.
// eval_passed: set by `npm run eval` on eval traces only. test_passed: set by the `test:*` scripts.
export const SHARED_SCORES = ["eval_passed", "test_passed"];
// Score names written before Phase 4 that are known and harmless (old data in Langfuse; not written any more).
// test_passed:<item id> was renamed to test_passed (item id in the score comment).
export const LEGACY_SCORE_PREFIXES = ["test_passed:"];
