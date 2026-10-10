# Phase 4: Langfuse dashboards, scores, and datasets polish

## Purpose
Turn Langfuse from a cost viewer into a quality tracker for this product: check that every agent's scores
arrive, build dashboards on them, and make it possible to test a prompt change against a dataset before
keeping it.

This is not a new agent. It is a consolidation pass over the 6 agents built in Phases 1-3:
`job-spec-agent`, `sourcing-agent`, `enrichment-agent`, `screening-agent`, `outreach-draft`, `reply-classifier`.

## What already exists (not rebuilt)
- One trace per agent run, with cost, tokens and model (Phase 0).
- `cost_vs_budget` on every run, plus the quality scores each spec asks for (Phases 1-3).
- One Langfuse dataset per agent, named after the agent, filled from the spec's test cases by the `test:*` scripts.
- Runs page: cost vs budget, "Over budget only" filter, totals per job and per agent, link to each trace.

## Trigger
Nothing new runs automatically. Commands, run by hand:
- `npm run check:langfuse`: the score audit (below).
- `npm run eval -- <agent>` (or `all`): runs one agent's current prompt over its dataset.
- `npm run setup:dashboards`: (re)creates the Langfuse dashboard.
- `npm run eval:fixtures`: rebuilds the frozen profiles the screening/outreach eval items use (rarely needed).

## 1. Score audit (`npm run check:langfuse`)
- Expected scores per agent live in one config file (`src/config/langfuse-scores.ts`), copied from each spec, each
  marked as expected on every run, on successful pipeline runs, or only after a human action:
  | Agent | Scores |
  |---|---|
  | job-spec-agent | cost_vs_budget, approved_without_edits, fields_edited, rejected |
  | sourcing-agent | cost_vs_budget, candidates_found, later_shortlisted_ratio |
  | enrichment-agent | cost_vs_budget, missing_fields_count |
  | screening-agent | cost_vs_budget, recruiter_agreement, overrides |
  | outreach-draft | cost_vs_budget, approved_without_edits, reply_received |
  | reply-classifier | cost_vs_budget, classifier_correct |
- The script takes every run from `agent_runs` (agent + trace id), reads that trace's scores from Langfuse
  (v3 scores API; the old `/traces` endpoint is refused for our org) and prints, per agent, how many traces
  have each expected score. A missing "every run" score is an error. It also flags:
  - score names not in the config (typos, strays);
  - several runs sharing one trace (every run must have its own trace; eval runs are exempt, see 4).
- Shared traces and old per-test score names from before Phase 4 are reported as "known", not as errors.
- Gaps found and fixed in Phase 4 (details in PROGRESS.md):
  - Runs started from a click in the app shared the web request's trace (Next.js opens one span per request).
    One pipeline put 18 runs into one trace, and Langfuse's charts couldn't connect those runs' scores to
    their agent. Fixed: every run starts its own trace (`src/agents/run-agent.ts`).
  - The `test:*` scripts wrote one score name per test case (`test_passed:<item id>`). Now one name,
    `test_passed`, with the item id as the comment.

## 2. Prompt version on every trace
- Every run's trace gets metadata `prompt_version` = the first 8 characters of a hash (SHA-256) of the system
  prompt the agent sends: the prompt file from `/prompts` after its `{{...}}` placeholders are filled from
  config (sourcing limits, outreach signature). Same text, same version.
- `agent_runs` gets a `promptVersion` column too, shown on the Runs page.
- Prompts stay as files in `/prompts` (not moved into Langfuse Prompt Management).

## 3. Datasets
- Names stay `<agent-name>` (as built). `docs/specs/09-feedback-loop.md` is updated to match.
- Items are defined in code, `src/evals/datasets.ts`: for each item its input, what's expected in plain words, and a
  pass/fail check written in code (e.g. "score 85+", "intent = question", "under 120 words"). No LLM judge.
  The eval runner and the `test:*` scripts both sync these items to Langfuse, so there is one definition.
