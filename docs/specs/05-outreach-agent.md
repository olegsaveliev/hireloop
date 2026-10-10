# Step 5: Outreach agent

## Purpose
Write personal first messages and follow-ups to shortlisted candidates, and sort their replies.

## Trigger
- First messages: shortlist approved (job status `shortlisted` -> `drafting_outreach`, runs in the background).
  Jobs shortlisted before Phase 3 get a "Draft outreach" button on the Job page.
- Reply classification: a new reply arrives from Gmail (**Check replies** on the Job page, or **Check Gmail** on
  Briefs; specs/12). The "Simulate reply" form was removed on 2026-10-09; the seeded replies are used by tests only.
- Follow-ups: the "Run follow-ups now" button on the Job page (see Agent steps).

## Inputs
- Approved job spec: title, seniority, must-haves, nice-to-haves, location, rate_range, selling points.
  Not the client's name (see Guardrails), dealbreakers or open questions.
- Candidate's structured profile (Step 3; email used only by the app for sending) + screening reasons (Step 4)
- Previous messages in the thread (for follow-ups, reply drafts and redrafts)
- Everything goes into the prompt; the agents need no tools (same decision as Steps 3-4: saves turns).

## Output
Drafts saved to `messages` with `status = awaiting_approval`.
```json
{
  "candidate_id": "string",
  "subject": "string",
  "body": "string",
  "personalization_hooks": ["string"],
  "sequence_step": 1
}
```
- `sequence_step`: 1 = first message, 2 = follow-up 1, 3 = follow-up 2. Set by the app.
- App-side checks (a failure counts as invalid output, so the run is retried once): body under 120 words,
  at least one personalization hook, the client's name not mentioned.
- The opt-out line is added by the app under every outbound message (not written by the agent, not counted
  in the 120 words, not editable).

Reply classification:
```json
{
  "intent": "interested | not_interested | question | later | out_of_office",
  "summary": "string",
  "suggested_reply": "string | null",
  "return_date": "YYYY-MM-DD | null"
}
```
- `return_date` (added in Phase 3): out of office = the date they're back; later = when they asked to be
  contacted again. Otherwise null.
- `suggested_reply` is forced to null for `not_interested`, `out_of_office` and (since Phase 5) `interested` (app code).

## Model
Sonnet for drafting (first messages, follow-ups, redrafts after a reject). Haiku for classifying replies
and writing the suggested reply (thinking off).

## Tools
The agents get no tools (inputs are in the prompt). The app does the writes:
| Function (app code) | Purpose |
|------|---------|
| mock_inbox.send(message) | Only from the approve action (the only code that sets `sent`) |
| mock_inbox.get_thread(candidate_id) | Thread for follow-ups, replies and the UI |
| mock_inbox.receive(reply) | Saves an inbound reply (from Gmail) |
| update stage | contacted / replied / declined |
Later the mock_inbox functions are swapped for Gmail (see docs/hosting.md).

## Agent steps
1. Draft message: under 120 words, one specific hook from the profile, one clear ask. English for every
   candidate (also Ukrainian/Polish profiles). Signed by the sender in `src/config/outreach.ts` ("Anna, Hireloop").
2. Save draft for approval.
   - Candidates with no email in their profile get no draft: they stay `shortlisted`, are marked
     "No email: contact manually" (with LinkedIn if known) on the Job page and the send screen. (Since 2026-10-09
     every seed candidate has an email; the rule stays for real CVs without one.)
3. After send: stage = contacted; a follow-up is due 3 days after the last message if no reply (max 2 follow-ups).
   Prototype: nothing runs on a timer locally, so a "Run follow-ups now" button on the Job page drafts
   all due follow-ups (they still go through send approval). Follow-ups are due only after 3 real days (the
   "Pretend 3 days have passed" checkbox was removed on 2026-10-09).
   Hosted version: Trigger.dev delayed task (see docs/hosting.md).
4. On reply: classify intent, update stage, draft suggested reply if needed (goes through send approval).
   Any pending drafts for that candidate are cancelled (the reply makes them stale).
   | Intent | Stage | Follow-ups | Suggested reply |
   |---|---|---|---|
   | interested | replied | stop | none: Step 6 sends pre-screen questions right away, no approval (Phase 5; was "propose a short call") |
   | question | replied | stop | yes: answers only from the spec |
   | later | replied | stop, note "re-contact from <date>" | yes: short thanks |
   | not_interested | declined | stop for good | none |
   | out_of_office | stays contacted | paused until return_date (7 days if no date) | none |

## Human approval
- Who approves: recruiter (all sends in prototype)
- What they see: draft + candidate profile + why they were shortlisted (score and screening reasons);
  for replies, the candidate's message and the classified intent
