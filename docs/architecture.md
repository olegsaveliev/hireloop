# How Hireloop works

AI agents do the busywork. Recruiters make the calls.
9 steps · 6 human approvals · 13 Claude agents · $1.50 AI budget per job.

Legend: lime = Claude agent, dark = human approval, dashed = plain code, blue = outside system.

## 1. The journey of one hire

```mermaid
flowchart TD
  subgraph A["FIND THE ROLE"]
    MAIL[("Client email<br/>Gmail label: Briefs")]
    IC["Inbound classifier · Haiku<br/>is this email a brief?"]
    S1["1 · Job spec agent · Sonnet<br/>messy brief → structured spec"]
    H1{{"Recruiter approves spec"}}
  end
  subgraph B["FIND THE PEOPLE"]
    POOL[("Candidate pool<br/>60 profiles + uploaded PDF CVs")]
    S2["2 · Sourcing agent · Sonnet<br/>search, dedupe, up to 20"]
    S3["3 · Enrichment agent · Haiku<br/>stack, years, location"]
    PF["Pre-filter · plain code<br/>no must-haves = not scored"]
    S4["4 · Screening agent · Opus<br/>score 0-100 + written reasons"]
    H2{{"Recruiter picks the shortlist"}}
  end
  subgraph C["TALK TO THEM"]
    S5["5 · Outreach agent · Sonnet<br/>personal first message + follow-ups"]
    H3{{"Recruiter approves every send"}}
    GM[("Gmail<br/>one thread per candidate")]
    RC["Reply classifier · Haiku<br/>interested? rate? away? no?"]
    S6["6 · Pre-screen agent · Sonnet<br/>questions, then a summary"]
    H4{{"Recruiter approves questions<br/>and decides: submit?"}}
  end
  subgraph D["CLOSE THE DEAL"]
    S7["7 · Submission agent · Sonnet<br/>client-ready profile"]
    H5{{"Account manager<br/>sends it to the client"}}
    S8["8 · Scheduling agent · Haiku<br/>slots in both time zones"]
    H6{{"Recruiter approves<br/>interview times"}}
    CAL[("Google Calendar<br/>event + Meet link")]
    S9["9 · Feedback loop<br/>hired / rejected → Langfuse"]
  end

  MAIL --> IC --> S1 --> H1
  H1 -- "reject + comment" --> S1
  H1 -- "approved" --> S2
  POOL -.-> S2
  S2 --> S3 --> PF --> S4 --> H2
  H2 -- "edit spec, search again" --> S2
  H2 -- "approved" --> S5 --> H3
  H3 -- "reject + comment" --> S5
  H3 -- "approved" --> GM --> RC
  RC -- "interested" --> S6 --> H4
  H4 -- "submit" --> S7 --> H5
  H5 -- "reject + comment" --> S7
  H5 -- "approved" --> S8 --> H6 --> CAL --> S9

  classDef ai fill:#e2f56c,stroke:#1a1a1a,stroke-width:1.5px,color:#1a1a1a;
  classDef human fill:#1f1f1f,stroke:#e2f56c,stroke-width:2px,color:#e2f56c,font-weight:bold;
  classDef code fill:#ffffff,stroke:#777777,stroke-dasharray:4 3,color:#1a1a1a;
  classDef ext fill:#dbe6f3,stroke:#6b8db5,color:#1a1a1a;
  class IC,S1,S2,S3,S4,S5,RC,S6,S7,S8 ai;
  class H1,H2,H3,H4,H5,H6 human;
  class PF,S9 code;
  class MAIL,POOL,GM,CAL ext;
```

## 2. Guardrails per step

