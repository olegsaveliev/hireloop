import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { dateTime, pct, usd } from "@/lib/format";
import { qualityPerAgent, type QualityRow } from "@/lib/quality";
import { icons } from "../icons";
import { ConnectionTestButton } from "./test-button";

type Totals = { runs: number; cost: number; budget: number };
type Sums = { _count: { _all: number }; _sum: { costUsd: number | null; budgetUsd: number | null } };

// Database group sums -> rows for a totals table. Groups with the same name (e.g. two deleted jobs) are merged.
function totalsBy<T extends Sums>(groups: T[], name: (g: T) => string) {
  const m = new Map<string, Totals>();
  for (const g of groups) {
    const t = m.get(name(g)) ?? { runs: 0, cost: 0, budget: 0 };
    t.runs += g._count._all;
    t.cost += g._sum.costUsd ?? 0;
    t.budget += g._sum.budgetUsd ?? 0;
    m.set(name(g), t);
  }
  return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
}

// The table shows the newest PAGE_SIZE runs; "Load more" adds PAGE_SIZE more (kept in the URL as ?limit=).
const PAGE_SIZE = 50;
const TABS = ["all", "over", "agent", "job", "quality"] as const;
type Tab = (typeof TABS)[number];

// Link that keeps the other settings as they are. Changing tab or evals starts again at the first PAGE_SIZE runs.
const href = (tab: Tab, evals: boolean, limit = PAGE_SIZE) => {
  const q = new URLSearchParams({
    ...(tab !== "all" ? { tab } : {}),
    ...(evals ? { evals: "1" } : {}),
    ...(limit > PAGE_SIZE ? { limit: String(limit) } : {}),
  }).toString();
  return q ? `/runs?${q}` : "/runs";
};

// Briefs style (2026-10-10): big headline, lime "next useful thing", four big figures, pill tabs, then plain tables
// on the page (no cards). % of budget is a number with a small bar.
const ink = "text-ink";
const muted = "text-stone-500";
const line = "border-stone-300";
const outline = `inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-5 py-2.5 text-base hover:bg-white ${line} ${ink}`;
const badge = "rounded px-2 py-0.5 text-xs whitespace-nowrap";
const th = "px-3 py-3 font-mono text-[11px] font-normal tracking-[0.15em] uppercase text-stone-500 whitespace-nowrap";
const td = "px-3 py-3.5";
const mono = `${td} whitespace-nowrap font-mono text-[13px] tabular-nums text-stone-700`;

// "claude-haiku-4-5-20251001" -> "Haiku"; the full name is in the tooltip.
const modelName = (m: string) => (m.includes("haiku") ? "Haiku" : m.includes("sonnet") ? "Sonnet" : m.includes("opus") ? "Opus" : m.replace("claude-", ""));

