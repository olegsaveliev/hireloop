import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { OUTCOMES, type OutcomeKind } from "@/config/feedback";
import { AGENT_BUDGETS } from "@/config/budgets";
import { EVALS } from "@/evals/datasets";
import { SOURCE_LABELS, type CorrectionSource } from "@/agents/feedback/corrections";
import type { Fact, WeeklySummary } from "@/agents/feedback/schema";
import type { EvalSummary } from "@/agents/feedback/weekly";
import { ActionButton } from "../action-button";
import { AutoRefresh } from "../auto-refresh";
import { icons } from "../icons";
import { collectCorrectionsAction } from "./actions";
import { WeeklyButton } from "./weekly-button";

const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Briefs style (2026-10-10): big headline, lime "next useful thing", four big figures, pill tabs, numbered rows.
const ink = "text-ink";
const muted = "text-stone-500";
const line = "border-stone-300";
const outlineLink = `inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-5 py-2.5 text-base hover:bg-white ${line} ${ink}`;
const badge = "rounded px-2 py-0.5 text-xs font-normal tracking-normal whitespace-nowrap";
const th = "px-3 py-3 font-mono text-[11px] font-normal tracking-[0.15em] uppercase text-stone-500 whitespace-nowrap";
const td = "px-3 py-3.5";
const mono = `${td} whitespace-nowrap font-mono text-[13px] tabular-nums text-stone-700`;
const sub = "text-xs font-semibold tracking-[0.2em] uppercase text-stone-500";
const code = "rounded bg-soft px-1.5 py-0.5 font-mono text-xs text-olive";
const num = (n: number) => <span className={`w-8 shrink-0 self-start pt-1.5 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(n).padStart(2, "0")}</span>;
const OUTCOME_TAG: Record<string, string> = { hired: "bg-emerald-600 text-white", rejected_by_client: "bg-rose-100 text-rose-800", withdrew: "bg-stone-200 text-stone-600" };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Step 9 (docs/specs/09-feedback-loop.md): outcomes, corrections turned into dataset items, the weekly job, cost per hire.
export default async function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  await connection();
  const tab = (await searchParams).tab;
  const [outcomes, corrections, reports, jobCost, jobsWithRuns] = await Promise.all([
    db.outcome.findMany({ orderBy: { updatedAt: "desc" }, include: { job: { select: { id: true, title: true, clientId: true } } } }),
    db.datasetCorrection.findMany({ orderBy: { createdAt: "desc" } }),
    db.weeklyReport.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    db.agentRun.aggregate({ where: { jobId: { not: null }, isEval: false }, _sum: { costUsd: true } }),
    db.agentRun.groupBy({ by: ["jobId"], where: { jobId: { not: null }, isEval: false } }),
  ]);
  const clients = new Map((await db.client.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const names = new Map((await db.candidate.findMany({ where: { id: { in: [...outcomes, ...corrections].map((x) => x.candidateId ?? "") } }, select: { id: true, fullName: true } })).map((c) => [c.id, c.fullName]));
  const latest = reports[0];
  const running = latest?.status === "running";
  const summary = latest?.summary as WeeklySummary | null;
  const facts = (latest?.facts as Fact[] | null) ?? [];
  const evals = (latest?.evalResults as EvalSummary[] | null) ?? [];
  const traceUrl = latest?.agentRunIds && (latest.agentRunIds as string[]).length ? (await db.agentRun.findFirst({ where: { id: { in: latest.agentRunIds as string[] } }, orderBy: { createdAt: "desc" } }))?.traceUrl : null;

  const count = (o: OutcomeKind) => outcomes.filter((x) => x.outcome === o).length;
  const hires = count("hired");
  const spent = jobCost._sum.costUsd ?? 0;
  const checkable = corrections.filter((c) => c.checkKind).length;
  const unsynced = corrections.filter((c) => !c.syncedAt).length;
  const agents = Object.keys(EVALS);
  const ranThisWeek = latest && latest.status !== "failed" && +new Date() - +latest.createdAt < WEEK_MS;

  const tabs = [
    { key: "outcomes", label: `Outcomes · ${outcomes.length}` },
    { key: "corrections", label: `Corrections · ${corrections.length}` },
    { key: "datasets", label: `Datasets · ${agents.length}` },
    { key: "weekly", label: "Weekly review" },
  ];
  const active = tabs.find((t) => t.key === tab)?.key ?? "outcomes";

  // "The next useful thing": the weekly review if it hasn't run this week, then corrections not in Langfuse yet,
  // else this week's headline.
  const dark = "inline-flex items-center gap-3 rounded-xl bg-ink px-7 py-4 text-lg font-semibold whitespace-nowrap text-white hover:bg-black";
  const review = (
    <Link href="/feedback?tab=weekly" scroll={false} className={dark}>
      Read the review {icons.arrowUpRight}
    </Link>
  );
  const next: { title: string; text: string; cta: ReactNode } = running
    ? { title: "The weekly review is running.", text: "This page updates itself. It takes a minute, longer with datasets.", cta: review }
    : !ranThisWeek
      ? {
          title: latest?.status === "failed" ? "The last weekly review failed." : "This week’s review hasn’t run yet.",
          text: "It collects your corrections, can test each agent on its dataset, and writes what went wrong most often. About $0.10.",
          cta: <WeeklyButton running={running} big />,
        }
      : unsynced
        ? {
            title: `${plural(unsynced, "correction isn’t", "corrections aren’t")} in Langfuse yet.`,
            text: "Collect them so the agents' datasets include your latest fixes.",
            cta: <ActionButton action={collectCorrectionsAction} label="Collect corrections" pendingLabel="Collecting…" variant="darkLg" />,
          }
        : { title: summary?.headline ?? "This week’s review is done.", text: `${plural(summary?.issues.length ?? 0, "issue", "issues")} found from ${plural(facts.length, "fact", "facts")}.`, cta: review };

  const figures = [
    { value: String(outcomes.length), label: "Outcomes", note: `${hires} hired · ${count("rejected_by_client")} rejected · ${count("withdrew")} withdrew` },
    { value: outcomes.length ? `${Math.round((hires / outcomes.length) * 100)}%` : "–", label: "Hire rate", note: "hired / outcomes" },
    { value: hires ? money(spent / hires) : "–", label: "Cost per hire", note: `all job agent runs (${money(spent)}, ${plural(jobsWithRuns.length, "job", "jobs")}) / hires` },
    { value: String(corrections.length), label: "Corrections", note: `${checkable} with an automatic check · ${unsynced ? `${unsynced} not in Langfuse yet` : "all in Langfuse"}` },
  ];

  return (
    <div className={`flex min-w-0 flex-col gap-10 pt-2 sm:gap-12 ${ink}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className={`min-w-0 flex-[1_1_240px] text-lg font-semibold tracking-tight uppercase sm:text-xl ${muted}`}>Feedback</div>
        <AutoRefresh active={running} />
        <ActionButton action={collectCorrectionsAction} label="Collect corrections now" pendingLabel="Collecting…" variant="outline" />
      </div>

      <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] sm:text-7xl lg:text-[5.5rem]">
        Every outcome
        <br />
        teaches the agents.
      </h1>

      <section aria-label="The next useful thing" className="flex flex-wrap items-center gap-x-8 gap-y-6 rounded-md bg-brand px-6 py-8 text-ink sm:px-12 sm:py-12">
        <div className="min-w-0 flex-[1_1_360px]">
          <div className="text-xs font-semibold tracking-[0.25em] uppercase sm:text-sm">The next useful thing</div>
          <p className="mt-4 text-2xl tracking-tight sm:text-4xl">{next.title}</p>
          <p className="mt-4 text-base">{next.text}</p>
        </div>
        {next.cta}
      </section>

      <ol className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
        {figures.map((f) => (
          <li key={f.label} className="min-w-0">
            <div className="text-[2.75rem] leading-none font-bold tracking-[-0.045em] tabular-nums sm:text-[4rem]">{f.value}</div>
            <div className="mt-3 text-[13px] tracking-[0.08em] uppercase">{f.label}</div>
            <div className={`mt-1 text-sm ${muted}`}>{f.note}</div>
          </li>
        ))}
      </ol>

      <div id="list" className="flex min-w-0 scroll-mt-6 flex-col gap-4">
        <nav className="flex flex-wrap gap-1 sm:gap-2" aria-label="Feedback">
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <Link
                key={t.key}
                href={t.key === "outcomes" ? "/feedback" : `/feedback?tab=${t.key}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3.5 py-2.5 text-base whitespace-nowrap sm:px-5 sm:py-3 sm:text-lg ${on ? "bg-ink text-white" : `${muted} hover:text-ink`}`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        {active === "outcomes" && (
          <>
            <Note>
              Recorded on the Job page (“Record outcome” on a candidate). Each one adds <span className={code}>final_outcome</span> (hired = 1, otherwise 0, the reason as
              comment) to the candidate&apos;s screening, pre-screen and submission traces in Langfuse.
            </Note>
            {outcomes.length === 0 ? (
              <Empty>No outcomes yet. Open a job, find a candidate who replied, and click “Record outcome…”.</Empty>
            ) : (
              <ul className={`divide-y divide-stone-300 border-y ${line}`}>
                {outcomes.map((o, i) => {
                  const traces = (o.scoredTraces as { agent: string }[]).map((t) => t.agent);
                  return (
                    <li key={o.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-6 sm:flex-nowrap">
                      {num(i + 1)}
                      <div className="min-w-0 flex-[1_1_300px]">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xl tracking-tight sm:text-2xl">
                          {names.get(o.candidateId) ?? o.candidateId}
                          <span className={`${badge} ${OUTCOME_TAG[o.outcome] ?? "bg-stone-200 text-stone-600"}`}>{OUTCOMES[o.outcome as OutcomeKind]?.label ?? o.outcome}</span>
                        </div>
                        <div className={`mt-1.5 text-sm tracking-wide uppercase ${muted}`}>{[clients.get(o.job.clientId), o.job.title, dateTime(o.updatedAt)].filter(Boolean).join(" / ")}</div>
                        <p className="mt-1.5 max-w-3xl text-base leading-snug text-stone-600">
                          {o.reason && (
                            <>
                              <span className="font-semibold text-ink">Reason:</span> {o.reason}{" "}
                            </>
                          )}
                          {traces.length ? `Scored on ${plural(traces.length, "Langfuse trace", "Langfuse traces")}: ${traces.join(", ")}.` : "No traces scored."}
                        </p>
                      </div>
                      <Link href={`/jobs/${o.job.id}`} className={outlineLink}>
                        Open job {icons.arrowUpRight}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {active === "corrections" && (
          <>
            <Note>
              Every time a human corrected an agent (score override, intent marked Wrong, a draft edited or rejected, a recommendation not followed), the input and the
              corrected output are added to that agent&apos;s Langfuse dataset. “Auto check” items are run by <span className={code}>npm run eval</span> (score within ±10
              of the override, or the right intent); “reference” items are examples to read when changing a prompt. Collected when an outcome is recorded, by the weekly
              review, or with the button at the top.
            </Note>
            {corrections.length === 0 ? (
              <Empty>No corrections yet.</Empty>
            ) : (
              <ul className={`divide-y divide-stone-300 border-y ${line}`}>
                {corrections.map((c, i) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-6 sm:flex-nowrap">
                    {num(i + 1)}
                    <div className="min-w-0 flex-[1_1_300px]">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xl tracking-tight sm:text-2xl">
                        {SOURCE_LABELS[c.source as CorrectionSource] ?? c.source}
                        <span className={`${badge} ${c.checkKind ? "bg-soft text-olive" : "bg-stone-200 text-stone-600"}`}>{c.checkKind ? "Auto check" : "Reference"}</span>
                        <span className={`${badge} ${c.syncedAt ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{c.syncedAt ? "In Langfuse" : "Not in Langfuse yet"}</span>
                      </div>
                      <div className={`mt-1.5 text-sm tracking-wide uppercase ${muted}`}>
                        {[c.agent, c.candidateId && (names.get(c.candidateId) ?? c.candidateId), dateTime(c.createdAt)].filter(Boolean).join(" / ")}
                      </div>
                      <p className="mt-1.5 max-w-3xl text-base leading-snug break-words text-stone-600">
                        <span className="font-semibold text-ink">Expected:</span> {c.expected.length > 240 ? `${c.expected.slice(0, 239)}…` : c.expected}
                      </p>
                    </div>
                    {c.jobId && (
                      <Link href={`/jobs/${c.jobId}`} className={outlineLink}>
                        Open job {icons.arrowUpRight}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {active === "datasets" && (
          <>
            <Note>
              One dataset per agent, in Langfuse. To compare two prompt versions: run <span className={code}>npm run eval -- &lt;agent&gt;</span>, edit the prompt file in{" "}
              <span className={code}>/prompts</span>, run it again, then in Langfuse open Datasets → the agent → select both runs → Compare. Each run is named after its
              prompt version.
            </Note>
            <div className={`overflow-x-auto border-b ${line}`}>
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr>
                    {["Agent", "Model", "Eval items (code)", "Corrections", "Total (app)", "Run it"].map((h) => (
                      <th key={h} className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => {
                    const mine = corrections.filter((c) => c.agent === a);
                    return (
                      <tr key={a} className={`border-t ${line}`}>
                        <td className={`${td} text-base whitespace-nowrap`}>{a}</td>
                        <td className={`${td} font-mono text-xs whitespace-nowrap ${muted}`}>{AGENT_BUDGETS[a as keyof typeof AGENT_BUDGETS]?.model}</td>
                        <td className={mono}>{EVALS[a].items.length}</td>
                        <td className={`${td} whitespace-nowrap ${muted}`}>{mine.length ? `${mine.length} (${mine.filter((c) => c.checkKind).length} auto check)` : "–"}</td>
                        <td className={`${mono} font-semibold`}>{EVALS[a].items.length + mine.length}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          <span className={code}>npm run eval -- {a}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Note>
              Langfuse can show a few more items per dataset: the test scripts add test cases that need app state (e.g. one for sourcing-agent). Those aren&apos;t run by the
              eval. Outcome labels: {Object.values(OUTCOMES).map((o) => `${o.label} = ${o.score}`).join(", ")}.
            </Note>
          </>
        )}

        {active === "weekly" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <Note>
                Collects new corrections into the datasets, optionally runs every agent over its dataset, then Sonnet writes “what went wrong most often this week” from
                the week&apos;s facts (corrections, outcomes, escalations, problems, run stats). Hosted version: runs every Monday by itself (Trigger.dev).
              </Note>
              <WeeklyButton running={running} />
            </div>
            {!latest ? (
              <Empty>Not run yet. Click Run now.</Empty>
            ) : (
              <div className={`border-t pt-6 ${line}`}>
                <div className={`text-sm tracking-wide uppercase ${muted}`}>
                  {[
                    `Week ${dateTime(latest.periodStart)} – ${dateTime(latest.periodEnd)}`,
                    plural(latest.correctionsAdded, "new correction", "new corrections"),
                    plural(facts.length, "fact", "facts"),
                    `cost ${money(latest.costUsd)}`,
                  ].join(" / ")}
                  {latest.status !== "succeeded" && <span className={`${badge} ml-3 normal-case ${running ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{running ? "Running" : latest.status}</span>}
                </div>
                {latest.error && <div className="mt-2 text-rose-700">{latest.error}</div>}
                {summary && (
                  <>
                    <p className="mt-4 max-w-4xl text-2xl tracking-tight sm:text-4xl">{summary.headline}</p>
                    {traceUrl && (
                      <a href={traceUrl} target="_blank" rel="noreferrer" className={`${outlineLink} mt-5`}>
                        Langfuse trace {icons.arrowUpRight}
                      </a>
                    )}
                    {summary.issues.length > 0 && (
                      <ol className={`mt-8 divide-y divide-stone-300 border-y ${line}`}>
                        {summary.issues.map((issue, i) => (
                          <li key={i} className="flex gap-x-6 py-6">
                            {num(i + 1)}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <span className={code}>{issue.agent}</span>
                                <span className={`text-sm ${muted}`}>{plural(issue.evidence.length, "fact", "facts")}</span>
                              </div>
                              <p className="mt-2 max-w-3xl text-lg leading-snug">{issue.what_went_wrong}</p>
                              <p className="mt-3 max-w-3xl border-l-4 border-olive-line pl-4 text-base text-stone-700">
                                <span className="font-semibold text-ink">Suggestion: </span>
                                {issue.suggestion}
                              </p>
                              <details className={`group mt-3 text-sm ${muted}`}>
                                <summary className="cursor-pointer hover:text-ink">Evidence: {issue.evidence.join(", ")}</summary>
                                <ul className="mt-1 space-y-0.5 pl-5">
                                  {issue.evidence.map((id) => (
                                    <li key={id}>
                                      <span className="font-mono text-xs">{id}</span> {facts.find((f) => f.id === id)?.text}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                    {(summary.going_well.length > 0 || summary.open_questions.length > 0) && (
                      <div className="mt-8 grid gap-6 md:grid-cols-2">
                        {[
                          { title: "Going well", items: summary.going_well },
                          { title: "Open questions", items: summary.open_questions },
                        ]
                          .filter((b) => b.items.length > 0)
                          .map((b) => (
                            <div key={b.title}>
                              <div className={sub}>{b.title}</div>
                              <ul className="mt-3 space-y-1.5">
                                {b.items.map((g, i) => (
                                  <li key={i} className="flex gap-2">
                                    <span className="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-olive-mid" />
                                    {g}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                      </div>
                    )}
                    <details className={`mt-8 text-sm ${muted}`}>
                      <summary className="cursor-pointer hover:text-ink">All {facts.length} facts the agent was given</summary>
                      <ul className="mt-1 space-y-0.5 pl-5">
                        {facts.map((f) => (
                          <li key={f.id}>
                            <span className="font-mono text-xs">{f.id}</span> [{f.kind}] [{f.agent}] {f.text}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                )}
                {evals.length > 0 && (
                  <div className="mt-8">
                    <div className={sub}>Datasets run this week</div>
                    <div className={`mt-1 text-sm ${muted}`}>Open them in Langfuse to compare prompt versions.</div>
                    <div className={`mt-3 overflow-x-auto border-y ${line}`}>
                      <table className="w-full text-sm">
                        <tbody>
                          {evals.map((e) => (
                            <tr key={e.agent} className={`border-t first:border-t-0 ${line}`}>
                              <td className={`${td} whitespace-nowrap`}>{e.agent}</td>
                              <td className={`${td} ${e.error || e.passed < e.total ? "text-rose-700" : "text-emerald-700"}`}>{e.error ? `error: ${e.error}` : `${e.passed}/${e.total} passed`}</td>
                              <td className={mono}>{money(e.costUsd)}</td>
                              <td className={td}>
                                {e.url ? (
                                  <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                                    {e.runName} {icons.arrowUpRight}
                                  </a>
                                ) : (
                                  <span className={muted}>{e.runName}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className={`max-w-4xl text-base leading-relaxed ${muted}`}>{children}</p>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{children}</div>;
}
