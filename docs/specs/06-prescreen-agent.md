# Step 6: Pre-screen agent

## Purpose
Collect key answers from interested candidates and summarize them so the recruiter doesn't need a first call.

## Trigger
- Reply classified as `interested` (Step 5): questions are written right away as a **draft** and sent after the
  recruiter approves them (changed 2026-10-08, see Human approval). This replaces the "propose a short call"
  suggested reply Step 5 used to draft (specs/05).
- **Start pre-screen** button on the Job page: any candidate at stage `replied` without a pre-screen (e.g. replied
  before Phase 5, or with a `question` the recruiter wants to follow up with a pre-screen).
- After the questions, every message from the candidate is treated as answers (summarized, never sent to the
  reply classifier). More answers later -> the summary is re-done with everything. Once the client asks for an
  interview (Step 8), the candidate's messages are about times instead (read by the scheduling agent).
- Answers come from the candidate's reply in Gmail (**Check replies**; specs/12). The **Simulate answers** form was
  removed on 2026-10-09; its 3 sample answer sets (full, rate 40% over range, only 2 answers) are now used by the
  automated tests only (`scripts/tests/sample-replies.ts`).

## Inputs
- Job spec: title, seniority, must-haves, nice-to-haves, dealbreakers (to check, never quoted), location, rate.
  Not the client's name (guardrail). Not `open_questions`: those are questions for the client, not the candidate.
- Candidate profile (structured, Step 3; no contacts) + thread history.
- Summary task: also the questions sent, in order.

## Output
One agent, two tasks (one prompt file, `prompts/prescreen-agent.md`; the task is named in the user message).

Questions (sent by the app in a fixed email template: "Hi <first name>," + intro + numbered questions + signature + opt-out line):
```json
{
  "candidate_id": "string",
  "first_name": "string (Latin letters)",
  "questions": [{ "question": "string", "topic": "must_have | rate | availability | notice_period | other", "about": "spec item it checks" }]
}
```
App checks (invalid -> one retry):
- 3-5 questions;
- at least one `rate`, one `availability`/`notice_period`, one `must_have`;
- no protected topic.

Summary, saved to `prescreens` (one row per candidate per job):
```json
{
  "candidate_id": "string",
  "answers": [{ "question": "string", "answer": "string | null" }],
  "rate_expectation": "string | null",
  "availability": "string | null",
  "red_flags": ["string"],
  "recommendation": "proceed | discuss | stop",
  "summary": "3-4 sentences"
}
```
- `answer: null` = not answered. The app lists those as missing ("partial answers" edge case).
- One entry per question asked (checked).
- No protected topic in `summary` or `red_flags` (checked).

## Model
Sonnet.

## Tools
None for the agent (same decision as Step 5): it gets everything in the prompt and saves nothing. App code does:
| Function | Access | Purpose |
|------|--------|---------|
| messages draft (kind `prescreen`) + mock_inbox.send (`src/agents/tools/mock-inbox.ts`) | write | The questions email, sent only after approval on the send screen (through Gmail when set up, specs/12); never to a `declined` candidate |
| mock_inbox.getThread | read | Read answers |
| `prescreens` table (`src/agents/prescreen/workflow.ts`) | write | Store questions, summary, the recruiter's call |

## Agent steps
1. Generate 3-5 questions:
   - the least clearly shown must-have (often "B2B contract" when the profile proves the tech);
   - rate (without quoting the range);
   - availability / notice period;
   - optionally something the spec requires, like time-zone overlap or on-site visits.
2. Save the questions email as a draft (status `questions_draft`); it is sent when the recruiter approves it
   (status `questions_sent`). Until 2026-10-08 it was sent with no approval.
   - The Job page's Step 6 box shows which: "questions draft" (waiting for your approval) or "questions sent"
     (waiting for answers). Before 2026-10-10 it said "questions sent" for both.
3. When answers arrive, summarize and flag mismatches with the spec.
   - App rule on top: if the stated rate is more than 15% above the top of `rate_range` (same currency and period),
     the app adds a red flag if missing and turns `proceed` into `discuss`. The 15% is in `src/config/prescreen.ts`.
4. Stage = prescreened (Job page: sourced → shortlisted → contacted → replied → **prescreened** → submitted → interview).

