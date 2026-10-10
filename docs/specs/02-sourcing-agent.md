# Step 2: Sourcing agent

## Purpose
Find candidates in the mock candidate pool that plausibly match the approved spec.

## Trigger
Job spec status changes to approved: approving a spec creates a job (`ready_for_sourcing`) and Steps 2-4
start automatically in the background. Jobs that existed before Phase 2 have a "Start sourcing" button.
Also re-runs when the recruiter edits the spec from the shortlist screen (Step 4 reject).

## Inputs
- Approved `job_specs` row (title, seniority, must_have, nice_to_have, dealbreakers, location)
- `mock_ats.candidates` (seed pool of 60 profiles)

## Output
Rows in `pipeline` with `stage = sourced` (plus which keywords matched and which run added them).
The agent returns:
```json
{
  "queries": ["string"],
  "candidates": [{ "candidate_id": "string", "matched_on": ["string"] }],
  "duplicates_skipped": 0,
  "broadened": false,
  "note": "string | null",
  "highlights": [{ "title": "string", "text": "string" }]
}
```
`highlights` (added 2026-10-09 for the Jobs page redesign): 0-3 short headlines the recruiter should see at a
glance (e.g. "Broader search · mixed matches", "Location needs checking"): a 2-5 word title and one sentence.
Only facts from the searches. The app saves them on the job with the queries and the duplicate count
(`jobs.sourcingSummary`); the Jobs page shows them as boxes and the queries + full note under "Sourcing details".
Jobs sourced before this change have no headlines (only the note); an answer without `highlights` still passes.
The agent **returns** the list; app code saves it (no `db.add_to_pipeline` tool), so "stopped over budget →
nothing saved" stays true. Before saving, the app re-checks the list against the database: unknown ids are
ignored, anyone already in the pipeline or the same person under another id is skipped, and the cap is applied.

## Model
Sonnet. Writes search queries and judges loose relevance.

## Tools
| Tool | Access | Purpose |
|------|--------|---------|
| mock_ats.search_candidates(queries[], use_location_filter) | read | Keyword search over raw profiles; several queries per call (all keywords in a query must match, "quoted phrases" allowed). The location filter is built by the tool from the spec's location field only. |
| mock_ats.get_pipeline(job_id) | read | Avoid re-adding existing candidates |

## Agent steps
1. Generate 3-5 search queries from the searchable must-haves (synonyms included, e.g. "Postgres" / "PostgreSQL").
2. Run all searches in one tool call; location filter on only if the spec's location names a country or city.
3. Merge results; remove duplicates (same id, or same person under two ids: same email or name) and anyone already in the pipeline.
4. Cap at **20** candidates per run (`SOURCING_MAX_CANDIDATES` in `src/config/budgets.ts`; was 30, lowered in Phase 2 to cut cost).
5. Return the list; the app saves it to the pipeline.

## Human approval
None. Screening (Step 4) has the approval gate.

## Guardrails
- Never filter on age, gender, nationality, or photo.
- Location filter only uses the spec's location field (enforced in code: the tool reads the spec itself;
  it knows Ukrainian and Polish place names in English, Ukrainian and Polish spellings).

## Edge cases
- Fewer than 5 results: broaden queries once (drop nice-to-haves, fewer keywords), note it in the run.
  The note is shown on the Job page (under "Sourcing details"; the headlines sum it up above).
- Zero results: stop and notify recruiter in the approval queue ("No candidates found" → Edit spec / Dismiss).
- Re-run on a job (after a spec edit): adds new candidates only; existing ones stay and are re-screened.

## Cost budget
- Budget: $0.04 per job (was $0.10; set in Phase 2 to ~1.5x the median of the first 10 runs, $0.026)
- Max agent turns: 10
- Rationale: 3-5 queries plus one broadening retry.
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with "Stopped: over budget".
- Job budget: before the run, if the job's total agent cost has reached the job budget, the pipeline pauses (see `04-screening-agent.md`).
- These are starting guesses. After the first 10 real runs, set the budget to about 1.5x the median actual cost.
- Actual so far (9 test runs): $0.021-0.035 per job, 3-4 turns.

## Langfuse tracing
- Trace name: `sourcing-agent`; session `job:<job_id>` (all traces of one job grouped under Langfuse > Sessions)
- Tags: `step-2`, `job:<job_id>`, `client:<client_id>`
- Metadata: `query_count`, `query_1`…`query_N` ("keywords -> N result(s)"), `location_filter` on/off
- Scores: `cost_vs_budget` (actual / budget), `candidates_found`, `later_shortlisted_ratio` (filled at shortlist approval)

## Acceptance criteria
- [x] Each seed spec yields 5-20 candidates (a niche spec may yield fewer after broadening: Rust spec → 5)
- [x] No duplicates in pipeline (also the same person under two ids)
- [x] Queries visible in the Langfuse trace (tool calls + metadata)

Automated: `npm run test:phase2`. Langfuse dataset: `sourcing-agent`.

## Test cases
1. Python/AWS spec -> mostly Python profiles
2. Niche spec (Rust + embedded) -> few results, broadening triggered
3. Rerun on same job -> 0 new duplicates
