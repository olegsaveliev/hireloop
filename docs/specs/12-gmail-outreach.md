# Step 5 v2: Gmail outreach (real emails to candidates, real replies)

Status: BUILT 2026-10-08 (approved "go"). Automated tests pass with a fake Gmail; the real-Gmail walkthrough is next.

## Purpose
Emails to candidates leave through the recruiter's real Gmail, and candidates' replies are read from Gmail, so the
recruiter works Step 5 (and the candidate side of Steps 6 and 8) as in real life. Candidates are still fictional,
but since 2026-10-09 each one has a real test address in their CV (see "Candidate addresses"), so emails go
straight to it.

## What changes (and what doesn't)
- Agents, prompts, approvals and budgets: **unchanged**. No new AI runs, no extra AI cost.
- `src/agents/tools/mock-inbox.ts` stays the one place where messages are sent and received. Its send functions now
  also send through Gmail; replies come only from Gmail (the "Simulate a reply" form was removed 2026-10-09).
- **In scope: every email to a candidate.** Step 5 first messages, follow-ups and our replies (all after
  approval, as today), Step 6 pre-screen questions (after approval since 2026-10-08, spec 06), and the emails that
  go out without a click: Step 8 scheduling emails to the candidate.
- **Not in scope (next step):** emails to the client (Step 7 submission, Step 8 client emails). They stay in the
  mock inbox for now.

## Candidate addresses (changed 2026-10-09)
- Every candidate's CV has its own address: `test.inbox+<number>@example.com`, the number from the candidate id
  (cand-001 → `+1`, cand-039 → `+39`). Gmail delivers all of them to the test inbox, as separate conversations.
  cand-014 and cand-015 are the same person (dedupe test case), so both have `+14`. Candidates that had no email
  got one, so every candidate can be contacted.
- Enrichment reads the address from the CV like any other; the email goes to that address (`toEmail`), with no
  hidden redirect. The address used is also saved as `deliveredTo`.
- Allow-list: an address is allowed if it's in `GOOGLE_SEND_ALLOWLIST`, or is a `+` variant of one. Anything else is
  refused in code, before Gmail is called (the draft stays waiting, with the reason on the send screen).
- Before 2026-10-09: CVs had fictional `@mail.example` addresses and the app redirected each email to
  `GOOGLE_TEST_INBOX` + `+<candidate id>`. That redirect and the setting are gone.

## Sending
1. Recruiter approves a draft (send screen, as today; includes pre-screen questions), or the app sends a no-click
   email (Step 8).
2. The app claims the message (`awaiting_approval` → `sending`), so a double click can't send twice.
3. Gmail sends it from the connected account: subject, body + the opt-out line, plain text.
   - First message: a new Gmail thread. Follow-ups, our replies, pre-screen and scheduling emails: in the same
     thread (`Re: <first subject>`, Gmail thread id + In-Reply-To header).
4. Saved on the message: `gmailMessageId`, `gmailThreadId`, `deliveredTo`. Status `sent`; the rest (stage →
   contacted, follow-up timer, Langfuse scores) as today.
5. If Gmail fails (not connected, login expired, network): the message goes back to `awaiting_approval`, the send
   screen shows the error, nothing is marked sent. No-click emails that fail: a **Failed: Gmail send** item in the
   queue with **Try again**.

## Reading replies
- **Check inbox** (Briefs page; also a **Check replies** button on the Job page) now does two things:
  1. briefs under the `Briefs` label, as in spec 11;
  2. new messages in every Gmail thread the app started with a candidate (no label needed).
- A new message in a candidate thread, not sent by us, is that candidate's reply: it goes into
  `receiveReply` (Haiku classifies it, stage and follow-up rules, pre-screen answers, scheduling replies). Quoted
  earlier text is cut, as for briefs.
- If a candidate replied, the job's Steps 5-7 run continues in the background afterwards (e.g. a "proceed"
  pre-screen summary starts Step 7), as the old Simulate form did.
- Each Gmail message is processed once (its Gmail id is stored on the inbound message).
- Candidate threads are never treated as briefs, even if they carry the `Briefs` label.
- No simulated replies (removed 2026-10-09): to play a candidate, reply from the test inbox in Gmail.

## Guardrails
- Nothing is sent without approval, except Step 8 scheduling emails (no-click, unchanged). Pre-screen questions
  need approval since 2026-10-08.
- Never to a `declined` candidate (unchanged).
- Only allow-listed addresses (and their `+` variants). The real Gmail account reads only the `Briefs` label and
  threads the app started; it never changes, labels or deletes anything.
- Candidate reply text is data, never instructions (classifier has no tools, as today).

## Built details
- `src/agents/tools/mock-inbox.ts`: `deliver()` sends through `gmailTransport` (tests swap in a fake Gmail). `send()`
  claims the draft (`sending`), sends, then marks it `sent`; on a Gmail error it goes back to `awaiting_approval` and
  the send screen shows the error. No-click emails that fail become `send_failed` + a **Failed: Gmail send** item
  (**Try again** re-sends every failed email of that candidate, oldest first).
- Emails in the thread after the first use subject `Re: <first subject>` (Gmail threads by subject).
- `src/agents/outreach/gmail-replies.ts`: `checkCandidateReplies` reads each thread the app started; messages from the
  recruiter's own address are skipped (also notes typed directly in Gmail). An email with no text after the quote is
  cut is passed on as "(no text in the email)".
- Send screen: "to <address>" per draft. Job page: **Check replies** (when the job has Gmail
  conversations) and a "Gmail → address ↗" link on each Gmail message.

## Data
- `messages`: new `gmailMessageId`, `gmailThreadId`, `deliveredTo`; new status `sending` (short-lived).
- No new tables.

## Cost budget
No new AI runs. Gmail API is free at this volume. Reply classification stays $0.003 per reply.

## Langfuse
No new traces or scores. (Planned `gmail_thread_id` trace metadata was left out: the Gmail thread id is on each
message in the app, and the trace links stay as before.)

## Acceptance criteria
- [ ] Approving a draft sends a real email that arrives at `test.inbox+<number>@example.com`; the candidate
      moves to contacted. (fake Gmail: pass; real: walkthrough)
- [ ] A reply from the test inbox in that thread, after Check inbox / Check replies, shows on the Job page,
      classified, with its follow-up rules. (fake Gmail: pass; real: walkthrough)
- [ ] An "interested" reply → pre-screen questions drafted; after approval they arrive in the same Gmail thread.
      (fake Gmail: pass; real: walkthrough)
- [x] A follow-up goes into the same thread. (test)
- [x] An address outside the allow-list is refused; Gmail failure leaves the draft unsent with a clear message. (test)
- [x] Check inbox twice → each reply processed once. (test)

`npm run test:gmail-outreach`: 19 checks pass, ~$0.04 (incl. questions approval, reject → redraft, reply before
sending cancels the draft). `npm run test:inbound` re-run: all pass.

## Test cases
Automated (fake Gmail, no login): send claims the message once; Gmail failure rolls back; the candidate's own
address is used; an address outside the allow-list is refused and the draft stays waiting;
allow-list (+ variants allowed, others refused); a reply in a known thread → `receiveReply`; our own message in the
thread skipped; the same reply twice → once; candidate thread with the `Briefs` label → not a brief.
Real Gmail: the walkthrough (approve cand-039's draft, reply "interested" from the test inbox, see the pre-screen
questions arrive).