- What they can edit: subject and body; bulk-approve option ("Approve and send selected")
- Screen (**Review outreach**, `/approvals/outreach/<job>`, redesigned from the mockup 2026-10-09): one card per draft
  with the candidate's name and the address it goes to, the draft type ("First message", "Follow-up 1 of 2"…),
  Subject and Message (word count "81 words · under 120"), the opt-out line in a grey "Added automatically · excluded
  from word count" box, and on the right **Candidate context** (title, years · location, recent stack), **Why
  shortlisted** (score + first sentence, the rest under "Full screening reasons"), **Personalized with** (the hooks)
  and the recruiter's shortlist note. Footer: **Reject…** and lime **Approve and send**.
- An address not on the send allow-list (specs/12) shows a "Can't be sent from the app" box and Approve is disabled
  for that draft. (The mockup's "Test redirect active" box was left out: there is no redirect since 2026-10-09.)
- Job page (redesigned 2026-10-09): each shortlisted candidate is one card with name, title · years · location, email,
  score and stage, then a **Next** line saying what is waiting and who acts (e.g. "Approve the first message" with a
  **Review draft** link, "Waiting for their reply · Follow-up 1 due …"). The pre-screen, interview and outcome boxes stay
  in the card. **Why shortlisted** (reasons + profile) and **Conversation** (all messages, ours left, theirs right; long
  ones cut with "Show full"; a draft shows two lines and a link to Review outreach) are folded; the conversation opens
  by itself when the latest reply still needs the Correct/Wrong check. Candidates not shortlisted are listed under
  **Not shortlisted (N)**, folded (open when nobody is shortlisted yet).
- On approve: message sent via mock_inbox
- On reject: recruiter comment -> agent redrafts (Sonnet; no limit on how many times, each redraft is its own run)
- One approval queue item per job ("Send outreach: <job>"), open while any draft for that job is waiting.
- Classification check: on the Job page each classified reply has "Correct" / "Wrong" buttons. "Wrong" lets the
  recruiter pick the right intent; the stage and follow-up rules are re-applied with it.

## Guardrails
- Never claim facts about the client that aren't in the spec.
- Never name the client (agreed in Phase 3): say e.g. "a fintech client". Checked in code.
- Never send without approval. (This applies to outreach. Steps 6 and 8 send templated messages
  without approval by design; see their specs.)
- Stop all follow-ups once candidate says no or asks to stop.
- Once a final outcome is recorded (Step 9), the candidate's replies are saved but not classified (no agent reads them).
- Include an opt-out line (added by the app, text in `src/config/outreach.ts`).

## Edge cases
- Candidate asks about rate: suggested reply uses spec's rate_range only. If rate_range is empty, it says the
  recruiter will confirm. Any money amount in a suggested reply that isn't in rate_range shows a warning on the
  send screen.
- Questions the spec can't answer (e.g. "B2B or employment?" when the spec doesn't say): the reply says the
  recruiter will check, never guesses.
- Out of office: pause follow-ups until return date.
- Job budget hard stop: checked before every Step 5 agent run, like Steps 2-4. A reply that arrives while the
  job is paused is saved and classified after "Continue".

## Cost budget
- Budget: $0.015 per draft ($0.003 per reply classification). Changed in Phase 3 review from $0.02 / $0.002.
- Max agent turns: 4
- Rationale: Short message, one redraft allowed.
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with "Stopped: over budget".
- These are starting guesses. After the first 10 real runs, set the budget to about 1.5x the median actual cost.
- Actual (Phase 3, first runs): drafts median $0.0085 (17 runs, $0.007-0.014); classification median $0.0021
  (10 runs, $0.0018-0.0035): half of the classifier runs were above $0.002. Applied after review: $0.015 per draft
  (none of the 17 flagged) and $0.003 per classification (1 of 10 flagged). Runaway stops: $0.045 and $0.009.

## Langfuse tracing
- Trace names: `outreach-draft`, `reply-classifier`
- Tags: `step-5`, `job:<job_id>` (+ `client:<id>`); session `job:<job_id>`
- Metadata: candidate_id, mode (first / follow_up / reply / redraft), sequence_step
- Scores:
  - `cost_vs_budget` (actual / budget), on every run;
  - `approved_without_edits` (0/1), on the draft's trace when approved (0 if edited) or rejected (0);
  - `reply_received` (0/1), on the sent message's trace: 0 when sent, set to 1 when a real reply arrives
    (an out-of-office reply doesn't count);
  - `classifier_correct` (0/1), on the classifier trace, set by the recruiter's Correct / Wrong click.

## Acceptance criteria
- [x] Drafts reference something specific from each profile
- [x] Nothing is sent without approval
- [x] All seeded reply types classified correctly
- [x] Follow-ups stop on "not interested"

## Test cases
1. Strong candidate -> personalized draft under 120 words
2. Reply "how much does it pay?" -> intent question, reply uses rate_range
3. Reply "please stop" -> not_interested, no more follow-ups
4. Out-of-office reply -> follow-ups paused