// Screen 4: every agent run with cost vs budget and a link to its Langfuse trace.
export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  await connection();
  const params = await searchParams;
  // ?over=1 is the old link (still used by the Approval queue).
  const tab: Tab = TABS.find((t) => t === params.tab) ?? (params.over === "1" ? "over" : "all");
  const overOnly = tab === "over";
  // Eval runs (`npm run eval`) are hidden unless asked for: they are prompt tests, not recruiter work.
  const showEvals = params.evals === "1";
  const limit = Math.max(PAGE_SIZE, Math.floor(Number(params.limit)) || PAGE_SIZE);

  // Only the rows on screen are loaded; counts and totals are added up by the database over all matching runs.
  const listed = showEvals ? {} : { isEval: false }; // totals ignore "Over budget", as before
  const where = overOnly ? { ...listed, overBudget: true } : listed;
  const sums = { _count: { _all: true }, _sum: { costUsd: true, budgetUsd: true } } as const;
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const [runs, matchingCount, evalCount, overCount, failedCount, overToday, agentSums, jobSums, jobs, quality] = await Promise.all([
    db.agentRun.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
    db.agentRun.count({ where }),
    db.agentRun.count({ where: { isEval: true } }),
    db.agentRun.count({ where: { ...listed, overBudget: true } }),
    db.agentRun.count({ where: { ...listed, status: { not: "succeeded" } } }),
    db.agentRun.findMany({ where: { ...listed, overBudget: true, createdAt: { gte: today } }, select: { agent: true } }),
    db.agentRun.groupBy({ by: ["agent"], where: listed, ...sums }),
    db.agentRun.groupBy({ by: ["jobId"], where: listed, ...sums }),
    db.job.findMany({ select: { id: true, title: true } }),
    qualityPerAgent(),
  ]);
  const jobTitle = (id: string | null) => (id ? (jobs.find((j) => j.id === id)?.title ?? "(deleted job)") : "(no job)");

  const byAgent = totalsBy(agentSums, (g) => g.agent);
  const byJob = totalsBy(jobSums, (g) => jobTitle(g.jobId));
  const all = byAgent.reduce((a, [, t]) => ({ runs: a.runs + t.runs, cost: a.cost + t.cost, budget: a.budget + t.budget }), { runs: 0, cost: 0, budget: 0 });

  // "The next useful thing": over-budget runs first (today's, else any), then failed runs, else the calm line.
  const agentsToday = [...new Set(overToday.map((r) => r.agent))];
  const say = (n: number) => (n === 2 ? "Two" : n === 3 ? "Three" : String(n));
  const next = overToday.length
    ? {
        title: overToday.length === 1 ? "One run went over budget today." : `${say(overToday.length)} runs went over budget today.`,
        text: `From ${agentsToday.join(" and ")}. Look at them before changing a budget in src/config/budgets.ts.`,
        href: href("over", showEvals),
        cta: "Show over budget",
      }
    : overCount
      ? {
          title: overCount === 1 ? "One run went over budget." : `${say(overCount)} runs went over budget.`,
          text: "None today. Look at them before changing a budget in src/config/budgets.ts.",
          href: href("over", showEvals),
          cta: "Show over budget",
        }
      : failedCount
        ? {
            title: failedCount === 1 ? "One run didn't finish." : `${say(failedCount)} runs didn't finish.`,
            text: "Their status is red in the list; hover it to read the error.",
            href: `${href("all", showEvals)}#list`,
            cta: "Show runs",
          }
        : {
            title: all.runs ? "Every run stayed in budget." : "No agent runs yet.",
            text: all.runs
              ? `${usd(all.cost)} spent, ${pct(all.budget ? all.cost / all.budget : 0)} of the summed run budgets. See how good the agents' work was under Quality.`
              : "Run the connection test to send one test trace to Langfuse.",
            href: all.runs ? href("quality", showEvals) : href("all", showEvals),
            cta: all.runs ? "Show quality" : "Show runs",
          };

  const figures = [
    { value: String(all.runs), label: "Runs", note: showEvals ? "eval runs included" : "eval runs hidden" },
    { value: usd(all.cost), label: "Agent spend", note: `${pct(all.budget ? all.cost / all.budget : 0)} of summed run budgets` },
    { value: String(overCount), label: "Over budget", note: "above 1× their budget", bad: overCount > 0 },
    { value: String(failedCount), label: "Failed", note: failedCount ? "didn't succeed" : "every run finished", bad: failedCount > 0 },
  ];
  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: `All runs · ${all.runs}` },
    { key: "over", label: `Over budget · ${overCount}` },
    { key: "agent", label: "Per agent" },
    { key: "job", label: "Per job" },
    { key: "quality", label: "Quality" },
  ];
  const langfuse = process.env.LANGFUSE_BASE_URL;

  return (
    <div className={`flex min-w-0 flex-col gap-10 pt-2 sm:gap-12 ${ink}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className={`min-w-0 flex-[1_1_240px] text-lg font-semibold tracking-tight uppercase sm:text-xl ${muted}`}>Agent runs</div>
        <ConnectionTestButton />
        {langfuse && (
          <a href={langfuse} target="_blank" rel="noreferrer" className={outline}>
            Langfuse {icons.arrowUpRight}
          </a>
        )}
      </div>

      <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] sm:text-7xl lg:text-[5.5rem]">
        Every run.
        <br />
        Every cent.
      </h1>

      <section aria-label="The next useful thing" className="flex flex-wrap items-center gap-x-8 gap-y-6 rounded-md bg-brand px-6 py-8 text-ink sm:px-12 sm:py-12">
        <div className="min-w-0 flex-[1_1_360px]">
          <div className="text-xs font-semibold tracking-[0.25em] uppercase sm:text-sm">The next useful thing</div>
          <p className="mt-4 text-2xl tracking-tight sm:text-4xl">{next.title}</p>
          <p className="mt-4 text-base">{next.text}</p>
        </div>
        <Link href={next.href} scroll={false} className="inline-flex items-center gap-3 rounded-xl bg-ink px-7 py-4 text-lg font-semibold whitespace-nowrap text-white hover:bg-black">
          {next.cta} {icons.arrowUpRight}
        </Link>
      </section>

      <ol className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
        {figures.map((f) => (
          <li key={f.label} className="min-w-0">
            <div className={`text-[2.75rem] leading-none font-bold tracking-[-0.045em] tabular-nums sm:text-[4rem] ${f.bad ? "text-rose-700" : ""}`}>{f.value}</div>
            <div className="mt-3 text-[13px] tracking-[0.08em] uppercase">{f.label}</div>
            <div className={`mt-1 text-sm ${muted}`}>{f.note}</div>
          </li>
        ))}
      </ol>

      <div id="list" className="flex min-w-0 scroll-mt-6 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <nav className="flex flex-wrap gap-1 sm:gap-2" aria-label="Runs">
            {tabs.map((t) => {
              const on = t.key === tab;
              return (
                <Link
                  key={t.key}
                  href={href(t.key, showEvals)}
                  scroll={false}
                  aria-current={on ? "page" : undefined}
                  className={`rounded-xl px-3.5 py-2.5 text-base whitespace-nowrap sm:px-5 sm:py-3 sm:text-lg ${on ? "bg-ink text-white" : `${muted} hover:text-ink`}`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
          <Link href={href(tab, !showEvals)} scroll={false} role="checkbox" aria-checked={showEvals} className={`ml-auto inline-flex items-center gap-2 text-base ${muted} hover:text-ink`}>
            <span className={`flex size-4 items-center justify-center rounded border ${showEvals ? "border-ink bg-ink text-white" : "border-stone-400"}`}>
              {showEvals && <span className="size-1.5 rounded-sm bg-white" />}
            </span>
            Show eval runs ({evalCount})
          </Link>
        </div>

        {tab === "agent" ? (
          <TotalsTable rows={byAgent} empty="No agent runs yet." />
        ) : tab === "job" ? (
          <TotalsTable rows={byJob} empty="No agent runs yet." />
        ) : tab === "quality" ? (
          <QualityTable rows={quality} />
        ) : runs.length === 0 ? (
          <Empty>{overOnly ? "No over-budget runs." : "No agent runs yet. Try the connection test above."}</Empty>
        ) : (
          <>
            <div className={`overflow-x-auto border-b ${line}`}>
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr>
                    {["When", "Agent", "Job", "Model", "Status", "Tokens in / out", "Cost", "Budget", "% of budget", "Trace"].map((h) => (
                      <th key={h} className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const share = r.budgetUsd ? r.costUsd / r.budgetUsd : 0;
                    const ok = r.status === "succeeded";
                    return (
                      <tr key={r.id} className={`border-t ${line}`}>
                        <td className={`${td} whitespace-nowrap ${muted}`}>{dateTime(r.createdAt)}</td>
                        <td className={`${td} whitespace-nowrap`} title={r.promptVersion ? `Prompt version ${r.promptVersion}` : undefined}>
                          <span className="text-base">{r.agent}</span>
                          {r.isEval && <span className={`${badge} ml-2 bg-violet-100 text-violet-800`}>eval</span>}
                        </td>
                        <td className={`${td} max-w-48 truncate ${muted}`} title={r.jobId ? jobTitle(r.jobId) : undefined}>
                          {r.jobId ? jobTitle(r.jobId) : "–"}
                        </td>
                        <td className={td} title={r.model}>
                          <span className={`${badge} bg-soft text-olive`}>{modelName(r.model)}</span>
                        </td>
                        <td className={td} title={r.error ?? undefined}>
                          {!ok ? (
                            <span className={`${badge} bg-rose-100 text-rose-800`}>{r.status.replaceAll("_", " ")}</span>
                          ) : r.overBudget ? (
                            <span className={`${badge} bg-rose-100 text-rose-800`}>Over budget</span>
                          ) : (
                            <span className={`${badge} bg-emerald-100 text-emerald-800`}>Done</span>
                          )}
                        </td>
                        <td className={mono} title={`${r.numTurns} turn${r.numTurns === 1 ? "" : "s"}`}>
                          {r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}
                        </td>
                        <td className={mono}>{usd(r.costUsd)}</td>
                        <td className={mono}>{usd(r.budgetUsd)}</td>
                        <td className={td}>
                          <Share share={share} over={r.overBudget} />
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          {r.traceUrl ? (
                            <a href={r.traceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4 hover:no-underline">
                              Langfuse {icons.arrowUpRight}
                            </a>
                          ) : (
                            <span className="font-mono text-xs text-stone-400">{r.traceId ? r.traceId.slice(0, 8) : "–"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={`flex flex-wrap items-center gap-4 text-sm ${muted}`}>
              {runs.length < matchingCount && (
                <Link href={href(tab, showEvals, limit + PAGE_SIZE)} scroll={false} className={outline}>
                  Load {Math.min(PAGE_SIZE, matchingCount - runs.length)} more
                </Link>
              )}
              <span>
                Showing {runs.length} of {matchingCount} runs
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{children}</div>;
}

// % of budget: a small olive bar (red when the run went over its budget) and the number.
function Share({ share, over }: { share: number; over: boolean }) {
  return (
    <div className="flex items-center gap-2.5 whitespace-nowrap">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-200">
        <div className={`h-full rounded-full ${over ? "bg-rose-600" : "bg-olive-mid"}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
      <span className="font-mono text-[13px] text-stone-700 tabular-nums">{pct(share)}</span>
    </div>
  );
}

