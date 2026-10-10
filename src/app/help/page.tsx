import Link from "next/link";
import type { ReactNode } from "react";
import { AGENT_BUDGETS, JOB_BUDGET_EXTENSION_USD, JOB_BUDGET_USD, JOB_BUDGET_WARNING_RATIO, RUNAWAY_MULTIPLIER, SOURCING_MAX_CANDIDATES, type AgentName } from "@/config/budgets";
import { AGENT_EFFORT, MODELS, THINKING_OFF } from "@/config/models";
import { FOLLOW_UP_AFTER_DAYS, MAX_DRAFT_WORDS, MAX_FOLLOW_UPS } from "@/config/outreach";
import { MAX_QUESTIONS, MIN_QUESTIONS, RATE_FAR_ABOVE_RATIO } from "@/config/prescreen";
import { MAX_RESCHEDULES, WORK_END_HOUR, WORK_START_HOUR } from "@/config/scheduling";
import { icons } from "../icons";

// Help (2026-10-10, replaces the /guide map): two tabs, "What Hireloop is" and "How it works". Fixed text, except
// models, budgets and limits, which are read from config/ so this page can't drift from what the app does.
// Briefs style (2026-10-10): big headline, lime banner, pill tabs, numbered rows on the page instead of white cards.
const ink = "text-ink";
const muted = "text-stone-500";
const line = "border-stone-300";
const sub = "text-[13px] tracking-[0.08em] uppercase text-stone-500";
const code = "rounded bg-soft px-1.5 py-0.5 font-mono text-xs text-olive";
const outlineLink = `inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-5 py-2.5 text-base hover:bg-white ${line} ${ink}`;
const rows = `divide-y divide-stone-300 border-y ${line}`;
const num = (n: number) => <span className={`w-8 shrink-0 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(n).padStart(2, "0")}</span>;

const money = (n: number) => `$${n < 0.1 ? n.toFixed(3).replace(/0$/, "") : n.toFixed(2)}`;
const modelName = (k: keyof typeof MODELS) => k[0].toUpperCase() + k.slice(1);

// One agent's line: model, budget, max turns (from src/config/budgets.ts and src/config/models.ts).
function AgentFacts({ name }: { name: AgentName }) {
  const b = AGENT_BUDGETS[name];
  const effort = AGENT_EFFORT[name];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="rounded bg-soft px-2 py-0.5 text-xs text-olive">{modelName(b.model)}</span>
      <span className="tabular-nums">
        {money(b.budgetUsd)} {b.unit}
      </span>
      <span className={muted}>· max {b.maxTurns} turns</span>
      {effort && <span className={muted}>· effort {effort}</span>}
      {THINKING_OFF.includes(b.model) && <span className={muted}>· thinking off</span>}
    </div>
  );
}

type Step = { n: number; title: string; does: string; agents: AgentName[]; gate?: { title: string; who: string; body: string }; escalates?: string };

const STEPS: Step[] = [
  {
    n: 1,
    title: "Job spec agent",
    does: "Reads the client's messy brief and turns it into a structured spec: title, seniority, must-haves, nice-to-haves, dealbreakers, location, rate, selling points. Anything the client didn't say goes into open questions; it never fills gaps by guessing.",
    agents: ["job-spec-agent"],
    gate: { title: "Approve spec", who: "Recruiter", body: "Approve as is, edit fields first, or reject with a comment and the agent rewrites it." },
  },
  {
    n: 2,
    title: "Sourcing agent",
    does: `Writes search queries from the approved spec, searches the candidate base and removes duplicates. Adds at most ${SOURCING_MAX_CANDIDATES} new candidates per run, and broadens the search once if it finds too few.`,
    agents: ["sourcing-agent"],
    escalates: "No matches at all → a “No candidates” item in the Approval queue.",
  },
  {
    n: 3,
    title: "Enrichment agent",
    does: "Reads each raw profile and pulls out stack, years per role, location and contacts into fixed fields. Missing facts stay empty.",
    agents: ["enrichment-agent"],
  },
  {
    n: 4,
    title: "Screening agent",
    does: "Scores every candidate who passes a quick pre-filter against the spec, 0-100, with written reasons for and against. Sorted best first.",
    agents: ["screening-agent"],
    gate: { title: "Pick shortlist", who: "Recruiter", body: "Tick who to contact. You can override a score (it's recorded), or edit the spec and search again." },
  },
  {
    n: 5,
    title: "Outreach agent",
    does: `Sonnet writes a personal first message per shortlisted candidate (max ${MAX_DRAFT_WORDS} words) from their real experience. When replies arrive, Haiku sorts them: interested, not interested, asking about rate, out of office. Follow-up after ${FOLLOW_UP_AFTER_DAYS} days of silence, at most ${MAX_FOLLOW_UPS}.`,
    agents: ["outreach-draft", "reply-classifier"],
    gate: { title: "Approve sends", who: "Recruiter, every message", body: "Read, edit and approve each draft. Nothing is sent before you click." },
  },
  {
    n: 6,
    title: "Pre-screen agent",
    does: `Writes ${MIN_QUESTIONS}-${MAX_QUESTIONS} short questions for interested candidates (rate, availability, the spec's open points), then summarises the answers with a recommendation: proceed, discuss or don't proceed.`,
    agents: ["prescreen-agent"],
    gate: { title: "Approve questions", who: "Recruiter", body: "The questions email waits on the send screen. A “discuss” result also comes to you as “Review pre-screen”." },
  },
  {
    n: 7,
    title: "Submission agent",
    does: "Builds the candidate profile in the Hireloop format from the CV and pre-screen answers: headline, summary, key skills, highlights, confirmed rate, availability.",
    agents: ["submission-agent"],
    gate: { title: "Send to client", who: "Account manager", body: "Check the profile, fix wording, send. Or reject with a comment and it rewrites. Save as PDF if the client wants an attachment." },
  },
  {
    n: 8,
    title: "Scheduling agent",
    does: `When the client wants an interview, proposes times that are free on both calendars (free/busy only, ${WORK_START_HOUR}:00-${WORK_END_HOUR}:00 weekdays, both time zones), reads the candidate's answer and books it. Reminders and nudges are templates, no AI.`,
    agents: ["scheduling-agent"],
    gate: { title: "Approve interview times", who: "Recruiter", body: "Check the proposed times before they go to the candidate." },
    escalates: `Unknown time zone, no free slot, or a second reschedule (more than ${MAX_RESCHEDULES}) → comes to you.`,
  },
  {
    n: 9,
    title: "Feedback loop",
    does: "You record the final outcome (hired, rejected by client, withdrew). It becomes a score on the agents' earlier traces in Langfuse; your edits and overrides become test cases. A weekly summary lists what went wrong most often.",
    agents: ["feedback-weekly-summary"],
    gate: { title: "Record outcome", who: "Recruiter", body: "On the job page, with a short reason (no protected attributes)." },
  },
];

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-3xl font-bold tracking-[-0.035em] sm:text-4xl">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

