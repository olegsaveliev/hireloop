# Step 7: Submission agent

## Purpose
Build a polished candidate profile in the Hireloop format, ready for the account manager to send.

## Trigger
- Pre-screen recommendation is `proceed` (and the recruiter hasn't said "Don't submit"): starts automatically.
- Recruiter clicks **Prepare submission** on the Job page (any recommendation) or on a "Review pre-screen" queue item.
- In the app, these clicks (and **Save rate**, and candidate replies read from Gmail) start the job's Steps 5-7 run in the background.
  It does only the missing work: questions, summaries, drafts, failed redrafts. **Try again** / **Continue** in the
  queue resume it.

## Inputs
- Candidate profile (Step 3, without name or contacts), screening result (must-haves met, reasons), pre-screen
  answers + availability + summary (not the red flags: internal).
- Role: title, seniority, must-haves, nice-to-haves.
- The one Hireloop format, `SUBMISSION_FORMAT` in `src/config/submission.ts` (`anonymized`, `tone`, `fields`, `notes`):
  named, all six fields, any currency. **Changed 2026-10-09:** clients no longer have their own templates
  (`clients.submissionFormat` is unused); every client gets this format. Before, Brightline wanted USD per hour and
  Haldor anonymized profiles in EUR per hour.
- The confirmed rate: the pre-screen's `rate_expectation`, or the rate the recruiter typed.

## Output
Saved to `submissions` with `status = awaiting_approval`. Every draft is a row:
`awaiting_approval` → `sent` | `rejected` (redrafted) | `withdrawn`.
```json
{
  "candidate_id": "string",
  "client_id": "string",
  "headline": "string",
  "summary": "string",
  "key_skills": ["string"],
  "experience_highlights": ["string"],
  "highlight_sources": ["string"],
  "rate": "string",
  "availability": "string",
  "anonymized": true
}
```
- `highlight_sources` (added): one short exact quote from the source data per highlight, so every claim can be traced.
  Shown to the account manager, never to the client.
- The app sets `rate` (= the confirmed rate), `anonymized` (from the format: false), `candidate_id` and `client_id`;
  the agent's values are ignored.
- The name is never written by the agent; the app adds it above the profile. (If the format is ever switched to
  `anonymized: true`, profiles show "Candidate NW-<id>" instead; older anonymized submissions still do.)

Rendered as a one-page HTML preview (`/submissions/<id>`), generated on demand from the database (no files written
to disk). It shows only the format's fields, in the app's look (numbered sections, skill chips, Rate and
Availability boxes); printing hides the buttons and card border. For a PDF, use **Print / save as PDF** (the browser's print dialog).

## Model
Sonnet.

## Tools
None for the agent (same decision as Steps 5-6). App code:
| Function | Access | Purpose |
|------|--------|---------|
| `SUBMISSION_FORMAT` (`src/config/submission.ts`) | read | The one Hireloop format |
| `submissions` table | write | Store drafts |
| mock_inbox.sendToClient (`src/agents/tools/mock-inbox.ts`) | write | Only after approval, only once per submission |

## Agent steps
1. Load the Hireloop format.
2. Write profile using only verified facts from profile + screening + pre-screen.
3. Anonymize only if the format says so (off since 2026-10-09; would remove name, contacts, and all employer names,
   described generically, e.g. "a Polish fintech").
4. Save draft for approval.

App checks on every draft (failed = invalid output -> one retry):
- every field of the format filled;
- each key skill appears in the source data;
- one highlight source per highlight, and each one is found in the source data;
- every number (years, %, counts) appears in the source data;
- if anonymized: no name, email, phone, LinkedIn or employer name.

## Human approval
- Who approves: account manager. One queue item per candidate: **"Send to client: <name> · <job>"** (Step 7,
  labelled "Account manager").
- What they see: the draft (left) next to the source data (right):
  - profile with job history and key facts;
  - screening score and reasons;
  - pre-screen answers, red flags and the confirmed rate;
  - where each highlight comes from;
  - a link to the one-page preview.
- What they can edit: every field of the format.
- Screen (**Send to client**, `/approvals/submission/<id>`, from the mockup 2026-10-09): title, candidate name with
  status tag, client · job, "Edit the profile before account manager approval…". A card with the candidate and "To client · <contact>", and a **PDF icon** that opens the client's view of the
  profile with the print dialog (Save as PDF, `?print=1`); there is no separate Preview button. Left: **Client-facing profile** (Editable draft) in numbered sections
  01 Introduction (headline, summary), 02 Skills & experience, 03 Rate & availability (side by side); footer
  **Don't submit**, **Reject…**, lime **Approve and send to client**. Right, on the page background: **Internal
  reference · not sent** (title, years · location, English, stack chips, folded "Experience & skills" and "Key
  facts"), **Screening · Step 4**, **Pre-screen · Step 6**.
- On approve:
  - if anonymized, the anonymization check runs again on the edited text (typing the employer in is refused);
  - sent to the client contact (the brief's sender) via mock_inbox, as an email with the profile;
  - stage = submitted;
  - counts as the recruiter's "submit" if they hadn't decided.
- On reject: comment -> redraft (the old one is kept as `rejected`).
- **Don't submit**: nothing is sent; saved as the recruiter's call ("don't submit"), and no new draft is made.

## Guardrails
- Never exaggerate experience or add skills not in the profile.
  - Prompt: no seniority upgrades, no rounding up, no invented scale or impact, no gendered pronouns.
  - Code: skills and numbers must be in the source data; every highlight has a source quote.
- Anonymization must remove all contact details.
  - The agent never sees name or contacts.
  - Code checks the agent's draft and the account manager's edits.
- Only `sendToClient` sends a submission, only for one awaiting approval, and only once (a double click can't send twice).

## Edge cases
- Client template missing: no longer applies (one format for every client since 2026-10-09).
- Rate not confirmed: block submission, ask recruiter.
  - "Not confirmed" = no rate in the pre-screen, or no amount in it ("negotiable"). The format's notes could ask for
    a currency/period ("Rate as EUR per hour"); the Hireloop format doesn't, so any currency is fine.
  - A **"Rate needed: <name>"** item appears in the approval queue with a rate box. A rate without an amount is
    refused with the reason; a valid one is saved as the confirmed rate, and the profile is drafted.
- Client has no email (2026-10-10; e.g. a brief pasted without sender email): nothing is sent. The profile goes to the
  client's email from the Clients page, else the brief sender's email; with neither, **Approve and send to client** is
  switched off, the page says "Can't send yet: <client> has no email" with a link to Clients, and the server refuses too.
- Two runs at once (double click): a claim on the pre-screen row makes sure only one draft is written.
- Job budget reached: drafting waits for **Continue**.
- Failed/stopped run: "Failed / Stopped" queue item (Step 7). **Try again** redoes the missing draft.

## Cost budget
- Budget: $0.025 per submission (lowered from $0.04 after Phase 5: 28 runs, median $0.017, max $0.022)
- Max agent turns: 5
- Rationale: One draft plus one redraft.
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with "Stopped: over budget".
- First runs (Step 7 build, 2026-10-07): $0.016-0.022 per draft, no schema retries, none over budget. After 10 real
  runs, set the budget to about 1.5x the median actual cost.

## Langfuse tracing
- Trace name: `submission-agent`; metadata `anonymized`, `mode` = draft | redraft
- Tags: `step-7`, `client:<client_id>`, `job:<job_id>` (added for consistency), `redraft`; the job's session `job:<id>`
- Scores:
  - `cost_vs_budget` (actual / budget);
  - `approved_without_edits` (0/1; 0 on reject or any edit);
  - `client_accepted_for_interview` (0/1, filled in Step 8).
- Dataset `submission-agent` (`src/evals/datasets.ts`, 4 items; the two TC1 anonymized items were removed 2026-10-09):
  - TC3 Brightline;
  - another client (Kestrel);
  - no seniority upgrade for a middle developer;
  - redraft after a comment.

  `npm run eval -- submission-agent` (~$0.11).

## Acceptance criteria
- [x] Anonymized output contains no name/email/phone/employer (checked in code on drafts and on account manager edits;
  dormant since 2026-10-09, the one format is named; the check stays unit-tested)
- [x] Every claim traceable to source data (a source quote per highlight, skills and numbers checked against the source)
- [x] AM approval sends and moves stage (mock inbox message to the client contact, stage submitted, no double send)

## Test cases
`npm run test:phase5` (Step 7 part) and the `submission-agent` dataset.
1. ~~Anonymized client -> no identifying details~~ (retired 2026-10-09: one named format for every client)
2. Missing rate -> blocked with message ✓ (a rate without an amount is refused; a typed rate unblocks it)
3. Every field of the Hireloop format filled ✓
