# Step 3: Enrichment agent

## Purpose
Turn raw profile text into clean structured fields that screening can compare fairly.

## Trigger
New candidates added to pipeline at stage `sourced` (runs right after sourcing, 5 candidates at a time).
A candidate who already has a profile (e.g. from another job) is not enriched again: raw profiles don't change.

## Inputs
- Raw profile text for each candidate from `mock_ats.candidates` (put directly in the prompt)

## Output
Saved to `candidate_profiles` (one per candidate).
```json
{
  "candidate_id": "string",
  "current_title": "string | null",
  "years_experience": "number | null",
  "skills": ["string"],
  "recent_stack": ["string"],
  "location": "string | null",
  "english_level": "string | null",
  "contacts": { "email": "string | null", "linkedin": "string | null" },
  "job_history": [{ "title": "string", "company": "string", "start": "YYYY-MM | YYYY", "end": "YYYY-MM | YYYY | present", "part_time": false }],
  "key_facts": ["string"],
  "missing_fields": ["string"]
}
```
Added in Phase 2:
- `job_history`, so the **app** computes `years_experience` (overlapping periods counted once). Models are
  unreliable at date arithmetic.
- `key_facts` (up to 6 hiring-relevant facts, e.g. "never used AWS commercially"), so screening never needs
  the raw text, which can contain protected attributes.
- The app recomputes `missing_fields` from the empty fields (`contacts.email`, `contacts.linkedin`, ... and
  `contacts` when both are empty), so the list is consistent.

## Model
Haiku, with "thinking" switched off (`THINKING_OFF` in `src/config/models.ts`). Pure extraction, high volume, cheap.
With thinking on (the Agent SDK default) a profile cost ~$0.03; with it off ~$0.004.

## Tools
None. The raw profile goes straight into the prompt (saves a turn), and the app saves the result
(no `db.save_profile` tool, so "stopped → nothing saved" stays true).

## Agent steps
1. Read raw profile.
2. Extract fields; normalize skill names (e.g. "JS" -> "JavaScript").
3. List job history with dates (the app calculates years of experience from it).
4. List anything not found in missing_fields.
5. Return the profile; the app saves it.

## Human approval
None.

## Guardrails
- Never infer fields that aren't in the text (e.g. don't guess English level).
- Never store protected attributes (age, family status, religion).

## Edge cases
- Profile in Ukrainian or Polish: extract anyway, output in English.
- Overlapping job dates: count overlap once (done in app code).
- A run that fails or goes over 3x budget: that candidate is skipped; one grouped item per job goes to the
  approval queue ("Try again" re-runs only the missing profiles).

## Cost budget
- Budget: $0.006 per candidate (was $0.005; set in Phase 2 to ~1.5x the median of 22 runs, $0.0041)
- Max agent turns: 3
- Rationale: Haiku, single extraction pass.
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with "Stopped: over budget" (one item per job, however many candidates).
- These are starting guesses. After the first 10 real runs, set the budget to about 1.5x the median actual cost.
- Actual so far (thinking off, 22 runs): $0.0023-0.0050 per candidate, median $0.0041.

## Langfuse tracing
- Trace name: `enrichment-agent`; session `job:<job_id>`
- Tags: `step-3`, `job:<job_id>`
- Metadata: `candidate_id`, `profile_language`
- Scores: `cost_vs_budget` (actual / budget), `missing_fields_count`

## Acceptance criteria
- [x] All sourced candidates get a profile
- [x] Cost per profile visible and low (Haiku)
- [x] Non-English seed profiles handled (Ukrainian and Polish)

Automated: `npm run test:phase2`. Langfuse dataset: `enrichment-agent`.

## Test cases
1. Complete English profile -> 0 missing fields
2. Ukrainian-language profile -> English output
3. Profile without contacts -> contacts null, listed in missing_fields (since 2026-10-09 every seed CV has an email: the
   eval uses cand-009 with its email line removed)
