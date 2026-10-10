# Changelog

Hireloop was built one phase at a time, each from its spec in [docs/specs](docs/specs).

## 2026-10-10: Open source release
- **Keys menu (bring your own key):** add Anthropic and Langfuse keys in the app (key icon, left rail) and Google keys next to **Connect Gmail** (mail icon). They're
  saved in the local database and checked when you save; `.env.local` still works. A banner shows on first run.
- **Langfuse is optional:** without keys, agents still run and are logged on the Runs page, just not traced.
- **Test inbox:** demo candidates and clients use placeholder addresses that become your own test inbox when you seed.
- Folder layout: code in `src/`, docs and specs in `docs/`, scripts grouped by purpose.
- New docs: README quick start, [Google setup guide](docs/google-setup.md), [SECURITY.md](SECURITY.md).

## 2026-10-08 to 2026-10-10: Design and real CVs
- Every page redesigned in one look (dark rail, cream page, lime accents) with a single colour palette.
- Upload real PDF CVs (bulk, with progress); a Haiku agent reads them into the candidate pool.
- Client emails, candidate tabs (pre-screen, submission, interview, outcome, conversation), "New" email tags,
  candidate time zones, "Needs candidates" status, Add to shortlist, Close position.
- Demo video recorded from the real app.

## 2026-10-07 to 2026-10-08: Real Gmail and Google Calendar
- Briefs arrive from a Gmail label; a Haiku classifier decides which emails are briefs.
- Approved outreach, submissions and interview emails are sent through Gmail (allow-listed addresses only), and
  replies are read back into the right thread.
- Interviews booked in Google Calendar with a Meet link, around the recruiter's free/busy times.

## 2026-10-07: Phase 5, steps 6-9
- Pre-screen agent (questions, then a summary with a recommendation), submission agent (client-ready profile, account
  manager approval), scheduling agent (slots in both time zones), feedback loop (hire/reject outcomes as Langfuse
  scores, weekly summary of what went wrong).

## 2026-10-06: Phases 0-4, steps 1-5
- **Phase 0:** Next.js app, SQLite with Prisma, seed data, Langfuse tracing.
- **Phase 1:** job spec agent and the approval queue.
- **Phase 2:** sourcing, enrichment and screening agents, shortlist approval, cost budgets per run and per job.
- **Phase 3:** outreach drafts with send approval, reply classification.
- **Phase 4:** Langfuse dashboard, scores from every approval, datasets and an eval runner from the specs' test cases.