function TotalsTable({ rows, empty }: { rows: [string, Totals][]; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className={`overflow-x-auto border-b ${line}`}>
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr>
            {["Name", "Runs", "Cost", "Budget", "% of budget"].map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, t]) => (
            <tr key={name} className={`border-t ${line}`}>
              <td className={`${td} max-w-72 truncate text-base`} title={name}>
                {name}
              </td>
              <td className={mono}>{t.runs}</td>
              <td className={mono}>{usd(t.cost)}</td>
              <td className={mono}>{usd(t.budget)}</td>
              <td className={td}>
                <Share share={t.budget ? t.cost / t.budget : 0} over={t.cost > t.budget} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Same numbers the app sends to Langfuse as scores (src/lib/quality.ts).
function QualityTable({ rows }: { rows: QualityRow[] }) {
  return (
    <>
      <div className={`overflow-x-auto border-b ${line}`}>
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr>
              {["Agent", "Measure", "Value", "Based on"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agent} className={`border-t ${line}`}>
                <td className={`${td} whitespace-nowrap text-base`}>{r.agent}</td>
                <td className={`${td} text-stone-600`}>{r.measure}</td>
                <td className={td}>
                  {r.value === null ? (
                    <span className="text-stone-400">–</span>
                  ) : (
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-200">
                        <div className="h-full rounded-full bg-olive-mid" style={{ width: `${r.value * 100}%` }} />
                      </div>
                      <span className="font-mono text-[13px] text-stone-700 tabular-nums">{pct(r.value)}</span>
                    </div>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap ${muted}`}>
                  n = {r.n} {r.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`text-sm ${muted}`}>
        From recruiter decisions in this app. Sourcing and enrichment have no recruiter-decision score; see their costs under Per agent. Trends over
        time: Langfuse dashboard &quot;Hireloop agents&quot;.
      </p>
    </>
  );
}
