import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { usd } from "@/lib/format";
import { jobFinished, jobStage } from "@/lib/briefs";
import { displayStatus, jobProgress, STAGES, type JobProgress } from "@/lib/job-progress";
import { JOB_BUDGET_WARNING_RATIO } from "@/config/budgets";
import type { JobSpecData } from "@/agents/job-spec/schema";
import { ActionButton } from "../action-button";
import { AutoRefresh } from "../auto-refresh";
import { icons } from "../icons";
import { startOutreachAction, startPipelineAction } from "./actions";
import { NEEDS_YOU, PROBLEM, PROBLEM_NOTE, STATUS, statusOf } from "./status";

// Screen 3: jobs and their pipelines, in the Briefs style (canvas mockup approved 2026-10-10): grey label, big headline,
// lime "The next useful thing" banner, pill tabs, one numbered row per job with an 8-step progress bar, its spend and
// one next step. The full pipeline (stage numbers, sourcing details, follow-ups) is on the job's own page.
// Buttons: dark = you look at something, lime = starts an agent, outline = open.
const ink = "text-ink";
const muted = "text-stone-500";
const line = "border-stone-300";
const darkLink = "inline-flex items-center gap-5 whitespace-nowrap rounded-xl border border-ink bg-ink px-5 py-2.5 text-base font-semibold text-white hover:bg-black";
const outlineLink = `inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-5 py-2.5 text-base hover:bg-white ${line} ${ink}`;
const badge = "rounded px-2 py-0.5 text-xs font-normal tracking-normal";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const say = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  await connection();
  const { tab } = (await searchParams) as { tab?: string };
  const [jobs, clients] = await Promise.all([
    db.job.findMany({ include: { jobSpec: true }, orderBy: { createdAt: "desc" } }),
    db.client.findMany(),
  ]);
  const progress = await jobProgress(jobs);
  const anyRunning = [...progress.values()].some((p) => p.running && !p.stuck);

  type Job = (typeof jobs)[number];
  const pOf = (job: Job) => progress.get(job.id)!;
  const clientName = (job: Job) => clients.find((c) => c.id === job.clientId)?.name ?? "";
  const statusKey = (job: Job) => displayStatus(job, pOf(job));
  const isProblem = (job: Job) => STATUS[statusKey(job)]?.style === PROBLEM;
  // Waiting for the recruiter: a decision, a button to press, drafts to review, or a problem.
  const needsYou = (job: Job) => !finished(job) && (STATUS[statusKey(job)]?.style === NEEDS_YOU || isProblem(job) || pOf(job).pendingDrafts > 0);
  const finished = (job: Job) => jobFinished(job, pOf(job).stageCounts.hired);

  const active = jobs.filter((j) => !finished(j));
  const waiting = active.filter(needsYou);
  const done = jobs.filter((j) => pOf(j).stageCounts.hired > 0);
  // Closed by the recruiter, or stopped at the job budget, without a hire.
  const stopped = jobs.filter((j) => ["stopped", "closed"].includes(j.status) && pOf(j).stageCounts.hired === 0);
  const spent = active.reduce((s, j) => s + pOf(j).cost, 0);
  const budgets = active.reduce((s, j) => s + pOf(j).budget, 0);

  // The row's one next step (and the banner's). `dark` links open a review screen; lime buttons start agents.
  const nextStep = (job: Job, p: JobProgress): ReactNode => {
    if (job.status === "awaiting_shortlist")
      return (
        <Link href={`/approvals/shortlist/${job.id}`} className={darkLink}>
          Pick shortlist {icons.arrowUpRight}
        </Link>
      );
    if (p.pendingDrafts > 0)
      return (
        <Link href={`/approvals/outreach/${job.id}`} className={darkLink}>
          Review drafts ({p.pendingDrafts}) {icons.arrowUpRight}
        </Link>
      );
    if (job.status === "paused_over_budget" || job.status === "no_candidates")
      return (
        <Link href="/approvals?tab=problems" className={darkLink}>
          {job.status === "paused_over_budget" ? "Continue or stop" : "Open approval queue"} {icons.arrowUpRight}
        </Link>
      );
    if (job.status === "ready_for_sourcing")
      return <ActionButton action={startPipelineAction.bind(null, job.id)} label="Start sourcing" pendingLabel="Starting…" variant="lime" icon={icons.arrowUpRight} />;
    if ((job.status === "failed" || p.stuck) && !finished(job))
      return <ActionButton action={startPipelineAction.bind(null, job.id)} label="Resume" pendingLabel="Starting…" variant="lime" title="Continue where it stopped; only missing work is redone." />;
    if (job.status === "shortlisted")
      return (
        <ActionButton action={startOutreachAction.bind(null, job.id)} label="Draft outreach" pendingLabel="Starting…" variant="lime" icon={icons.arrowUpRight} title="Write first messages for the shortlisted candidates." />
      );
    return (
      <Link href={`/jobs/${job.id}`} className={outlineLink}>
        Open job {icons.arrowUpRight}
      </Link>
    );
  };

  const row = (job: Job, n: number) => {
    const p = pOf(job);
    const key = statusKey(job);
    const status = statusOf(key);
    const spec = job.jobSpec.spec as JobSpecData;
    const place = spec.location?.[0];
    const meta = [
      clientName(job),
      place && place.length <= 28 ? place : null,
      spec.seniority ? capital(spec.seniority) : null,
      `Opened ${shortDate(job.createdAt)}`,
    ].filter(Boolean).join(" / ");
    // Progress bar: one segment per stage. Dark = reached, olive = the next step, red when the job is stuck there.
    const hired = p.stageCounts.hired > 0;
    const reached = hired ? STAGES.length - 1 : STAGES.findLastIndex((s) => p.stageCounts[s] > 0);
    const caption =
      job.status === "ready_for_sourcing" && !p.stageCounts.sourced
        ? "Spec approved · not started"
        : `${plural(p.stageCounts.sourced, "sourced", "sourced")} · ${jobStage(job.status, p.stageCounts)}${p.declined ? ` · ${p.declined} declined` : ""}`;
    const warn = p.share >= JOB_BUDGET_WARNING_RATIO;
    const problemNote = PROBLEM_NOTE.includes(job.status) ? job.pipelineNote : null;
    return (
      <li key={job.id} id={`job-${job.id}`} className="flex scroll-mt-6 flex-wrap items-center gap-x-8 gap-y-4 py-7 lg:flex-nowrap">
        <span className={`w-8 shrink-0 self-start pt-2 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(n).padStart(2, "0")}</span>
        <div className="min-w-0 flex-[1_1_300px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xl tracking-tight break-words sm:text-2xl">
            <Link href={`/jobs/${job.id}`} className="hover:underline">
              {job.title}
            </Link>
            <span className={`${badge} ${status.style}`}>{status.label}</span>
          </div>
          <div className={`mt-1.5 text-sm tracking-wide uppercase ${muted}`}>{meta}</div>
          {p.progress && (
            <p className={`mt-1.5 text-base ${p.stuck ? "text-rose-800" : "text-emerald-800"}`}>
              {p.stuck ? `${p.progress}. No progress for a few minutes (was the app restarted?)` : p.progress}
            </p>
          )}
          {problemNote && <p className="mt-1.5 max-w-3xl text-base leading-snug text-rose-800">{problemNote}</p>}
        </div>
        <div className="w-full max-w-60 min-w-48 shrink-0 max-lg:basis-full" aria-label={`Reached ${reached + 1} of ${STAGES.length} stages`}>
          <div className="flex gap-1">
            {STAGES.map((s, i) => (
              <span
                key={s}
                title={`${capital(s === "prescreened" ? "pre-screened" : s)}: ${p.stageCounts[s]}`}
                className={`h-1.5 flex-1 rounded-full ${
                  i <= reached ? "bg-ink" : i === reached + 1 && !finished(job) ? (isProblem(job) ? "bg-rose-600" : "bg-olive-mid") : "bg-stone-200"
                }`}
              />
            ))}
          </div>
          <div className="mt-2.5 text-sm text-stone-600">{capital(caption)}</div>
        </div>
        <div className={`w-28 shrink-0 font-mono text-sm tabular-nums ${warn ? "font-semibold text-rose-800" : "text-stone-600"}`} title="Agent spend of this job's budget">
          {usd(p.cost)} / {usd(p.budget)}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 lg:w-52 lg:shrink-0">{nextStep(job, p)}</div>
      </li>
    );
  };

  // "The next useful thing": the oldest job waiting for you (shortlist first, then drafts, then problems, then a
  // button to press), or a calm line when nothing is.
  const oldestFirst = [...waiting].reverse();
  const pick = (test: (j: Job) => boolean) => oldestFirst.find(test);
  const next = (() => {
    const also = () => (waiting.length > 1 ? ` Also needs you: ${plural(waiting.length - 1, "more job", "more jobs")}.` : "");
    const where = (j: Job) => [clientName(j), j.title].filter(Boolean).join(" · ");
    let j = pick((x) => x.status === "awaiting_shortlist");
    if (j)
      return {
        title: clientName(j) ? `${clientName(j)}’s shortlist is ready to pick.` : "A shortlist is ready to pick.",
        text: `${where(j)}: ${pOf(j).scored ? plural(pOf(j).scored, "candidate scored", "candidates scored") : plural(pOf(j).stageCounts.sourced, "candidate sourced", "candidates sourced")}.${also()}`,
        href: `/approvals/shortlist/${j.id}`,
        cta: "Pick shortlist",
      };
    j = pick((x) => pOf(x).pendingDrafts > 0);
    if (j)
      return {
        title: `${say(pOf(j).pendingDrafts)} outreach ${pOf(j).pendingDrafts === 1 ? "draft is" : "drafts are"} ready to review.`,
        text: `${where(j)}.${also()}`,
        href: `/approvals/outreach/${j.id}`,
        cta: "Review drafts",
      };
    j = pick((x) => statusKey(x) === "needs_candidates");
    if (j)
      return {
        title: `${j.title} needs candidates.`,
        text: `${where(j)}: everyone on the shortlist is out (said no, client said no, or withdrew).${also()}`,
        href: `/jobs/${j.id}`,
        cta: "Open job",
      };
    j = pick(isProblem);
    if (j)
      return {
        title: j.status === "paused_over_budget" ? `${j.title} is paused at its budget.` : j.status === "no_candidates" ? `${j.title} found no candidates.` : `${j.title} stopped working.`,
        text: `${j.pipelineNote ?? where(j)}${also()}`,
        href: j.status === "paused_over_budget" || j.status === "no_candidates" ? "/approvals?tab=problems" : `/jobs#job-${j.id}`,
        cta: j.status === "paused_over_budget" ? "Continue or stop" : j.status === "no_candidates" ? "Open approval queue" : "Show me",
      };
    j = oldestFirst[0];
    if (j)
      return {
        title: j.status === "shortlisted" ? `${j.title} is ready for outreach.` : `${j.title} is ready for sourcing.`,
        text: `${where(j)}.${also()}`,
        href: `/jobs#job-${j.id}`,
        cta: "Show me",
      };
    if (jobs.length === 0) return { title: "No jobs yet.", text: "A job starts when you approve a job spec on Briefs.", href: "/", cta: "Open briefs" };
    return {
      title: "Nothing needs you right now.",
      text: active.length ? `${plural(active.length, "job is", "jobs are")} moving. This page updates itself while agents work.` : "Every job is done or closed. New ones start from Briefs.",
      href: "/",
      cta: "Open briefs",
    };
  })();

  const tabs = [
    { key: "active", label: "Active", list: active },
    { key: "needs", label: "Needs you", list: waiting },
    { key: "done", label: "Done", list: done },
    { key: "stopped", label: "Closed", list: stopped },
    { key: "all", label: "All jobs", list: jobs },
  ];
  const current = tabs.find((t) => t.key === tab) ?? tabs[0];
  const empty: Record<string, string> = {
    active: jobs.length ? "No active jobs. Every job is done or closed." : "No jobs yet. Approve a job spec on Briefs to create one.",
    needs: "No job needs you right now.",
    done: "No hires yet. A job is done when someone is hired.",
    stopped: "No closed jobs.",
    all: "No jobs yet. Approve a job spec on Briefs to create one.",
  };

  return (
    <div className={`flex flex-col gap-10 pt-2 sm:gap-12 ${ink}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className={`min-w-0 flex-[1_1_240px] text-lg font-semibold tracking-tight uppercase sm:text-xl ${muted}`}>Jobs</div>
        <AutoRefresh active={anyRunning} />
        {active.length > 0 && (
          <span className="font-mono text-sm text-stone-600" title="Agent spend of active jobs / their budgets">
            {usd(spent)} of {usd(budgets)} job budgets
          </span>
        )}
      </div>

      <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] sm:text-7xl lg:text-[5.5rem]">
        Every role.
        <br />
        One glance.
      </h1>

      <section aria-label="The next useful thing" className="flex flex-wrap items-center gap-x-8 gap-y-6 rounded-md bg-brand px-6 py-8 text-ink sm:px-12 sm:py-12">
        <div className="min-w-0 flex-[1_1_360px]">
          <div className="text-xs font-semibold tracking-[0.25em] uppercase sm:text-sm">The next useful thing</div>
          <p className="mt-4 text-2xl tracking-tight sm:text-4xl">{next.title}</p>
          <p className="mt-4 text-base">{next.text}</p>
        </div>
        <Link href={next.href} className="inline-flex items-center gap-3 rounded-xl bg-ink px-7 py-4 text-lg font-semibold whitespace-nowrap text-white hover:bg-black">
          {next.cta} {icons.arrowUpRight}
        </Link>
      </section>

      <div id="list" className="flex scroll-mt-6 flex-col gap-4">
        <nav className="flex flex-wrap gap-1 sm:gap-2" aria-label="Jobs">
          {tabs.map((t) => {
            const on = t.key === current.key;
            return (
              <Link
                key={t.key}
                href={t.key === "active" ? "/jobs" : `/jobs?tab=${t.key}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3.5 py-2.5 text-base whitespace-nowrap sm:px-5 sm:py-3 sm:text-lg ${on ? "bg-ink text-white" : `${muted} hover:text-ink`}`}
              >
                {t.label} · {t.list.length}
              </Link>
            );
          })}
        </nav>

        {current.list.length ? (
          <ul className={`divide-y divide-stone-300 border-b ${line}`}>{current.list.map((j, i) => row(j, i + 1))}</ul>
        ) : (
          <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{empty[current.key]}</div>
        )}
        {current.list.some((j) => pOf(j).stageCounts.sourced > 0) && (
          <p className={`text-sm ${muted}`}>Each bar has 8 steps: sourced, shortlisted, contacted, replied, pre-screened, sent to client, interview, hired. Open a job for the numbers.</p>
        )}
      </div>
    </div>
  );
}
