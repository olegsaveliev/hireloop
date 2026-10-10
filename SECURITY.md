# Security and data

Hireloop is a local prototype. It is built to run on your own laptop with fictional data.

## Keys
- Keys typed in the Keys menu are stored in plain text in your local SQLite database (`prisma/dev.db`), and keys in
  `.env.local` in that file. Both are git-ignored. Treat the database file like `.env.local`: don't share or commit it.
- The browser only ever receives the last 4 characters of a secret.
- The app has no login: anyone who can open `localhost:3000` on your machine can use it. Don't expose the port to a
  network or deploy this version publicly. [docs/hosting.md](docs/hosting.md) lists what a hosted version needs.

## Email
- The app sends email only to your test inbox (and its `+` variants) and to addresses on `GOOGLE_SEND_ALLOWLIST`.
  This is checked in code on every send (`src/config/google.ts`).
- Google access is read-only except sending: it reads the `Briefs` label and threads the app started, and calendar
  free/busy. The refresh token is kept in the local database; **Disconnect** revokes it.
- Automated tests and evals can't use real Gmail or Calendar (`src/agents/tools/gmail.ts`, `isTestScript`).

## Personal data
- All seed data is fictional. If you upload real CVs on the Candidates page, they stay in your local database. Don't
  share that database or screenshots of it.
- Agents are told never to store or use protected attributes (age, gender, family, health, religion, nationality),
  and code checks back this up. See each step's spec in [docs/specs](docs/specs).

## Reporting a problem
Please open a GitHub issue without including any keys or personal data, or contact the maintainer privately through
GitHub.