// Three or four short statements side by side: small label, big line, grey text (like the big figures on Runs).
function Statements({ items, cols = 3 }: { items: { k: string; v: string; body: ReactNode }[]; cols?: 2 | 3 | 4 }) {
  return (
    <ol className={`grid gap-x-8 gap-y-8 border-t pt-6 ${line} ${{ 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-2 xl:grid-cols-4" }[cols]}`}>
      {items.map((t) => (
        <li key={t.k} className="min-w-0">
          <div className={sub}>{t.k}</div>
          <div className="mt-2 text-2xl leading-tight font-bold tracking-[-0.03em] sm:text-3xl">{t.v}</div>
          <p className={`mt-2 leading-relaxed ${muted}`}>{t.body}</p>
        </li>
      ))}
    </ol>
  );
}

function About() {
  const pages = [
    { href: "/", label: "Briefs", body: "Client emails from your Gmail label “Briefs” (or pasted). Create a spec from here." },
    { href: "/approvals", label: "Approval queue", body: "Everything waiting for a person, from every step, plus problems (failed or over-budget runs)." },
    { href: "/jobs", label: "Jobs", body: "Each job's pipeline: sourced → shortlisted → contacted → replied → submitted → interview, with cost so far." },
    { href: "/candidates", label: "Candidates", body: "Everyone sourcing can find, including the PDF CVs you upload (Claude Haiku reads each one)." },
    { href: "/clients", label: "Clients", body: "The companies you hire for, with their briefs, jobs and known senders." },
    { href: "/runs", label: "Runs", body: "Every agent run: model, tokens, cost vs budget, and a link to its Langfuse trace." },
    { href: "/feedback", label: "Feedback", body: "Outcomes, corrections turned into test cases, cost per hire, and the weekly summary." },
  ];
  return (
    <div className="flex flex-col gap-14">
      <Statements
        items={[
          { k: "What", v: "AI agents for recruiters", body: "Hireloop takes a client brief all the way to a booked interview. Agents do the legwork: reading briefs, finding and scoring people, drafting messages, building profiles, booking times." },
          { k: "Who", v: "Hireloop", body: "An IT staffing agency (~30 recruiters, Kyiv and Warsaw) placing software engineers with EU and US clients. Recruiters and account managers use it." },
          { k: "Rule", v: "People decide", body: "Every step that reaches a client or a candidate waits for a person to approve it in the Approval queue. Agents never invent facts: unknowns become open questions." },
        ]}
      />

      <Section title="The pages">
        <ol className={rows}>
          {pages.map((p, i) => (
            <li key={p.href} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-5 sm:flex-nowrap">
              {num(i + 1)}
              <div className="min-w-0 flex-[1_1_300px]">
                <div className="text-xl tracking-tight sm:text-2xl">{p.label}</div>
                <p className={`mt-1 ${muted}`}>{p.body}</p>
              </div>
              <Link href={p.href} className={`${outlineLink} max-sm:ml-8`}>
                Open {icons.arrowUpRight}
              </Link>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="What's real">
        <div className={`border-t pt-6 ${line}`}>
          {[
            {
              k: "Real",
              items: [
                "Claude models (Haiku, Sonnet, Opus) do the work, at real cost",
                "Gmail: briefs are read from the “Briefs” label; email goes out only to an allow-list of test addresses",
                "Google Calendar: free/busy only, never what's in a meeting",
                "Langfuse: every run is traced with cost and scores",
              ],
            },
          ].map((b) => (
            <div key={b.k}>
              <ul className="flex flex-col gap-2 leading-relaxed">
                {b.items.map((x) => (
                  <li key={x} className="flex gap-3">
                    <span className="mt-[0.6rem] size-1.5 shrink-0 rounded-full bg-olive-mid" />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="flex flex-col gap-14">
      <Section
        title="The flow"
        aside={
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border border-stone-400" /> Agent works
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-brand" /> You decide
            </span>
          </div>
        }
      >
        <ol className={rows}>
          {STEPS.map((s) => (
            <li key={s.n} className="flex flex-wrap gap-x-6 gap-y-4 py-7 lg:flex-nowrap">
              <span className={`w-8 shrink-0 pt-1.5 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(s.n).padStart(2, "0")}</span>
              <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
                <h3 className="text-xl tracking-tight sm:text-2xl">{s.title}</h3>
                <p className={`max-w-3xl leading-relaxed ${muted}`}>{s.does}</p>
                <div className="flex flex-col gap-1.5">
                  {s.agents.map((a) => (
                    <AgentFacts key={a} name={a} />
                  ))}
                </div>
                {s.escalates && (
                  <p className="flex items-start gap-2 text-sm text-stone-600">
                    <span className="mt-0.5 text-stone-400">{icons.alert}</span>
                    {s.escalates}
                  </p>
                )}
              </div>
              {s.gate && (
                <div className="flex flex-col gap-1.5 self-start rounded-md bg-brand px-5 py-4 max-lg:ml-8 sm:max-lg:ml-[4.5rem] lg:w-80 lg:shrink-0">
                  <div className="text-xs font-semibold tracking-[0.2em] uppercase">{s.gate.who}</div>
                  <div className="text-lg font-semibold tracking-tight">{s.gate.title}</div>
                  <p className="text-sm leading-relaxed text-ink/75">{s.gate.body}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
        <p className={`max-w-4xl text-sm leading-relaxed ${muted}`}>
          Also running, outside the flow: <span className="text-ink">Inbound classifier</span> tells a brief from other email in Gmail (
          <AgentFactsInline name="inbound-classifier" />) and <span className="text-ink">Client reply hint</span> suggests the right button when a client answers a submission (
          <AgentFactsInline name="client-reply-hint" />
          ).
        </p>
      </Section>

      <Section title="Which model does what">
        <ol className={`grid gap-x-8 gap-y-8 border-t pt-6 md:grid-cols-3 ${line}`}>
          {[
            { k: "haiku" as const, role: "Cheap, high-volume reading and sorting", used: "Enrichment, reply sorting, scheduling, Gmail classifier" },
            { k: "sonnet" as const, role: "The default workhorse for writing", used: "Job spec, sourcing, outreach drafts, pre-screen, submission, weekly summary" },
            { k: "opus" as const, role: "Judgment only", used: "Screening: scoring each candidate against the spec" },
          ].map((m) => (
            <li key={m.k} className="flex min-w-0 flex-col gap-2">
              <div className="text-[2.75rem] leading-none font-bold tracking-[-0.045em]">{modelName(m.k)}</div>
              <div className={`${code} mt-1 self-start break-all`}>{MODELS[m.k]}</div>
              <div className="mt-1">{m.role}</div>
              <div className={`text-sm ${muted}`}>{m.used}</div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Cost guardrails">
        <Statements
          cols={4}
          items={[
            { k: "Per run", v: "Over budget → flagged", body: <>Every run&apos;s cost is compared to its agent&apos;s budget (above). Above 1x it&apos;s tagged <span className={code}>over-budget</span> in Langfuse and shown on Runs.</> },
            { k: "Runaway", v: `Above ${RUNAWAY_MULTIPLIER}x → stopped`, body: <>A run costing more than {RUNAWAY_MULTIPLIER}x its budget, or hitting its max turns, is stopped and saves nothing. “Stopped run” appears in the Approval queue with Try again.</> },
            { k: "Per job", v: `${money(JOB_BUDGET_USD)} per job`, body: <>Spec through scheduling. The job page shows cost so far and warns at {Math.round(JOB_BUDGET_WARNING_RATIO * 100)}%. At 100% the pipeline pauses: “Continue” adds {money(JOB_BUDGET_EXTENSION_USD)}, or “Stop job”.</> },
            { k: "Cheaper by design", v: "Fewer, smaller calls", body: <>Max {SOURCING_MAX_CANDIDATES} candidates per sourcing run; only pre-filtered candidates are screened; Opus at low effort; Haiku with thinking off; reminders are templates.</> },
          ]}
        />
      </Section>

      <Section title="Other guardrails">
        <ol className={rows}>
          {[
            ["No invented facts", "Agents only use what's in the brief or profile. Anything unknown goes into open questions or stays empty."],
            ["Checked output", "Every agent answers in a fixed format that the app checks. A bad answer gets one retry, then it comes to you as “Failed run”."],
            ["Email only to safe addresses", "The app refuses to send to any address not on the allow-list, and adds an opt-out line to every message."],
            ["No protected topics", "Pre-screen questions, summaries and outcome reasons are checked for age, family, health, religion, nationality, gender and orientation, and blocked."],
            ["Rate checks", `A rate more than ${Math.round(RATE_FAR_ABOVE_RATIO * 100)}% above the spec's range is flagged. A profile can't go to a client without a confirmed rate.`],
            ["Never guess, escalate", "Unclear replies, unknown time zones, rate questions: these come to you rather than being decided by an agent."],
          ].map(([t, b], i) => (
            <li key={t} className="flex gap-x-6 py-5">
              <span className={`w-8 shrink-0 pt-1 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <div className="text-xl tracking-tight">{t}</div>
                <p className={`mt-1 max-w-3xl ${muted}`}>{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Using it, step by step">
        <ol className={rows}>
          {[
            ["Get a brief in", "Label a client email “Briefs” in Gmail and click Check Gmail on Briefs, or use New brief to paste one.", "/", "Briefs"],
            ["Create the spec", "Click Create spec on the brief. About 30 seconds later the spec is in the Approval queue.", "/", "Briefs"],
            ["Approve the spec", "Read it, fix anything, answer what you can of the open questions, approve. Sourcing, enrichment and screening start on their own (about 2 minutes).", "/approvals", "Approval queue"],
            ["Pick the shortlist", "Candidates arrive ranked with reasons. Tick who to contact and approve.", "/approvals", "Approval queue"],
            ["Approve the messages", "Each draft waits for you. Edit, then Approve & next. Replies are sorted as they arrive.", "/approvals", "Approval queue"],
            ["Send the pre-screen", "Interested people get a few questions once you approve them. Answers are summarised for you.", "/approvals", "Approval queue"],
            ["Send to the client", "The account manager checks the profile and sends it. The client's answer shows up with a suggested next step.", "/approvals", "Approval queue"],
            ["Book the interview", "Approve the proposed times; the agent handles the candidate's answer and books it.", "/jobs", "Jobs"],
            ["Record the outcome", "On the job page: hired, rejected by client or withdrew, with a short reason.", "/jobs", "Jobs"],
            ["Check cost and quality", "Runs shows each run's cost vs budget with a link to Langfuse; Feedback shows hire rate and cost per hire.", "/runs", "Runs"],
          ].map(([t, b, href, where], i) => (
            <li key={t} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-5 sm:flex-nowrap">
              {num(i + 1)}
              <div className="min-w-0 flex-[1_1_300px]">
                <div className="text-xl tracking-tight">{t}</div>
                <p className={`mt-1 max-w-3xl ${muted}`}>{b}</p>
              </div>
              <Link href={href} className={`${outlineLink} max-sm:ml-8`}>
                {where} {icons.arrowUpRight}
              </Link>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

function AgentFactsInline({ name }: { name: AgentName }) {
  const b = AGENT_BUDGETS[name];
  return (
    <>
      {modelName(b.model)}, {money(b.budgetUsd)} {b.unit}
    </>
  );
}

const TABS = [
  { key: "about", label: "What Hireloop is" },
  { key: "how", label: "How it works" },
] as const;

export default async function HelpPage({ searchParams }: PageProps<"/help">) {
  const { tab } = (await searchParams) as { tab?: string };
  const active = TABS.find((t) => t.key === tab)?.key ?? "about";
  return (
    <div className={`flex min-w-0 flex-col gap-10 pt-2 sm:gap-12 ${ink}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className={`min-w-0 flex-[1_1_240px] text-lg font-semibold tracking-tight uppercase sm:text-xl ${muted}`}>Help</div>
        <span className={`text-base ${muted}`}>What Hireloop is, and how the agents, approvals and cost limits fit together.</span>
      </div>

      <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] sm:text-7xl lg:text-[5.5rem]">
        Brief in.
        <br />
        Interview booked.
      </h1>

      <section aria-label="The next useful thing" className="flex flex-wrap items-center gap-x-8 gap-y-6 rounded-md bg-brand px-6 py-8 text-ink sm:px-12 sm:py-12">
        <div className="min-w-0 flex-[1_1_360px]">
          <div className="text-xs font-semibold tracking-[0.25em] uppercase sm:text-sm">The next useful thing</div>
          <p className="mt-4 text-2xl tracking-tight sm:text-4xl">Start with a client brief.</p>
          <p className="mt-4 text-base">Label a client email “Briefs” in Gmail, or paste one with New brief. The agents take it from there, and you approve every step that reaches a person.</p>
        </div>
        <Link href="/briefs/new" className="inline-flex items-center gap-3 rounded-xl bg-ink px-7 py-4 text-lg font-semibold whitespace-nowrap text-white hover:bg-black">
          New brief {icons.arrowUpRight}
        </Link>
      </section>

      <div className="flex min-w-0 flex-col gap-10">
        <nav className="flex flex-wrap gap-1 sm:gap-2" aria-label="Help">
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <Link
                key={t.key}
                href={t.key === "about" ? "/help" : `/help?tab=${t.key}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3.5 py-2.5 text-base whitespace-nowrap sm:px-5 sm:py-3 sm:text-lg ${on ? "bg-ink text-white" : `${muted} hover:text-ink`}`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        {active === "about" ? <About /> : <HowItWorks />}
      </div>
    </div>
  );
}