| Step | Agent · model | Human check | Guardrails (prompt + checked in code) | Budget |
|---|---|---|---|---|
| 1 | Job spec · Sonnet | Recruiter approves spec (edit any field, or reject with comment → redraft) | Never invents requirements, unknowns → open questions; never guesses a rate without flagging; contradictions become questions; email text is data, not instructions | $0.025 / spec, 5 turns |
| 2 | Sourcing · Sonnet | None (zero results → queue item) | Never filters on age, gender, nationality, photo; location filter read from spec by code; < 5 results → broadens once | $0.04 / job, 10 turns |
| 3 | Enrichment · Haiku | None (failures → "Try again" item) | Never infers fields not in the text; never stores age, family status, religion | $0.006 / candidate, 3 turns |
| 4 | Screening · Opus | Recruiter picks shortlist (score override needs a note) | Reasons must cite profile facts; no protected attributes or university prestige; all < 40 → "spec may be too strict" | $0.02 / candidate, 4 turns |
| 5 | Outreach · Sonnet + Haiku | Recruiter approves every send; Correct/Wrong on each sorted reply | Client never named (code check); allow-listed addresses only; opt-out line added; stop after "no"; rate answers from spec range only | $0.015 / draft, $0.003 / reply |
| 6 | Pre-screen · Sonnet | Recruiter approves questions, decides submit | No questions on age, family, health, religion, nationality (word check); rate > 15% over range → "discuss"; nothing sent after a "no" | $0.02 / candidate, 6 turns |
| 7 | Submission · Sonnet | Account manager approves; one click sends once | No skills or numbers not in source, every highlight has a source quote; anonymised = agent never sees name/contacts; no confirmed rate → blocked | $0.025 / submission, 5 turns |
| 8 | Scheduling · Haiku | Recruiter approves interview times; conflicts escalate | Weekdays 09:00-19:00 both sides (checked 3×); times written by code with city + UTC offset; free/busy only; 2nd reschedule → human | $0.003 / interview, 6 turns |
| 9 | Feedback · no AI (+ Sonnet weekly summary) | People supply outcomes | Reasons with protected attributes blocked; summary may only cite given facts (code check) | $0.20 / week |

Helper agents: inbound classifier (Haiku), CV reader (Haiku), reply classifier (Haiku), client reply hint (Haiku).

## 3. The safety net around every AI run

```mermaid
flowchart TD
  T(["An agent step is about to run"]) --> J{"Has this job spent<br/>its $1.50 budget?"}
  J -- "yes" --> P{{"Job pauses · approval queue<br/>Continue (+$1.50) or Stop job"}}
  J -- "no" --> R["Run the agent · Claude Agent SDK<br/>prompt from /prompts · max turns · hard cap 3× budget"]
  R --> C{"Cost vs this agent's budget"}
  C -- "over 3× or hit max turns" --> X["Stopped: over budget<br/>nothing saved · item in queue"]
  C -- "within 3×" --> V{"Output matches the<br/>JSON schema? (Zod)"}
  V -- "no" --> RT["Retry once,<br/>showing the agent its errors"]
  RT --> V2{"Valid now?"}
  V2 -- "no" --> F["Failed · item in queue<br/>with Try again"]
  V2 -- "yes" --> G
  V -- "yes" --> G{"Code guardrails<br/>facts in source · protected words<br/>client not named · send allow-list"}
  G -- "fails" --> B["Blocked or sent back<br/>never saved silently"]
  G -- "passes" --> S["Saved to the database<br/>over 1×? tagged over-budget"]
  S --> H{{"Step has a human gate?<br/>status = awaiting_approval"}}
  H -- "approved" --> N(["Next step starts"])
  H -- "rejected + comment" --> R
  X --> L[("Every run logged<br/>agent_runs row + Langfuse trace<br/>cost · tokens · model · scores")]
  F --> L
  S --> L

  classDef ai fill:#e2f56c,stroke:#1a1a1a,stroke-width:1.5px,color:#1a1a1a;
  classDef human fill:#1f1f1f,stroke:#e2f56c,stroke-width:2px,color:#e2f56c,font-weight:bold;
  classDef code fill:#ffffff,stroke:#777777,stroke-dasharray:4 3,color:#1a1a1a;
  classDef ext fill:#dbe6f3,stroke:#6b8db5,color:#1a1a1a;
  classDef stop fill:#f6dcd2,stroke:#b4532a,color:#5a1e06;
  class R,RT ai;
  class P,H human;
  class J,C,V,V2,G,S,T,N code;
  class X,F,B stop;
  class L ext;
```

