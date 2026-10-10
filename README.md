# Hireloop

**AI agents do the busywork. Recruiters make the calls.**

Hireloop is a working prototype of AI recruiting agents with human approvals. It turns a messy client email into a
booked interview: Claude agents read, search, score and draft, and a person approves every step that matters before
anything moves on or leaves the building.

It runs on your laptop with fictional seed data (3 client briefs, ~60 Ukrainian and Polish engineers), so you can try
the full flow in minutes. You bring your own Anthropic key, and optionally Langfuse and Google, to see real traces and
real emails.

| | |
|---|---|
| **9 steps** | brief → spec → sourcing → enrichment → screening → outreach → pre-screen → submission → interview |
| **6 human approvals** | spec, shortlist, every send, pre-screen, client submission, interview times |
| **13 Claude agents** | Haiku for reading and sorting, Sonnet for writing, Opus for ranking |
| **$1.50 budget per job** | every run is costed against its budget and stopped if it runs away |

Read [How Hireloop works](docs/architecture.md) for the diagrams: the journey of one hire, the guardrails on each
step, the safety net around every AI run, and the tech stack.

## Quick start (about 5 minutes)

You need **Node.js 20 or newer** ([nodejs.org](https://nodejs.org)) and **git**.

```bash
git clone https://github.com/olegsaveliev/hireloop.git
cd hireloop
cp .env.example .env.local   # local settings; keys can also be added in the app later
npm install                  # also generates the database client
npm run db:migrate           # creates the local SQLite database (prisma/dev.db)
npm run db:seed              # loads the fictional clients, briefs and candidates
npm run dev                  # open http://localhost:3000
```

Then, in the app:

1. Click the **key icon** in the left rail (or **Add keys** on the yellow banner).
2. Paste your **Anthropic API key** ([console.anthropic.com → API keys](https://console.anthropic.com/settings/keys))
   and click **Save and check**.
3. On **Briefs**, click **Create spec** on any brief and follow the approval queue from there.
4. When you reach outreach, [connect Google](docs/google-setup.md) to send emails and play the candidates.

A full job, from spec to interview, costs about **$0.35** in API usage.

## Your keys

| Service | Needed? | What it adds | Where to get it |
|---|---|---|---|
| Anthropic | **Required** | Runs the agents | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| Langfuse | Optional | A trace, cost and scores for every run, datasets and evals ([free tier](https://langfuse.com/pricing) is enough) | [cloud.langfuse.com](https://cloud.langfuse.com) → project → Settings → API keys |
| Google | For steps 5-9 | Briefs arrive from your Gmail, approved emails are really sent to your test inbox, replies are read back, interviews are booked in Google Calendar | [Google setup guide](docs/google-setup.md) (~15 minutes) |

There are two ways to add keys. Use whichever you like:

- **In the app:** the **Keys menu** (key icon, left rail) for Anthropic and Langfuse, and the **mail icon** for
  Google (next to **Connect Gmail**). Keys are saved in your local database (`prisma/dev.db`,
  never committed) and checked with the service when you save (Anthropic and Langfuse). Only the last 4 characters are ever shown again.
- **In `.env.local`:** see [.env.example](.env.example). A key saved in the app wins over the same key in `.env.local`.

> `npm run db:reset` wipes the database, including keys saved in the app. Keys in `.env.local` stay.

**With only an Anthropic key** you can run steps 1-4 end to end (spec, sourcing, enrichment, screening, shortlist)
and get outreach drafts. Sending emails and reading replies (steps 5-9) needs Google: you play the candidates and
the client yourself, replying from your test inbox. **Without Langfuse** the agents still run and every run is still
logged on the Runs page, just without a trace link.

### Safe by default

- The app sends email **only** to your test inbox (and its `+` variants) and the addresses you allow-list.
  Every other address is refused in code, whatever an agent writes.
- Demo candidates and clients use placeholder addresses (`test.inbox+12@example.com`). Once you set a test inbox
  (say `you.test@gmail.com`) and re-seed, they become `you.test+12@gmail.com`, so every email lands with you.
- Automated tests and evals can never reach real Gmail or Calendar.

## What's inside

```
hireloop/
├── src/
│   ├── app/          Screens: Briefs, Approval queue, Jobs, Candidates, Clients, Runs, Feedback, Help (Next.js)
│   ├── agents/       All agent-running code: one folder per agent, the shared runner, tools (mock ATS, Gmail, Calendar)
│   ├── config/       Model names, cost budgets and other knobs, one place to edit them
│   ├── lib/          Database client, settings (Keys menu), shared helpers
│   └── evals/        Langfuse datasets built from each spec's test cases
├── prompts/          Every agent's prompt as a plain Markdown file
├── prisma/           Database schema, migrations, fictional seed data
├── scripts/
│   ├── tests/        One test suite per build phase (from the specs' test cases)
│   ├── evals/        Run an agent over its Langfuse dataset
│   ├── langfuse/     Connection test, dashboard setup, score checks
│   └── video/        Record and edit the demo video
└── docs/
    ├── architecture.md   How Hireloop works (diagrams)
    ├── google-setup.md   Connect Gmail and Calendar
    ├── hosting.md        Plan for a hosted version (Vercel, Supabase, Trigger.dev)
    └── specs/            One spec per step: purpose, guardrails, budget, acceptance criteria, test cases
```

The specs in [docs/specs](docs/specs) are the source of truth: each agent was built from its spec, and its test cases
are the automated tests and the first Langfuse dataset.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app at http://localhost:3000 |
| `npm run db:migrate` | Create or update the local database |
| `npm run db:seed` | Reload the fictional seed data (keys saved in the app stay) |
| `npm run db:reset` | Wipe the database and seed it again |
| `npm run typecheck` / `npm run lint` | Check the code |
| `npm run test:budget` | Over-budget and runaway rules (~$0.002) |
| `npm run test:job-spec`, `test:phase2` … `test:phase5` | Each phase's test suite (real model calls, cents each) |
| `npm run test:langfuse` | Send one test trace to Langfuse |
| `npm run eval -- <agent>` | Run an agent over its Langfuse dataset (needs Langfuse) |

## Tech stack

Next.js 16 · React 19 · Tailwind CSS 4 · TypeScript · [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview) ·
Claude Haiku 4.5, Sonnet 5.5, Opus 5.5 · Zod · SQLite with Prisma 7 · Langfuse (OpenTelemetry) · Gmail and Google
Calendar APIs.

Model names live in [src/config/models.ts](src/config/models.ts) and budgets in
[src/config/budgets.ts](src/config/budgets.ts), so swapping a model or changing a budget is a one-line edit.

## How it was built

Hireloop was vibe-coded by a technical program manager working with [Claude Code](https://claude.com/claude-code).
[CLAUDE.md](CLAUDE.md) is the project brief Claude works from, each feature started as a spec in
[docs/specs](docs/specs), and [CHANGELOG.md](CHANGELOG.md) lists what was built in each phase.

## Fictional data only

Hireloop, its clients and its candidates are made up. Don't load real candidates' CVs or personal data into a copy
you share. See [SECURITY.md](SECURITY.md) for how keys and data are handled.

## License

[MIT](LICENSE)