- Every item is self-contained: seed data is copied into the item (brief text, raw profile), and screening and
  outreach items use enriched profiles frozen in `src/evals/fixtures/profiles.json` (built by `npm run eval:fixtures`
  from the database, or by running enrichment once without saving).
- Items per dataset (eval-runnable + test-only):
  | Dataset | Items | Added in Phase 4 |
  |---|---|---|
  | job-spec-agent | 5 | brief without a budget |
  | sourcing-agent | 4 + 1 test-only (re-run on the same job) | Kotlin spec (few matches), React spec |
  | enrichment-agent | 6 | overlapping dates, protected attributes, Polish profile |
  | screening-agent | 5 | wrong stack (frontend vs Python), niche fit (embedded Rust) |
  | outreach-draft | 6 | Ukrainian profile, middle candidate, follow-up, reply to a rate question |
  | reply-classifier | 7 + 2 test-only (follow-up effects) | "please stop" as its own item |
- Items that need app state stay in the `test:*` scripts only, with metadata `eval: false`.
- Adding recruiter corrections to datasets automatically stays in Phase 5 (spec 09).

## 4. Eval runner (`npm run eval -- <agent>`)
1. Sync the agent's items to Langfuse and load the dataset.
2. Run them with the Langfuse SDK's experiment runner (Langfuse's replacement for "dataset runs"; the old
   dataset-run endpoints are refused or deprecated for our org). The run is named `<prompt_version> <date time>`.
   Each item gets one trace with the agent run inside it (the only case where a run doesn't start its own trace).
3. Each item's check records `eval_passed` (0/1, with the details as comment) on the item's trace.
4. Print pass/fail per item (and the agent's output when an item fails), total cost and the Langfuse link.
- Nothing is saved to the app's jobs, candidates, specs, messages or approval queue.
- Step 9 (docs/specs/09-feedback-loop.md): the runner moved to `src/evals/run.ts` (used by `npm run eval` and the weekly job)
  and also runs the agent's checkable recruiter corrections (screening overrides, corrected reply intents) from
  `dataset_corrections`. New dataset `feedback-weekly-summary` (5 items).
- Comparing two prompt versions: run eval, edit the prompt file, run eval again, then open the dataset in
  Langfuse and compare the two runs side by side.
- Eval runs are real agent runs: logged in `agent_runs` (`isEval`), with tag `eval` and no job. Langfuse puts
  them in its own environment, `sdk-experiment`. The Runs page hides them unless "Show eval runs" is clicked.

## 5. Langfuse dashboards
- Defined in code (`scripts/langfuse/setup-dashboards.ts`, `npm run setup:dashboards`) with Langfuse's dashboard API
  (marked "unstable" by Langfuse). Re-runnable: it replaces the dashboard and the widgets it made before.
- One dashboard, "Hireloop agents", with 7 widgets:
  1. Cost per agent over time.
  2. Total cost per agent. (Replaces "cost per job": Langfuse can't group charts by session, and grouping by
     tag mixes all tags. Cost per job is on Langfuse's Sessions page, one session per job, and on the Runs page.)
  3. Over-budget runs per agent: count of `cost_vs_budget` above 1 (more reliable than the `over-budget` tag).
  4. Typical cost vs budget per agent: median of `cost_vs_budget` (a few runaway tests skew the average).
  5. Approved without edits, per agent (job-spec, outreach-draft).
  6. Screening: recruiter agreement over time.
  7. Reply classifier: share marked correct.
- All widgets show real use only: runs tagged `eval` or `test` are left out, and only the 6 agents above.
- Known limit: quality scores from runs started in the app before the Phase 4 trace fix don't show in the
  charts (Langfuse can't connect them to their agent). Cost charts include them; the Runs page table too.

## 6. Runs page
- "Prompt" column with each run's prompt version (and an "eval" badge on eval runs).
- "Show eval runs (N)" / "Hide eval runs" toggle; eval runs are hidden by default, also from the totals.
- The runs table shows the newest 50 runs, with "Showing X of Y runs" and a "Load N more" button that adds 50 at a
  time (kept in the URL as `?limit=`; changing a filter starts again at 50). Only the shown rows are loaded; the
  totals per agent and per job are added up by the database over all runs, so they don't depend on how many are shown.
  (Added 2026-10-08.)
- "Quality per agent" table under the totals, from the app's own database, same rules as the Langfuse scores,
  so recruiters don't need a Langfuse login:
  | Agent | Measure | Counted per |
  |---|---|---|
  | job-spec-agent | approved without edits | decided spec (rejected = 0) |
  | screening-agent | recruiter agreement (top 10 kept) | shortlist approval (job) |
  | outreach-draft | approved without edits | decided draft (rejected = 0) |
  | reply-classifier | classification correct | reply the recruiter reviewed |
- Layout (2026-10-09, new design): four summary tiles (runs, agent spend, over budget, failed) above the runs
  table; the table, totals per agent, totals per job and quality are numbered white cards (01-04). The model column
  shows Haiku / Sonnet / Opus (full model name on hover); % budget has a small bar.
- Recruiter agreement is now saved on the job (`jobs.recruiterAgreement`) at shortlist approval; the two jobs
  shortlisted before Phase 4 were filled in once from their Langfuse scores.

## Model
None new. Eval runs use each agent's own model from `src/config/models.ts`.

## Human approval
None. You review the dashboard, the audit output and one eval comparison at the end of the phase.

## Guardrails
- Eval runs never change jobs, candidates, specs, messages or the approval queue.
- Eval runs never affect any job's budget (they have no job).
- No keys in code; the scripts use the existing Langfuse keys from `.env.local`.

## Edge cases
- Dashboard API refused or changed: fall back to building the 7 widgets by hand (the script lists them).
- Langfuse data can lag up to a minute: the test waits and retries before reading back.
- An eval item whose agent errors or hits the runaway stop: counts as failed, with the reason printed.
- Model variance: an eval item can fail on one run and pass on the next (seen once with an outreach draft that
  used only spec terms). Look at the printed output before changing a prompt.

## Cost budget
- Audit, dashboards, Runs page table: $0 (no model calls).
- One eval pass over all 6 agents (33 items): ~$0.35 (sourcing and screening are most of it).
- Each eval run uses that agent's normal per-run budget and over-budget rules.
- Phase 4 total including a two-version comparison: expected under $1.00.

## Langfuse tracing
- Eval traces: one per dataset item (root span `experiment-item-run`, environment `sdk-experiment`) with the
  agent's run inside; tags `eval`, `step-N`; metadata `prompt_version`.
- New score: `eval_passed` (0/1), on eval traces only. `test_passed` (0/1) on test-script traces.
- All traces: metadata `prompt_version`.

## Acceptance criteria
- [x] `npm run check:langfuse` lists every agent with its expected scores, and there are no unexplained gaps
- [x] Every new trace has `prompt_version`; the Runs page shows it
- [x] Each of the 6 datasets has at least 5 items, each with a code check
- [x] `npm run eval -- <agent>` works for all 6 agents and creates a run (experiment) in Langfuse
- [x] Two prompt versions of one agent can be compared side by side in Langfuse
- [x] "Hireloop agents" dashboard shows its widgets with real data (built by script)
- [x] Runs page has the quality table and the eval runs toggle
- [x] `docs/specs/09-feedback-loop.md` dataset names updated

## Test cases (`npm run test:phase4`)
1. Audit on current data -> every agent found, no problems.
2. One enrichment run -> its trace has `prompt_version` equal to the hash of its prompt; runs started inside an
   outer span (like a click in the app) still get their own traces.
3. `npm run eval -- reply-classifier` -> experiment created with every item, `eval_passed` on each trace,
   nothing new in messages, approval queue or jobs.
4. Change one character in a prompt -> new `prompt_version`.
5. Runs page quality numbers equal the averages of the matching Langfuse scores for the same decisions.
Plus: every dataset has 5+ items; the dashboard exists with its 7 widgets.
