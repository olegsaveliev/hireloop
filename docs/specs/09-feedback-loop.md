# Step 9: Feedback loop

## Purpose
Use real outcomes to measure and improve every agent over time.

## Trigger
Final outcome recorded for a candidate (hired, rejected by client, withdrew).
- Prototype: **Record outcome…** on a candidate's card on the Job page (shown once the candidate replied). Pick the
  outcome, type a reason, **Record outcome**. **Change outcome** replaces it (to fix a mistake).
- Which outcomes fit which stage (`src/config/feedback.ts`): replied / prescreened -> withdrew; submitted -> rejected by
  client or withdrew; client rejected (Step 8 button) -> rejected by client (adds the reason); interview -> all three.
  Anything else is refused with a message.

## Inputs
- Outcome + reason (entered by recruiter or AM)
- All Langfuse traces and scores for that candidate and job
  - The app keeps each step's trace id in the database (screening results, pre-screens, submissions), so it doesn't
    need to search Langfuse.

## Output
- `outcomes` table row (one per candidate per job: outcome, reason, the stage before, the traces scored). The pipeline
  stage becomes `hired` | `client_rejected` | `withdrew`.
- Langfuse scores attached back to earlier traces
- Failed or corrected cases added to Langfuse datasets (one dataset per agent)
  - Saved first in `dataset_corrections` (input, agent output, corrected output, expected in plain words, check), then
    pushed to Langfuse. The app never writes files, so corrections don't go into `src/evals/datasets.ts`.
- The candidate is closed: an interview still being arranged (or booked for later, unless hired) is cancelled and its
  calendar events removed; unsent drafts are cancelled; a pending submission is withdrawn; the candidate's open queue
  items are closed. Later replies from the candidate are kept but no agent reads them.

## Model
None for recording. Optional Sonnet weekly summary: "what went wrong most often this week".
- Built (decision L): the app gathers the week's facts in code, each with an id (corrections, outcomes, escalations,
  failed/stopped runs, eval results, run stats per agent); Sonnet groups them into at most 5 issues, citing fact ids.
  Prompt: `prompts/feedback-weekly-summary.md`. Output: headline, issues (agent, what went wrong, evidence, suggestion),
  going well, open questions.

## Tools
None for the agent (it gets the facts in its prompt). The app's functions:
| Function | Access | Purpose |
|------|--------|---------|
| `recordOutcome` (`src/agents/feedback/outcomes.ts`) = db.save_outcome | write | Store result, close the candidate |
| langfuse.score.create(trace_id, "final_outcome", value) | write | Link outcome to traces |
| `collectCorrections` (`src/agents/feedback/corrections.ts`) = langfuse.dataset_add | write | Build eval sets |
| `runWeeklyJob` (`src/agents/feedback/weekly.ts`) | write | Weekly job: corrections, datasets, summary |

## Agent steps
1. Recruiter records outcome + reason.
2. Attach `final_outcome` score to the job's screening and submission traces.
   - Also the pre-screen summary trace (decision J). Hired = 1, rejected by client = 0, withdrew = 0; the comment is
     "<outcome>: <reason>".
   - Fixed score ids (one per outcome and agent): changing the outcome replaces the value instead of adding a score.
3. Any recruiter override or rejection from earlier steps -> add input + corrected output to that agent's dataset.
   - Collected from the database when an outcome is recorded, by the weekly job, and with **Collect corrections now**
     (Feedback page). Each correction is saved once.
   - What counts (decision K):

     | Correction | Dataset | Check in `npm run eval` |
     |---|---|---|
     | Screening score overridden (Step 4) | screening-agent | pass if within ±10 of the override |
     | Reply intent marked Wrong (Step 5) | reply-classifier | pass if the corrected intent |
     | Spec edited on approval / rejected with a comment (Step 1) | job-spec-agent | reference only |
     | Draft edited before sending / rejected with a comment (Step 5) | outreach-draft (or reply-classifier for its suggested replies) | reference only |
     | Recruiter disagreed with the recommendation (Step 6: proceed -> don't submit, stop -> submit) | prescreen-agent | reference only |
     | Submission edited / rejected with a comment (Step 7) | submission-agent | reference only |

   - Checkable items carry the same input as that agent's eval items (spec + profile; the real thread + spec for a
     reply), so `npm run eval` runs them. Reference items are in the Langfuse dataset to read when changing a prompt.
