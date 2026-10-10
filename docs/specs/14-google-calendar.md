# Step 8 v2: Google Calendar (real invites, Meet link, recruiter's busy times)

Status: BUILT 2026-10-08 (approved "go, yes check my calendar"). Automated tests pass with a fake Google; the real
walkthrough with Mykola is next.

## Purpose
A confirmed interview becomes a real event in the recruiter's Google Calendar with a Google Meet link, and Google
sends real invites to the candidate and the client. Proposed times avoid the recruiter's own busy times.
Follows specs 11-13 (Gmail).

## What changes
1. **Client confirms** (Job page, after the candidate picked a time): booking in the app's calendar records as today, then a
   Google Calendar event in the recruiter's primary calendar:
   - title `Interview: <candidate or anonymized ref> · <job title>`, the confirmed hour, a short description
     (role, client, "booked by Hireloop");
   - **Google Meet** link created with the event;
   - guests: the candidate's address from their profile (`test.inbox+<number>@example.com` since 2026-10-09) and the
     client contact, each only if allow-listed; others (fictional sample clients) aren't invited. Google sends the invites
     (`sendUpdates: all`).
   - Saved on the interview: `googleEventId`, `googleEventLink`, `meetLink`.
   - The confirmation emails to both sides include the Meet link (instead of "the client's team will send the link").
2. **Event failed** (not connected, login expired, Google error): the booking stands; a **"Google Calendar: event
   not created"** item (Step 8) with **Try again**. Interviews booked before this change get a **Create Google event**
   button on the Job page (one time).
3. **Cancelled interview** (Step 9 outcome cancels it): the Google event is deleted and Google notifies the guests.
4. **Recruiter's busy times:** when finding times (first, reschedule, Try again), the app reads the recruiter's
   free/busy for the window and skips hours when the recruiter is busy, and hours the candidate or client already has an
   interview booked by the app (their made-up busy hours were removed on 2026-10-09). Needs the read-only `calendar.freebusy` permission: Connect Gmail once more. Without it (or if Google
   fails) times are found as before and the times screen says "Your calendar wasn't checked".

## Guardrails
- Only events the app created (stored id) are ever changed or deleted.
- Guests only from the allow-list.
- Free/busy only: the app never reads event titles or details of the recruiter's calendar.
- Automated tests and evals never touch the real calendar (same rule as Gmail).

## Data
- `interviews`: `googleEventId`, `googleEventLink`, `meetLink` (nullable).
- Permission added: `https://www.googleapis.com/auth/calendar.freebusy`.

## Cost budget
No AI. Google Calendar API is free at this volume.

## Acceptance criteria
- [ ] Client confirms → event in the recruiter's Google Calendar with a Meet link; invites arrive at the test inbox (as
      candidate `+39` and as the client).
- [ ] Mykola's interview (booked before) gets its event with **Create Google event**.
- [ ] A busy hour in the recruiter's calendar is never proposed.
- [ ] Recording a withdrawal cancels the Google event.
- [ ] Google failure leaves the booking and shows a Try again item.

Also: an outcome while times wait for approval (`times_draft`) now cancels the interview too (Step 9).
`npm run test:gmail-client`: 23 checks pass (incl. 9 calendar checks), ~$0.004.

## Test cases
Automated (fake Google, no login): confirm → event created with the right guests (the candidate's address, allow-listed
client, fictional client not invited), Meet link in both confirmations; Google failure → item + Try again; outcome →
event deleted; recruiter busy hours excluded from proposed times; tests can't reach the real calendar.
Real: the walkthrough with Mykola.