## 4. Tech stack

```mermaid
flowchart LR
  U["Recruiter / Account manager<br/>browser · localhost:3000"]
  subgraph APP["Next.js 16 app · React 19 · Tailwind CSS 4 · TypeScript"]
    UI["Screens<br/>Briefs · Approval queue · Jobs<br/>Candidates · Clients · Runs · Feedback · Help"]
    SA["Server actions + API routes"]
  end
  subgraph RUN["Agent runner · src/agents"]
    SDK["Claude Agent SDK<br/>budget guard · Zod check · retry"]
    PR["Prompts<br/>/prompts/*.md"]
    CFG["Config<br/>models.ts · budgets.ts"]
    TOOLS["Tools<br/>mock_ats · mock_inbox<br/>gmail · google_calendar"]
  end
  CLAUDE["Claude API<br/>Haiku 4.5 · Sonnet 5.5 · Opus 5.5"]
  DB[("SQLite database<br/>Prisma 7 ORM · 24 tables")]
  GOOG[("Google<br/>Gmail API · Calendar API · OAuth")]
  LF[("Langfuse Cloud · EU<br/>traces · cost · scores<br/>datasets · evals · dashboard")]

  U --> UI --> SA --> SDK
  SA --> DB
  PR --> SDK
  CFG --> SDK
  SDK --> CLAUDE
  SDK --> TOOLS
  TOOLS --> DB
  TOOLS --> GOOG
  SDK -- "OpenTelemetry" --> LF
  SA -- "approval scores" --> LF
```

| Layer | Tools |
|---|---|
| Screens | Next.js 16, React 19, Tailwind CSS 4, TypeScript 5 |
| AI | Claude Agent SDK (TypeScript), Claude Haiku 4.5 / Sonnet 5.5 / Opus 5.5, Zod 4 schemas, prompts in `/prompts` |
| Data | SQLite via Prisma 7 ORM (better-sqlite3 adapter), 24 tables, seed data (briefs, 60 candidates, replies) |
| Connected services | Gmail API, Google Calendar API, google-auth-library (OAuth), mock_ats, mock_inbox |
| Quality and cost | Langfuse Cloud EU, OpenTelemetry + OpenInference instrumentation, datasets + eval runner (33 items), "Hireloop agents" dashboard |
| Keys | Bring your own key: Anthropic (required), Langfuse (optional), Google (from step 5), typed in the app (Keys menu; Google in the mail icon's menu) and saved in the local database, or in `.env.local` |
| Building and testing | tsx test scripts per phase, ESLint, git, Playwright + ffmpeg (demo video) |

## 5. Hosted later

```mermaid
flowchart LR
  A1["Next.js on the laptop"] --> B1["Vercel"]
  A2["SQLite file"] --> B2["Supabase Postgres"]
  A3["Server routes run agents"] --> B3["Trigger.dev background jobs"]
  A4["mock_ats · mock_inbox"] --> B4["Real Ashby, Gmail, Calendar via MCP"]
  A5["Langfuse Cloud EU"] --> B5["Langfuse Cloud EU (no change)"]
```

## 6. Where the code lives

| Folder | What's in it |
|---|---|
| `src/app` | Screens and server actions (Next.js App Router) |
| `src/agents` | One folder per agent (`agent.ts` = the model call, `schema.ts` = its Zod output, `workflow.ts` = what happens around it), plus the shared runner (`run-agent.ts`: budget guard, Zod check, retry, logging) and tools (`tools/`: mock ATS, mock inbox, Gmail, Calendar) |
| `src/config` | Model names (`models.ts`), budgets (`budgets.ts`) and other knobs |
| `src/lib` | Database client, settings for the Keys menu, shared helpers |
| `src/evals` | Langfuse datasets built from the specs' test cases |
| `prompts` | One Markdown prompt per agent |
| `prisma` | Schema, migrations, fictional seed data |
| `scripts` | Test suites per phase, eval runner, Langfuse setup, demo video |
| `docs/specs` | One spec per step: the source of truth each agent was built from |

