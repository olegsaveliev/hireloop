# Keys menu: bring your own key (added 2026-10-10)

Status: BUILT 2026-10-10 for the open source release. No agent; app settings only.

## Purpose
Anyone who clones Hireloop from GitHub should be able to add their own keys in the app, the same way they connect
Gmail, instead of editing a file. `.env.local` keeps working for people who prefer it.

## Trigger
- **Key icon** in the left rail, above the mail icon: Anthropic and Langfuse. Esc or a click outside closes it.
- **Mail icon:** the Google keys live here, next to **Connect Gmail** (changed 2026-10-10: Google setup and connection
  belong together). Without a Google client the panel shows the Google fields open and **Connect Gmail** greyed out;
  once the client ID and secret are set, they fold under **Google settings**.
- First run: until there is an Anthropic key, every page shows an amber banner "Add your Anthropic API key to start"
  with **Add keys**, and the key icon has an amber dot.

## Keys
| Group | Keys | Needed |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Required to run any agent |
| Langfuse | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Optional (traces, scores, datasets, evals) |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TEST_INBOX`, `GOOGLE_SEND_ALLOWLIST` | From step 5 (sending, replies, calendar) |

## Behaviour
- Saved per group with **Save and check**, in the `settings` table of the local database (never on disk, never in
  git). Empty fields keep the saved value, so a secret needn't be typed again.
- A key saved in the app wins over the same name in `.env.local` / the environment. **Remove … keys** deletes the
  group's saved values; `.env.local` values apply again.
- Saved values are copied into `process.env` at server start (`src/instrumentation.ts`), after every save, and before
  every agent run (so terminal scripts see them too). Code: `src/lib/settings.ts`.
- The browser never receives a full secret: only "•••• last 4" and where it comes from (app, .env.local, not set).
  Non-secret values (region URL, test inbox, allow-list) are shown in full.
- Checks on save (free): Anthropic lists models; Langfuse reads the project. A refused key is still saved, with
  "Saved, but … refused the key (HTTP 401)". Google can only be checked by **Connect Gmail**.
- Format checks before saving: `sk-ant-`, `pk-lf-`, `sk-lf-`, `https://`, `….apps.googleusercontent.com`, email lists.
- Langfuse keys can change while the app runs: the Langfuse span processor and client are rebuilt when they change
  (`src/agents/telemetry.ts`). Without Langfuse keys, nothing is exported, scores are dropped, runs are still logged
  in `agent_runs` without a trace link, and Langfuse-only features (datasets, evals) say the keys are missing.

## Test inbox
- Seed data and "Try an example" briefs use placeholder addresses `test.inbox+N@example.com`.
- With `GOOGLE_TEST_INBOX` set (e.g. `you.test@gmail.com`), `npm run db:seed` and saving an example brief turn them into
  `you.test+N@gmail.com` (`src/lib/test-inbox.ts`).
- The send allow-list is the test inbox plus `GOOGLE_SEND_ALLOWLIST`; `+` variants of either are allowed.

## Guardrails
- No key, address or ID of the developer is committed; placeholders only.
- No agent can read the settings table (agents have no database tools).
- `npm run db:reset` deletes keys saved in the app (stated in the README).

## Acceptance criteria
- [x] Fresh clone with no keys: banner and amber dot show; **Create spec** fails with "No Anthropic API key yet. Add it
      in the Keys menu…".
- [x] A wrongly shaped key is refused with the expected prefix; a well-shaped fake key is saved with "Anthropic refused
      the key (HTTP 401)" and shown as "Saved in the app · •••• 0000".
- [x] **Remove Anthropic keys** asks first, removes it, and the banner returns.
- [x] With no Google client, the mail icon's panel shows the Google fields and the redirect URI to paste, and
      **Connect Gmail** is greyed out until the client ID and secret are saved.
- [x] Type check and lint pass; no console or server errors.
