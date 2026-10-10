# Step 1: Job spec agent

## Purpose
Turn a messy client brief into a structured, approved job spec that every later agent reads from.

## Trigger
Recruiter clicks "Create spec" on a client brief in the Briefs inbox.

## Inputs
- `client_briefs` row: raw text (email body, pasted JD, call notes)
- `mock_ats.past_jobs` for the same client (rates, past requirements), if any

## Output
Saved to `job_specs` with `status = awaiting_approval` (one row per role; see Edge cases).
```json
{
  "title": "string",
  "seniority": "junior | middle | senior | lead | null",
  "must_have": ["string"],
  "nice_to_have": ["string"],
  "dealbreakers": ["string"],
  "location": ["string"],
  "rate_range": "string | null",
  "selling_points": ["string"],
  "open_questions": ["string"]
}
```
`seniority` is null when the brief is unclear or contradictory about level (the reason goes in `open_questions`).
The agent returns `{ "specs": [spec, ...], "note": string | null }`: one spec per role, max 3, and a note
(e.g. "two roles, two specs"; anything that isn't a concrete role yet).

## Model
Sonnet. Needs nuance to separate hard requirements from wishes; Haiku misses this, Opus is overkill.

## Tools
| Tool | Access | Purpose |
|------|--------|---------|
| mock_ats.get_past_jobs(client_id) | read | Suggest realistic rates and requirements |
| (app code, not a tool) | write | Store draft spec after validation |

The agent only *returns* the spec. App code validates it and saves it. That way a run stopped over budget
really saves nothing. (Agreed in Phase 1; this used to be a `db.save_job_spec` tool.)

## Agent steps
1. Read the brief.
2. Look up past jobs for this client.
3. Extract requirements; classify each as must-have, nice-to-have, or dealbreaker.
4. If rate is missing, suggest a range from past jobs and flag it in open_questions.
5. List every ambiguity in open_questions.
6. Validate output against schema (Zod); retry once if invalid (the retry run gets the error and the invalid output).
7. App code saves the draft(s) and sets status to awaiting_approval; one approval queue item per spec.

## Human approval
- Who approves: recruiter
- What they see: original brief side by side with the draft spec
- What they can edit: every field; can mark open questions as answered and type the client's answer.
- **Apply answers to fields** (added in Phase 1 review): typed answers are only notes until applied.
  The button sends the current spec + the answers to the agent (prompt `prompts/job-spec-apply-answers.md`),
  which puts each answer in the right field (seniority, rate, must-haves, location...), removes the answered
  questions, and may add a follow-up question if an answer is unclear. The recruiter sees the updated fields
  and still has to approve. Nothing is saved until approve. Answers that were applied are kept with the spec
  (marked `applied`). If there are typed answers not yet applied, the Approve area shows a warning.
  Trace: `job-spec-agent` with tag `apply-answers`; its cost counts towards the spec / job.
- On approve: status = approved, a Job is created with status `ready_for_sourcing`; Step 2 starts from it
  (Step 2 is built in Phase 2). The cost of every run that led to this spec is counted towards the job.
- On reject: recruiter clicks "Reject and regenerate" (next to Approve spec), which opens a comment box, and
  writes a comment (required). The old version stays, marked `rejected` with the comment;
  the agent regenerates a new draft (linked via `previousSpecId`) using the comment. For a brief with
  several roles, only the rejected role is regenerated; each role is approved separately and becomes its own job.
- No logins in the prototype: whoever uses the app is "the recruiter".

## Guardrails
- Never invent requirements not in the brief or past jobs.
- Never guess a rate without flagging it.
- Output JSON only.

## Edge cases
- Brief describes two roles: create two specs and say so.
- Brief is too vague (under ~30 words): produce a minimal spec, mostly open_questions.
- Contradictions (e.g. "junior" + "8 years"): put in open_questions, don't pick one.

## Cost budget
- Budget: $0.025 per spec (was $0.05; lowered in Phase 1 after 28 runs: single-spec median ~$0.011,
  max ~$0.020). One run can produce several specs (multi-role brief): that run's budget is
  $0.025 x number of specs (max 3). The SDK hard stop is set for the max (3 specs x 3x).
- Max agent turns: 5
- Rationale: One brief, one past-jobs lookup, one JSON output.
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with "Stopped: over budget".
  The recruiter can "Try again" or "Dismiss". A run that fails for another reason (e.g. still invalid
  after the retry) goes to the queue the same way as "Failed: no valid spec".
- These are starting guesses. After the first 10 real runs, set the budget to about 1.5x the median actual cost.
  (Done in Phase 1: about 2x the single-spec median instead of 1.5x, because 1.5x ($0.015) would flag ~1 in 6
  normal runs.)

## Langfuse tracing
- Trace name: `job-spec-agent`
- Tags: `step-1`, `client:<client_id>`
- Metadata: brief_id, job_spec_id (comma-separated when one run produced several specs), model;
  regenerations also carry rejected_spec_id and the tag `regenerate`. Schema retries carry the tag `schema-retry`.
- Scores: `cost_vs_budget` (actual / budget), `approved_without_edits` (0/1), `fields_edited` (count), `rejected` (0/1)
  - `fields_edited` = how many of the 9 spec fields differ from the agent's draft on approve
    (ignoring whitespace and empty lines). Typing answers alone doesn't count; applying them changes fields, which does.
  - Scores go on the trace of the run that produced the spec.

## Acceptance criteria
- [x] All 3 seed briefs produce valid JSON
- [x] Vague brief produces at least 2 open questions
- [x] Spec appears in approval queue; approve/reject both work
- [x] Trace and cost visible in Langfuse

Automated: `npm run test:job-spec` (all test cases + approve/reject + apply answers + runaway). Langfuse dataset: `job-spec-agent`.

## Test cases
1. Clear brief (Senior Python, AWS, remote PL/UA, rate given) -> full spec, 0-1 open questions
2. Vague brief ("need a strong backend dev asap") -> mostly open questions
3. Contradictory seniority -> contradiction listed in open_questions
4. Brief with two roles -> two specs
