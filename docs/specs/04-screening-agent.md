# Step 4: Screening agent

## Purpose
Score each candidate against the spec with written reasons, so the recruiter can pick a shortlist fast.

## Trigger
Enrichment finished for all candidates of a job.

## Inputs
- Approved `job_specs` row (title, seniority, must_have, nice_to_have, dealbreakers, location)
- `candidate_profiles` for the job (structured profile only, without contacts; never the raw text)

## Pre-filter (added in Phase 2, app code, no AI)
Before Opus runs, plain code drops clear misses: a candidate is filtered out only when the spec has
searchable must-have skills and **none** of them appear in the candidate's skills, recent stack, current title
or past job titles. One matching word is enough to pass. Filtered candidates get a `screening_results` row
with the reason, are shown at the bottom of the shortlist table, and can still be ticked.
(Detecting dealbreakers in code was considered and left to Opus: dealbreakers are free text.)

## Output
Saved to `screening_results` (one row per candidate per screening; on re-screen old rows are kept with
`current = false`); pipeline stage stays `sourced` until approval.
```json
{
  "candidate_id": "string",
  "score": 0,
  "must_have_met": ["string"],
  "must_have_missing": ["string"],
  "dealbreaker_hit": "string | null",
  "reasons": "2-3 sentences",
  "confidence": "high | medium | low"
}
```
Score is 0-100. The agent returns it; the app saves it.

## Model
Opus at effort **low** (`AGENT_EFFORT` in `src/config/models.ts`). Ranking is the most consequential judgment in
the flow. One run per candidate (3 at a time), so each candidate is judged on their own and the runaway stop
works per candidate.

## Tools
None. Spec and profile go straight into the prompt; the app saves the result.

## Agent steps
1. For each candidate, check every must-have and dealbreaker explicitly.
2. Any dealbreaker hit -> score max 20 (also enforced in app code).
3. Score on must-haves first, nice-to-haves second.
4. Write reasons referencing specific profile facts.
5. Mark low confidence when profile has many missing fields.

## Human approval
- Who approves: recruiter
- What they see: the sourcing agent's headlines and sourcing details at the top, then a ranked list with score,
  confidence, reasons (collapsed per candidate), and a "Fit to check" column: missing must-haves ("Not evidenced: Kafka"),
  dealbreaker, and "Outside EU" when the spec's location asks for the EU and the profile's country is not an EU member
  (an app check on the profile's location, not an agent field). Filtered-out candidates collapsed at the bottom.
  The top 10 (excluding dealbreaker hits) start ticked.
- What they can edit: select/deselect candidates, override score with a note (note required)
- On approve: selected candidates move to `shortlisted`, job status `shortlisted`. Step 5 starts in Phase 3.
- On reject: recruiter edits the approved spec directly (the job spec agent does not re-run),
  then sourcing re-runs and skips candidates already in the pipeline. **Everyone** (old and new) is
  re-screened against the edited spec; the old scores are kept as history.
- Later additions (2026-10-10): after approval, the Job page's **Not shortlisted** tab has **Add to shortlist** per
  candidate (asks first; says so when the candidate was filtered out). The candidate moves to `shortlisted` and the
  outreach step drafts their first message for approval. Used e.g. when everyone on the shortlist dropped out (job
  status "Needs candidates").

## Guardrails
- Reasons must cite profile facts, never assumptions.
- Never use protected attributes or university prestige as a factor (the structured profile doesn't contain them).

## Edge cases
- Everyone scores under 40: tell recruiter the spec may be too strict (shown on the job and the queue item).
- Ties: order by confidence, then years of experience.
- A run that fails or goes over 3x budget: one grouped item per job in the queue; the shortlist still opens
  with everyone else. "Try again" scores only the missing ones.

## Cost budget
- Budget: $0.02 per candidate (was $0.05; set in Phase 2 to ~1.5x the median of 17 runs, $0.014)
- Max agent turns: 4
- Rationale: Opus is the priciest model; keep input to profile + spec only.
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with "Stopped: over budget".
- These are starting guesses. After the first 10 real runs, set the budget to about 1.5x the median actual cost.
- Actual so far (effort low, ~10 runs): $0.013-0.019 per candidate.

### Job budget (hard stop, added in Phase 2)
Job budget is $1.50 (was $3.00), in `src/config/budgets.ts`. Before every agent run in Steps 2-4, the app compares
the job's total agent cost with its budget. At or above it, the pipeline pauses (`paused_over_budget`) and
"Job over budget: continue?" goes to the approval queue: **Continue** adds $1.50 to that job and resumes where it
stopped; **Stop job** ends it. A run already in progress still finishes, so a job can end slightly above budget.

## Langfuse tracing
- Trace name: `screening-agent` (one trace per candidate); session `job:<job_id>`
- Tags: `step-4`, `job:<job_id>`, `client:<client_id>`
- Metadata: `candidate_id`, `candidates_scored` (1 per trace), `effort`
- Scores: `cost_vs_budget` (actual / budget); at shortlist approval, on every screening trace of the job:
  `recruiter_agreement` (share of the agent's top 10, by agent score, that the recruiter kept) and
  `overrides` (1 if that candidate's score was overridden, so the sum over the job = override count)

## Acceptance criteria
- [x] Every candidate gets score + reasons (or a pre-filter reason)
- [x] Dealbreaker test passes
- [x] Shortlist approval moves stage correctly
- [x] Recruiter agreement score logged to Langfuse

Automated: `npm run test:phase2`. Langfuse dataset: `screening-agent`.

## Test cases
1. Perfect-fit seed candidate -> score 85+
2. Candidate hitting a dealbreaker -> score 20 or less
3. Thin profile -> low confidence
