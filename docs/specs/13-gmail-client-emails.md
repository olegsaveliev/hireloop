# Steps 7-8 v2: Gmail for client emails (submission, interview times, client replies)

Status: BUILT 2026-10-08 (approved "go with AI hint"). Automated tests pass with a fake Gmail; the real-Gmail walkthrough
with Mykola is next.

## Purpose
The account manager's emails to the client go through the recruiter's real Gmail, and the client's replies are read
from Gmail, so Steps 7-8 can be worked like in real life. Follows spec 11 (briefs) and spec 12 (candidate emails).

## What changes (and what doesn't)
- Agents, prompts, approvals, budgets: **unchanged**. No new AI runs.
- `src/agents/tools/mock-inbox.ts` stays the one place that sends. Client kinds now also go through Gmail:
  - Step 7 **submission** (after the account manager's **Approve & send**, as today);
  - Step 8 **scheduling_client** emails (asking the client to confirm a time, confirmation, reminders: no click,
    as today).
- **Recipient:** the client contact = the brief's sender (as today). For a client added by email that's test.inbox@example.com.
  - Since 2026-10-09 the example clients' brief senders are real test addresses too, so submissions really arrive:
    Brightline `test.inbox+101@example.com`, Haldor `+102`, Kestrel `+103` (seed data, "Try an example" briefs, and
    the existing Haldor/Brightline briefs and client contacts in the database).
  - A client contact who wrote the brief from a test address is a real test address (candidates have test addresses
    in their CVs since 2026-10-09; there is no redirect for anyone).
  - Sent through Gmail only if the address is on `GOOGLE_SEND_ALLOWLIST`. Otherwise (seed clients like Kestrel with
    fictional addresses) the email stays mock only, marked "mock only: not a test address". Never refused, never
    redirected.
- **One Gmail thread per candidate per job with the client:** the submission starts it; Step 8 client emails about
  that candidate go into the same thread (`Re: <submission subject>`). Separate from the candidate's thread.

## Client replies
- **Check inbox** (Briefs) / **Check replies** (Job page) also read new messages in the client threads (no label).
- A new message in a client thread, not sent by us, is saved in the candidate's thread on the Job page as
  "Client · reply".
- **AI hint** (decided: yes, "go with AI hint"): Haiku reads the reply and suggests a button (see below). The
  account manager still reads it and clicks the existing buttons: **Client wants interview** / **Client rejected** (after a submission), **Client confirms** /
  **Client can't make it** (after a time was picked). The buttons only record the decision, and show only once a
  client reply has arrived (since 2026-10-09: no simulated client replies at all).
- So the recruiter doesn't miss it: a **"Client replied: <candidate> (<job>)"** item in the approval queue (Step 7 or
  8), with the reply text and **Open job** / **Mark handled**. It closes itself when one of the buttons is clicked.
- Replies in a client thread are never treated as briefs (even with the `Briefs` label) and never go to a
  candidate-facing agent (as today: client messages stay out of candidate prompts).

## AI hint: client-reply-hint (Haiku)
- Runs once per client reply (not after a final outcome). No tools; saves nothing itself.
- Input: the situation, the role title, the candidate (name, or "anonymized"), the picked time if any, the reply.
- Situation decides the allowed suggestions (checked by the schema):
  - `submission_sent` (no interview yet): `wants_interview` | `rejected` | `question` | `other`;
  - `awaiting_client` (candidate picked a time): `confirms_time` | `cant_make_time` | `question` | `other`;
  - anything else: `question` | `other`.
- Output `{ suggestion, reason, quote }`, saved on the client message (`classification`). Mixed replies →
  `question`; unsure → `other`.
- Shown: in the "Client replied" item ("AI hint: wants an interview → Client wants interview (reason)"), and on the
  Job page next to the buttons, with the suggested button highlighted.
- Prompt: `prompts/client-reply-hint.md`. Budget: $0.002 per client reply, max 2 turns (`src/config/budgets.ts`).
- Langfuse: trace `client-reply-hint`, tags `step-7`, `job:<id>`, `client:<id>`; scores `cost_vs_budget` (every run)
  and `hint_followed` (1 if the clicked button matches the hint, else 0; once per reply).
- If the hint fails, the item still appears ("AI hint unavailable").

## Guardrails
- Submission still needs the account manager's approval; nothing new is sent without a click.
- Only allow-listed addresses through Gmail; anonymized submissions (older Haldor ones; none since 2026-10-09) stay anonymized (checked in code,
  unchanged).
- The app never changes, labels or deletes anything in Gmail.

## Data
- No new tables or fields: `messages` already has `gmailMessageId`, `gmailThreadId`, `deliveredTo` (spec 12).
- New approval item kind `client_replied`.

## Cost budget
One Haiku run per real client reply: $0.002 budget (tests: ~$0.0014 per reply). Everything else unchanged.

## Acceptance criteria
- [ ] Approving Mykola's submission sends it to test.inbox@example.com through Gmail; it shows "Gmail ↗" on the
      Job page. (fake Gmail: pass; real: walkthrough)
- [ ] A reply from the test inbox in that thread → shown on the Job page + "Client replied" item with an AI hint; the
      buttons then record the decision without a simulated reply. (fake Gmail: pass; real: walkthrough)
- [x] Step 8: the "please confirm this time" email to the client goes into the same thread. (test)
- [x] Seed clients with fictional addresses: client emails stay mock only, flow unchanged. (test)
- [x] Each client reply processed once; client threads never become briefs. (test)

`npm run test:gmail-client`: 11 checks pass, ~$0.004 (hints: wants_interview, confirms_time).

## Test cases
Automated (fake Gmail, no login): submission to an allow-listed contact → Gmail, new thread; fictional contact →
mock only; Step 8 client email → same thread; client reply → saved + queue item, own messages skipped, processed
once; a button closes the item and adds no simulated reply; client thread with `Briefs` label → not a brief.
Real Gmail: the walkthrough with Mykola (approve the submission, reply from the test inbox "We'd like to interview
him", click **Client wants interview**).