4. Weekly: run each agent's prompt against its dataset in Langfuse to compare prompt versions.
   Prototype: weekly jobs (dataset runs, optional summary) start from a "Run now" button; hosted version uses a Trigger.dev schedule.
   - **Run now** on the Feedback page: collects corrections, then (checkbox, ~$0.50, a few minutes) runs every agent
     over its dataset (`src/evals/run.ts`, the same code as `npm run eval`), then writes the summary. Runs in the
     background; the page refreshes until it's done. One at a time. Saved in `weekly_reports`.

## Human approval
Not applicable. Humans provide the data.

## Guardrails
- Outcome reasons must not include protected attributes.
  - Word check in code (decision M, `src/config/feedback.ts`): the pre-screen list (age, family, health, religion,
    nationality) plus gender, sexual orientation and "too old/young". A hit blocks the form with a message; nothing is
    saved. Pronouns are fine ("he accepted another offer").
- The weekly summary cites only fact ids it was given (checked in code: unknown id = invalid output, one retry),
  orders issues by how many facts support them, and never mentions protected attributes (same word check).

## Cost budget
- Budget: $0.20 per weekly summary
- Max agent turns: 5
- Rationale: Optional Sonnet summary; recording outcomes costs nothing.
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with "Stopped: over budget".
  - A failed or stopped summary: "Failed / Stopped" queue item (Step 9) with **Dismiss** and a link to the Feedback
    page (run it again there). Corrections are collected either way.
- These are starting guesses. After the first 10 real runs, set the budget to about 1.5x the median actual cost.
- First runs (Step 9 build, 2026-10-07): $0.006-0.016 per eval week, $0.035 for a real week with 23 facts, 1 turn.
  Recording outcomes and collecting corrections: $0. Running every dataset: ~$0.50.

## Langfuse tracing
- Datasets: one per agent, named after the agent (`job-spec-agent`, `screening-agent`, `outreach-draft`, ...),
  as built in Phase 4 (`src/evals/datasets.ts`, docs/specs/10-langfuse-polish.md). Corrections are added to these.
  - Correction items: id `correction-<source>-<row id>`, metadata `correction: true`, `source`, `eval` (true when
    checkable), the agent's output; expected output = what should happen + the human's version.
  - New dataset `feedback-weekly-summary` (5 items: classifier mistakes first, screening overrides first, quiet week,
    no-overlap escalations, a comment with a protected detail not repeated). `npm run eval -- feedback-weekly-summary`
    (~$0.05).
- Dashboards: cost per job, cost per hire, approval-without-edit rate per agent
  - On the app's Feedback page: outcomes, hire rate, **cost per hire** (all job agent runs / hires), corrections.
    Langfuse charts can't join costs with outcomes; cost per job stays on the Runs page and Langfuse Sessions
    (Phase 4). Approval-without-edit rate: Phase 4 dashboard + Runs page quality table.
    Layout (2026-10-09, new design): those four numbers as tiles, then numbered cards 01 Weekly job, 02 Outcomes,
    03 Corrections, 04 Datasets.
- Trace `feedback-weekly-summary`, tags `step-9`, `weekly`; score `cost_vs_budget`. Score `final_outcome` on the
  screening, pre-screen and submission traces (listed in `src/config/langfuse-scores.ts` for `npm run check:langfuse`).

## Acceptance criteria
- [x] Outcome on a candidate shows up as a score on earlier traces (read back from Langfuse in the test)
- [x] Each agent has a dataset with at least 5 items (all 10 agents in Langfuse, 5-10 items each)
- [x] Can compare two prompt versions on one dataset (each eval run is named after its prompt version; Langfuse
      Datasets -> agent -> select two runs -> Compare; built in Phase 4, the weekly job's dataset runs use it too)

## Test cases
`npm run test:step9` (also part of `npm run test:phase5`), ~$0.05.
1. Hired candidate -> final_outcome = 1 on their screening trace ✓ (after first recording "rejected": still one score, value 1)
2. Recruiter override in Step 4 -> new item in screening-agent ✓ (read back from Langfuse; the eval runs it)
