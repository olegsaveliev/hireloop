# Step 8: Scheduling agent

## Purpose
Book client interviews and keep both sides moving without recruiter back-and-forth.

## Trigger
Client replies to a submission asking for an interview.
- The client's reply arrives from Gmail (specs/13: saved in the thread, with an AI hint). Only then does the Job page
  show **Client wants interview** / **Client rejected** (until then: "Waiting for the client's reply in Gmail").
  Both fill Step 7's `client_accepted_for_interview` (1 / 0). "Client rejected" sets the stage to `client_rejected`
  (Step 9 records the reason). The client answers once.
- Removed 2026-10-09: simulated client replies (the buttons used to write a made-up client email when there was no
  real one) and the **Demo: no common time** checkbox.

## Inputs
- Client reply, candidate availability, `mock_calendar` slots
  - Candidate time zone: from the profile location's country (`src/config/scheduling.ts`: Poland -> Warsaw, Ukraine ->
    Kyiv). Unknown -> escalated (never guessed).
    2026-10-10: many more single-zone countries (UK, Ireland, most of the EU, ...) and cities (the city part of any
    built-in time zone name, e.g. "London", plus a few US cities) are recognised; a country with several zones (US,
    Canada) only by city. Still unknown -> escalate. On the Job page's Interview tab the recruiter then picks the zone
    (pre-picked when the location can now be read) and **Save and find times** saves it and finds times again;
    **Try again** also re-reads the location.
  - Client time zone: `clients.timezone` (Brightline New York, Haldor Berlin, Kestrel Amsterdam). Client calendar =
    the client contact (the brief's sender).
  - The pre-screen's availability ("can start in 3 weeks") is about the start date, not interview times, so it isn't
    used for slots.

## Output
Saved to `interviews` (one per candidate per job).
```json
{
  "candidate_id": "string",
  "client_id": "string",
  "proposed_slots": ["ISO datetime"],
  "confirmed_slot": "ISO datetime | null",
  "status": "proposed | confirmed | rescheduled | no_show"
}
```
Statuses used by the app (added: `finding`, `awaiting_client`, `escalated`):
`finding` -> `proposed` (options sent to the candidate) -> `awaiting_client` (candidate picked one) -> `confirmed`
(booked). A reschedule request sends new options (`rescheduled`). Anything unclear -> `escalated`. **Mark no-show**
on a booked interview -> `no_show` (and an approval queue item). A final outcome (Step 9) cancels an interview still
being arranged, or a booked one unless hired -> `cancelled` (calendar events removed).

## Model
Haiku. Simple, rule-based.

## Tools
None for the agent (same decision as Steps 5-7). The split (agreed before building, decision H):
- **Code** finds the times and books them, so time zones and the 09:00-19:00 rule are never left to a model.
- **Haiku** writes the options email (around a `{{slots}}` marker; the app inserts the times) and reads the
  candidate's replies.
- Confirmations, reminders, nudges and the messages to the client are **templates** (no AI, no cost).

| Function | Access | Purpose |
|------|--------|---------|
| getFreeSlots(person, tz, range) (`src/agents/tools/bookings.ts`) | read | Free hours in working time |
| `findSlots` (`src/agents/scheduling/slots.ts`) | read | Overlap of both calendars, up to 3 times |
| book(slot, attendees) | write | Confirm (refuses outside 09:00-19:00 or a busy time) |
| mock_inbox.sendWithoutApproval / receiveFromClient | write | Propose / confirm / remind; the client's replies (from Gmail) |

Calendars: candidates and clients are busy only when the app already booked them an interview (`calendar_events`);
your own busy hours come from Google Calendar free/busy (specs/14). The made-up busy hours (30% of working hours per
person) were removed on 2026-10-09 (renamed `mock-calendar.ts` → `bookings.ts`).

## Agent steps
1. Find 3 overlapping slots in the next 5 business days (handle Kyiv / Warsaw / client time zones).
   - Business days are counted on the client's calendar, starting tomorrow. Hour-long slots on the hour.
   - Spread out: the earliest time on each day first, then more times (at least 2 hours apart).
   - Fewer than 3 found: the ones found are sent. None: escalated.
2. Draft the options email for the recruiter's approval (since 2026-10-08), send it, then confirm with the client.
   - Options email: Haiku writes it around `{{slots}}` (code checks: marker once, no times/days/time zones written by
     the agent, client not named, Latin letters, under 110 words). The first name comes from our earlier emails
     ("Hi Oleksandr,"), because some profile names are Cyrillic.
   - The candidate's reply: Haiku reads it as `pick` (+ option number) | `reschedule` | `decline` | `acknowledge` |
     `other`. A time that isn't one of the options is never matched; "1 or 2 is fine" is `other`.
   - Pick -> the client is asked to confirm that time (template). When the client's reply arrives from Gmail:
     **Client confirms** / **Client can't make it** buttons (until then: "Waiting for the client to confirm").
3. Book and send confirmations (both calendars; templated emails to both sides, time in each one's zone first).
4. Reminder 24h before. Nudge if no response in 48h.
   Prototype: a "Run reminders now" button sends all due reminders and nudges (nothing runs on a timer locally).
   Hosted version: Trigger.dev scheduled task (see docs/hosting.md).
   - Nudge once (candidate: the options again; client: the picked time). Still no answer 48h after the nudge: escalated.
   - Only real waiting time counts (the "Pretend the waiting time has passed" checkbox was removed on 2026-10-09).

## Human approval
- **Interview times (since 2026-10-08, asked for after the first real-Gmail walkthrough: the client may need other
  times, or the calendars may be wrong).** Every options email (first, after a reschedule, after **Try again**) is a
  draft; interview status `times_draft`; a **"Send interview times: <name> · <job>"** item (Step 8) opens the times
  screen (`/approvals/interview/<id>`), also linked from the Job page (**Review times**):
  - redesigned 2026-10-09 ("just choose slots"): one card with the candidate and their address, then **Times to
    offer · 60 min**: one row per time with its number, the time in the candidate's zone (bold) and "Client: …" in
    the client's zone under it, a date/time picker and a × to remove; **+ Add a time** (max 5); one line on whether
    Google Calendar was checked;
  - the email (subject and text with `{{slots}}`, where the numbered times go) is folded under **Email to <name>**,
    still editable; the client's and the candidate's latest messages are folded under **Latest messages** below;
  - **Approve and send N times** (lime): refused if a time is in the past or outside 09:00-19:00 on a weekday for either side.
    Edited times aren't checked against the calendars (the recruiter knows better). The candidate's pick is read
    against the sent times. Score `approved_without_edits` on the options-email trace.
  - The candidate writing before the times are sent: no agent reads it; it's shown in the item (and the draft stays).
- Everything else stays automatic (templated, low risk): asking the client to confirm a picked time, confirmations,
  reminders, nudges. Escalate to recruiter on any conflict.
- Escalated = a **"Scheduling needs you: <name> · <job>"** approval queue item (Step 8) with the reason, **See job**
  and **Mark handled**. On the Job page, **Try again: find new times** sends new options (reschedule count reset).
- Escalates on: no overlap, unknown candidate time zone, no email, candidate said no / declined the interview, a reply
  the agent can't act on, the client can't make the picked time, booking failed, second reschedule, no answer after a
  nudge.

## Guardrails
- Always state time zone explicitly in messages.
  - Every time is written by code as "Tue 13 Oct, 16:00-17:00 Kyiv time (UTC+3) = 09:00-10:00 New York time (UTC-4)":
    city + UTC offset for that date (summer/winter time handled; Europe and the US switch on different dates).
  - The agent can't write times (checked in code).
- Never book outside 09:00-19:00 local time for either side.
  - Checked in code three times: when finding slots, before asking the client, and in `mock_calendar.book`.
  - The whole interview must end by 19:00, on a weekday, for both sides.
- Never to a candidate who said no (stage declined): escalated, nothing sent.
- No double booking: the client's confirm is claimed atomically; the client's answer is recorded once.
- Candidate messages about times are read by the scheduling agent only (not the Step 5 classifier, not the Step 6
  summary); client messages never go into a candidate-facing agent's prompt.

## Edge cases
- No overlap found: escalate to recruiter. (No AI run; the escalation still gets a trace for its score.)
- Candidate asks to reschedule twice: escalate. (First request: the client is told if a time was already picked or
  booked, the booking is cancelled, new times are sent that weren't offered before. Second: escalated, a booked
  interview stays booked until the recruiter decides.)
- Job budget reached: waits for **Continue**.
- Failed/stopped run: "Failed / Stopped" queue item (Step 8). **Try again** sends the missing options or reads the
  unread reply.

## Cost budget
- Budget: $0.003 per interview (lowered from $0.01 after Phase 5: 53 runs, median $0.0017, max $0.0017; checked per run)
- Max agent turns: 6
- Rationale: Haiku, mostly calendar tool calls.
- Each Haiku run (options email, reschedule email, reading one reply) is checked against this budget. Booking,
  confirmations, reminders and nudges cost nothing (code and templates).
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with "Stopped: over budget".
- First runs (Step 8 build, 2026-10-07): $0.0014-0.0017 per run, about $0.005 for a whole interview (options + one
  reply), no schema retries. After 10 real runs, set the budget to about 1.5x the median actual cost.

## Langfuse tracing
- Trace name: `scheduling-agent`; metadata `mode` = options | reschedule | read_reply (escalation without AI:
  `escalation`, tag `no-llm`)
- Tags: `step-8`, `job:<job_id>`, `client:<client_id>` (added for consistency); the job's session `job:<id>`
- Scores (on the interview's main trace, its first options email):
  - `cost_vs_budget` (actual / budget), on every run;
  - `messages_to_confirm` (count of our scheduling messages before the booking: options, client request, nudges);
  - `escalated` (0/1: 0 when booked, 1 when escalated; the latest value counts).
- Dataset `scheduling-agent` (`src/evals/datasets.ts`, 10 items): options email (first, reschedule); reading a reply: pick
  by time, pick "the first one", none work, move a booked interview, ambiguous "1 or 2", a time not offered, thanks,
  decline. `npm run eval -- scheduling-agent` (~$0.02).

## Acceptance criteria
- [x] Time zones correct across Kyiv, Warsaw, and a US client (every proposed time inside 09:00-19:00 for both sides;
      offsets right in summer, winter and the week only Europe has switched)
- [x] Conflicts escalate instead of guessing (no overlap, second reschedule, declined candidate, unclear reply)

## Test cases
`npm run test:phase5` (Step 8 part) and the `scheduling-agent` dataset.
1. Easy overlap -> confirmed in 2 messages ✓ (Kraków candidate + New York client: options, client request; booked in both calendars)
2. No overlap -> escalated ✓ (no email sent, no AI run; the test books the candidate for 10 days first)
3. US client (EST) + Kyiv candidate -> slots within both working hours ✓ (New York is UTC-4 in October, UTC-5 from November)
