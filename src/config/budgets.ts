// Cost budgets for every agent, in one place. Values come from each spec's "Cost budget" section.
// These are starting guesses: after ~10 real runs per agent, set budget to about 1.5x the median.
import type { ModelKey } from "./models";

export type AgentBudget = {
  model: ModelKey;
  budgetUsd: number; // per unit (see `unit`)
  unit: string;
  maxTurns: number;
  // Only for agents where one run can produce several units (budget = budgetUsd x units in that run).
  maxUnitsPerRun?: number;
};

export const AGENT_BUDGETS = {
  // Phase 0 only: proves the Claude + Langfuse connection works.
  "connection-test": { model: "haiku", budgetUsd: 0.01, unit: "per test", maxTurns: 1 },

  // One brief can describe several roles: budget is $0.025 x number of specs the run produced (max 3).
  // Lowered from $0.05 after the first 28 runs (single-spec median ~$0.011, max ~$0.020).
  "job-spec-agent": { model: "sonnet", budgetUsd: 0.025, unit: "per spec", maxTurns: 5, maxUnitsPerRun: 3 },
  // Gmail inbound (docs/specs/11-gmail-inbound.md): one short Haiku call per new email thread. Starting guess.
  "inbound-classifier": { model: "haiku", budgetUsd: 0.002, unit: "per email", maxTurns: 2 },
  // Client reply hint (docs/specs/13-gmail-client-emails.md): one short Haiku call per client reply from Gmail. Starting guess.
  "client-reply-hint": { model: "haiku", budgetUsd: 0.002, unit: "per client reply", maxTurns: 2 },
  // CV upload (docs/specs/15-cv-upload.md): Haiku reads one uploaded PDF and writes it out as plain text. Starting guess:
  // a 2-page CV is ~5k input tokens and ~2k output tokens (~$0.015).
  "cv-reader": { model: "haiku", budgetUsd: 0.02, unit: "per CV", maxTurns: 2 },
  // Budgets below set in Phase 2 to ~1.5x the median of the first real runs.
  // Lowered from $0.10 (10 runs: median $0.026, range $0.021-0.034).
  "sourcing-agent": { model: "sonnet", budgetUsd: 0.04, unit: "per job", maxTurns: 10 },
  // Raised from $0.005 (22 runs with thinking off: median $0.0041, range $0.0023-0.0050).
  "enrichment-agent": { model: "haiku", budgetUsd: 0.006, unit: "per candidate", maxTurns: 3 },
  // Runs at effort "low" (src/config/models.ts AGENT_EFFORT), only for candidates that pass the pre-filter.
  // Lowered from $0.05 (17 runs: median $0.014, range $0.011-0.019).
  "screening-agent": { model: "opus", budgetUsd: 0.02, unit: "per candidate", maxTurns: 4 },
  // Lowered from $0.02 (17 runs: median $0.0085, range $0.007-0.014).
  "outreach-draft": { model: "sonnet", budgetUsd: 0.015, unit: "per draft", maxTurns: 4 },
  // Raised from $0.002 (10 runs: median $0.0021, range $0.0018-0.0035; half were flagged).
  "reply-classifier": { model: "haiku", budgetUsd: 0.003, unit: "per reply", maxTurns: 4 },
  // Two runs per candidate (questions, then summary); each run is checked against this budget.
  // Lowered from $0.03 after Phase 5 (76 runs: median $0.013, max $0.022).
  "prescreen-agent": { model: "sonnet", budgetUsd: 0.02, unit: "per candidate", maxTurns: 6 },
  // Lowered from $0.04 after Phase 5 (28 runs: median $0.017, max $0.022).
  "submission-agent": { model: "sonnet", budgetUsd: 0.025, unit: "per submission", maxTurns: 5 },
  // Haiku runs per interview: one options email (+1 per reschedule) and one per candidate reply; each run is
  // checked against this budget. Confirmations, reminders and nudges are templates (no AI, no cost).
  // Lowered from $0.01 after Phase 5 (53 runs: median $0.0017, max $0.0017).
  "scheduling-agent": { model: "haiku", budgetUsd: 0.003, unit: "per interview", maxTurns: 6 },
  // Step 9: one Sonnet run per weekly job ("Run now" on the Feedback page). Recording outcomes and collecting
  // corrections cost nothing (no AI).
  "feedback-weekly-summary": { model: "sonnet", budgetUsd: 0.2, unit: "per weekly summary", maxTurns: 5 },
} satisfies Record<string, AgentBudget>;

export type AgentName = keyof typeof AGENT_BUDGETS;

// Above this multiple of budget, a run is stopped and nothing is saved.
export const RUNAWAY_MULTIPLIER = 3;

// Whole job, spec through scheduling (~20 sourced candidates). Lowered from $3.00 in Phase 2.
// Hard stop: before each agent run in a job's pipeline, if the job's cost so far is at or above its
// budget (this + any extra a human approved), the pipeline pauses and asks in the approval queue.
// A run already in progress still finishes, so a job can end slightly above this.
export const JOB_BUDGET_USD = 1.5;
// Job page shows a warning at this share of the job budget.
export const JOB_BUDGET_WARNING_RATIO = 0.8;
// "Continue" on a paused job adds this much budget to that job.
export const JOB_BUDGET_EXTENSION_USD = 1.5;

// ---------- Steps 2-4 settings (cost levers agreed in Phase 2) ----------
// Max new candidates one sourcing run adds to a job (spec said 30; lowered to 20 to cut cost).
export const SOURCING_MAX_CANDIDATES = 20;
// Fewer than this after the first searches -> the sourcing agent broadens once.
export const SOURCING_MIN_CANDIDATES = 5;
// How many enrichment / screening runs go at the same time.
export const ENRICHMENT_CONCURRENCY = 5;
export const SCREENING_CONCURRENCY = 3;
// Step 5: how many outreach drafts are written at the same time.
export const OUTREACH_CONCURRENCY = 3;

// ---------- CV upload (docs/specs/15-cv-upload.md) ----------
export const CV_MAX_FILE_MB = 5; // per PDF
export const CV_MAX_FILES_PER_UPLOAD = 5;
export const CV_READER_CONCURRENCY = 3;