## Human approval
- **Sending the questions** (since 2026-10-08, asked for after the first real-Gmail walkthrough: the questions go
  out in the recruiter's name and may need adjusting):
  - The draft appears on the existing **Send outreach** screen (approval queue → **Review drafts**), labelled
    "Pre-screen questions", next to Step 5 drafts. No 120-word limit for this kind.
  - **Approve and send** (edits allowed) → sent; the pre-screen waits for answers. Score `approved_without_edits`
    on the questions trace.
  - **Reject…** with a comment → the agent writes new questions following the comment (tag `redraft`); the old
    draft stays `rejected`.
  - The candidate writes again before the questions are sent → the draft is cancelled and the pre-screen removed;
    the new message is classified as usual (an `interested` one drafts fresh questions).
  - Note: answers are summarized against the agent's question list. If you add a question while editing, the
    summary still sees it in the thread, but it doesn't count towards `answers_completeness`.
- The summary shows on the Job page with **Prepare submission** / **Don't submit**. That's the recruiter's call;
  Step 7 picks up "submit".
- `discuss` also puts a **"Review pre-screen: <name>"** item in the approval queue (Step 6) with the same two
  buttons. Deciding closes it.
- `proceed` and `stop` don't add a queue item; both show on the Job page. `proceed` starts the Step 7 submission
  automatically (unless the recruiter clicks **Don't submit** first).
- Step 7 also records the call: the account manager approving a submission = submit; **Don't submit** on the
  submission screen = don't submit (scored against `proceed`).

## Guardrails
- No questions about age, family, health, religion, or nationality.
  - In the prompt, and checked in code on every question, summary and red flag (`src/config/prescreen.ts`
    PROTECTED_TOPICS; narrow word lists so "race condition", "Kvitka Health" or "Poland" pass).
  - Personal details the candidate volunteers are ignored and never repeated.
- Recommendation must be based on spec criteria only.
- The client is never named (the agent never sees the name).
- Nothing is sent to a candidate who said no.

## Edge cases
- Partial answers: summarize what's there, list missing items (`answer: null`). Later answers -> re-summarized.
- Rate far above range (>15%): red flag, recommendation = discuss (enforced in code too).
- Rate in a different currency or period than `rate_range`: the code can't compare it; left to the agent.
- Candidate says no after the questions: summarized like any answer (`stop`).
- Job budget reached: questions or summary wait; **Continue** in the approval queue resumes them.
- A failed or stopped run -> "Failed / Stopped" item (Step 6). **Try again** redoes only the missing work.

## Cost budget
- Budget: $0.02 per candidate (lowered from $0.03 after Phase 5: 76 runs, median $0.013, max $0.022). Two runs per candidate (questions, summary); each run is checked against $0.02.
- Max agent turns: 6
- Rationale: Questions + one summary.
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with "Stopped: over budget".
- First runs (Step 6 build, 2026-10-07): $0.004-0.022 per run, typically ~$0.012, so ~$0.025 per candidate for both
  runs. None over budget. After 10 real runs, set the budget to about 1.5x the median actual cost.

## Langfuse tracing
- Trace name: `prescreen-agent`, metadata `mode` = questions | summary
- Tags: `step-6`, `job:<job_id>`, `client:<client_id>`; the job's session `job:<id>`
- Scores:
  - `cost_vs_budget` (actual / budget), every run;
  - `answers_completeness` (0-1, answered / asked), on summary runs;
  - `recruiter_agreed_with_recommendation` (0/1), when the recruiter decides on a `proceed` or `stop`:
    agree = submit for proceed, don't submit for stop. `discuss` hands the call to the recruiter, so there's no score.
- Dataset `prescreen-agent` (`src/evals/datasets.ts`, 7 items):
  - 3 question sets: strong candidate, Ukrainian profile, Rust spec with no rate;
  - TC1-3;
  - volunteered personal info.

  `npm run eval -- prescreen-agent` (~$0.09).

## Acceptance criteria
- [x] Questions are specific to the spec, not generic (each set has a must-have question naming the spec)
- [x] Summary flags rate mismatch correctly ($91/hr vs $55-65/hr flagged "about 40% above"; $60/hr not flagged)
- [x] No prohibited questions in any output (checked in code on every output; 19 questions/summaries/flags in the test)

## Test cases
`npm run test:phase5` (Step 6 part, ~$0.12) and the `prescreen-agent` dataset.
1. Full answers, rate in range -> proceed ✓
2. Rate 40% over range -> discuss + red flag ✓
3. Only 2 of 4 answers -> missing items listed ✓ (and completeness 1 after the rest arrive)
