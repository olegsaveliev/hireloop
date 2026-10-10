// Step 9 weekly job (docs/specs/09-feedback-loop.md, agent step 4). Prototype: "Run now" on the Feedback page;
// hosted version: a Trigger.dev schedule (docs/hosting.md). One run:
//   1. collects the recruiter's corrections into the agents' datasets (no AI);
//   2. optionally runs every agent over its dataset (src/evals/run.ts; real model calls, ~$0.50);
//   3. the app gathers the week's facts and Sonnet writes "what went wrong most often this week".
// Everything is saved in weekly_reports (no files).
import { db } from "@/lib/db";
import { MAX_SUMMARY_ISSUES, OUTCOMES, WEEKLY_PERIOD_DAYS, type OutcomeKind } from "@/config/feedback";
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { flushTelemetry } from "../telemetry";
import { collectCorrections, SOURCE_LABELS, type CorrectionSource } from "./corrections";
import { weeklySummarySchema, type Fact, type WeeklySummary } from "./schema";
import type { WorkflowResult } from "../job-spec/workflow";

const AGENT = "feedback-weekly-summary" as const;
const DAY = 86_400_000;
const STEP_AGENT: Record<number, string> = { 1: "job-spec-agent", 2: "sourcing-agent", 3: "enrichment-agent", 4: "screening-agent", 5: "outreach-draft", 6: "prescreen-agent", 7: "submission-agent", 8: "scheduling-agent" };
const MAX_FACTS = 80;
const short = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type EvalSummary = { agent: string; passed: number; total: number; costUsd: number; runName: string; url: string | null; failed: { id: string; detail: string }[]; error?: string };

// ---------- the week's facts (code, no AI) ----------

export async function gatherFacts(from: Date, to: Date, evals: EvalSummary[] = []): Promise<Fact[]> {
  const inPeriod = { gte: from, lte: to };
  const facts: Fact[] = [];
  const add = (prefix: string, kind: string, agent: string, text: string) => facts.push({ id: `${prefix}${facts.filter((f) => f.id.startsWith(prefix)).length + 1}`, kind, agent, text: short(text) });

  // Corrections (the main signal).
  for (const c of await db.datasetCorrection.findMany({ where: { createdAt: inPeriod }, orderBy: { createdAt: "asc" } })) {
    add("C", "correction", c.agent, `${SOURCE_LABELS[c.source as CorrectionSource] ?? c.source}${c.candidateId ? ` (${c.candidateId})` : ""}: ${c.expected}`);
  }

  // Final outcomes, with what the agents said about the candidate.
  const outcomes = await db.outcome.findMany({ where: { updatedAt: inPeriod }, include: { job: { select: { title: true } } } });
  for (const o of outcomes) {
    const [s, p] = await Promise.all([
      db.screeningResult.findFirst({ where: { jobId: o.jobId, candidateId: o.candidateId, current: true } }),
      db.prescreen.findUnique({ where: { jobId_candidateId: { jobId: o.jobId, candidateId: o.candidateId } } }),
    ]);
    const said = [s?.score != null ? `screening score ${s.overrideScore ?? s.score}${s.overrideScore != null ? ` (agent ${s.score})` : ""}` : null, p?.recommendation ? `pre-screen “${p.recommendation}”` : null].filter(Boolean).join(", ");
    add("O", "outcome", "process", `${OUTCOMES[o.outcome as OutcomeKind]?.label ?? o.outcome}: ${o.candidateId} for “${o.job.title}”${said ? ` (${said})` : ""}. Reason: “${o.reason}”`);
  }

  // Escalations and problems handed to a human.
  const items = await db.approvalItem.findMany({ where: { createdAt: inPeriod, kind: { in: ["scheduling", "stopped_run", "failed_run", "job_budget", "no_candidates"] } }, orderBy: { createdAt: "asc" } });
  for (const i of items) {
    add(i.kind === "scheduling" ? "E" : "P", i.kind === "scheduling" ? "escalation" : "problem", i.kind === "job_budget" || i.kind === "no_candidates" ? "process" : (STEP_AGENT[i.step] ?? "process"), `${i.title}${i.detail ? `: ${i.detail}` : ""}`);
  }

  // Evals run by this weekly job.
  for (const e of evals) {
    add("V", "eval", e.agent, e.error ? `Eval could not run: ${e.error}` : `${e.passed}/${e.total} dataset items passed${e.failed.length ? `. Failed: ${e.failed.map((f) => `${f.id} (${short(f.detail, 120)})`).join("; ")}` : ""}`);
  }

  // Stats per agent: real app runs only (job runs; test and eval runs are not linked to a job).
  const runs = await db.agentRun.groupBy({ by: ["agent", "status", "overBudget"], where: { createdAt: inPeriod, isEval: false, jobId: { not: null } }, _count: true, _sum: { costUsd: true } });
  const decided = await approvalStats(from, to);
  for (const agent of [...new Set([...runs.map((r) => r.agent), ...Object.keys(decided)])].sort()) {
    const mine = runs.filter((r) => r.agent === agent);
    const n = mine.reduce((x, r) => x + r._count, 0);
    const cost = mine.reduce((x, r) => x + (r._sum.costUsd ?? 0), 0);
    const over = mine.filter((r) => r.overBudget).reduce((x, r) => x + r._count, 0);
    const failed = mine.filter((r) => r.status !== "succeeded").reduce((x, r) => x + r._count, 0);
    const d = decided[agent];
    add("S", "stats", agent, `${n} run(s), $${cost.toFixed(2)}, ${over} over budget, ${failed} failed or stopped${d ? `; ${d.clean} of ${d.total} ${d.what} approved without edits` : ""}`);
  }
  return facts.slice(0, MAX_FACTS);
}

// Approved-without-edits counts for the week (same rules as the Langfuse scores and the Runs page quality table).
async function approvalStats(from: Date, to: Date): Promise<Record<string, { clean: number; total: number; what: string }>> {
  const inPeriod = { gte: from, lte: to };
  const out: Record<string, { clean: number; total: number; what: string }> = {};
  const specs = await db.jobSpec.findMany({ where: { decidedAt: inPeriod, status: { in: ["approved", "rejected"] } } });
  if (specs.length) out["job-spec-agent"] = { clean: specs.filter((s) => s.status === "approved" && s.fieldsEdited === 0).length, total: specs.length, what: "specs" };
  const drafts = (await db.message.findMany({ where: { decidedAt: inPeriod, direction: "outbound", kind: { in: ["first", "follow_up"] }, status: { in: ["sent", "rejected"] } } })).filter((m) => m.agentDraft);
  if (drafts.length) {
    const clean = drafts.filter((m) => {
      const a = m.agentDraft as { subject: string; body: string };
      return m.status === "sent" && a.subject.trim() === m.subject.trim() && a.body.trim() === m.body.trim();
    }).length;
    out["outreach-draft"] = { clean, total: drafts.length, what: "drafts" };
  }
  const subs = await db.submission.findMany({ where: { decidedAt: inPeriod, status: { in: ["sent", "rejected"] } } });
  if (subs.length) out["submission-agent"] = { clean: subs.filter((s) => s.status === "sent" && JSON.stringify(s.agentDraft) === JSON.stringify(s.data)).length, total: subs.length, what: "submissions" };
  return out;
}

// ---------- the summary (Sonnet) ----------

export async function runWeeklySummary(args: { facts: Fact[]; from: Date; to: Date; extraTags?: string[] }) {
  const prompt = [
    `Week: ${args.from.toISOString().slice(0, 10)} to ${args.to.toISOString().slice(0, 10)}. At most ${MAX_SUMMARY_ISSUES} issues.`,
    `<facts>\n${args.facts.length ? args.facts.map((f) => `${f.id} [${f.kind}] [${f.agent}] ${f.text}`).join("\n") : "(no facts this week)"}\n</facts>`,
    "Write the weekly summary.",
  ].join("\n\n");
  return runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await loadPrompt(AGENT),
      prompt,
      tags: ["step-9", "weekly", ...(args.extraTags ?? [])],
      metadata: { period_start: args.from.toISOString().slice(0, 10), period_end: args.to.toISOString().slice(0, 10), facts: String(args.facts.length) },
    },
    weeklySummarySchema(args.facts),
  );
}

// ---------- the weekly job ----------

// Starts a report row (so the page shows "running" at once). Refuses while another one is running.
export async function startWeeklyReport(now = new Date()): Promise<{ ok: true; reportId: string } | { ok: false; message: string }> {
  const running = await db.weeklyReport.findFirst({ where: { status: "running", createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } } });
  if (running) return { ok: false, message: "The weekly job is already running; this page updates when it's done." };
  const r = await db.weeklyReport.create({ data: { status: "running", periodStart: new Date(now.getTime() - WEEKLY_PERIOD_DAYS * DAY), periodEnd: now } });
  return { ok: true, reportId: r.id };
}

export async function runWeeklyJob(reportId: string, opts: { runEvals?: boolean; extraTags?: string[] } = {}): Promise<WorkflowResult> {
  const report = await db.weeklyReport.findUniqueOrThrow({ where: { id: reportId } });
  try {
    const collected = await collectCorrections();
    await db.weeklyReport.update({ where: { id: reportId }, data: { correctionsAdded: collected.added, correctionsSynced: collected.synced } });

    const evals: EvalSummary[] = [];
    if (opts.runEvals) {
      const { EVALS } = await import("@/evals/datasets");
      const { runEval } = await import("@/evals/run");
      for (const agent of Object.keys(EVALS)) {
        try {
          const r = await runEval(agent);
          evals.push({ agent, passed: r.passed, total: r.total, costUsd: r.costUsd, runName: r.runName, url: r.url, failed: r.items.filter((i) => !i.passed).map((i) => ({ id: i.id, detail: i.detail })) });
        } catch (e) {
          evals.push({ agent, passed: 0, total: 0, costUsd: 0, runName: "", url: null, failed: [], error: e instanceof Error ? e.message : String(e) });
        }
        await db.weeklyReport.update({ where: { id: reportId }, data: { evalResults: evals } });
      }
    }

    const facts = await gatherFacts(report.periodStart, report.periodEnd, evals);
    const s = await runWeeklySummary({ facts, from: report.periodStart, to: report.periodEnd, extraTags: opts.extraTags });
    const evalCost = evals.reduce((n, e) => n + e.costUsd, 0);
    const summaryCost = s.runs.reduce((n, r) => n + r.costUsd, 0);
    const last = s.runs.at(-1);
    await db.weeklyReport.update({
      where: { id: reportId },
      data: {
        status: s.data ? "done" : "failed",
        facts,
        summary: s.data ?? undefined,
        agentRunIds: s.runs.map((r) => r.runId),
        traceId: last?.traceId ?? null,
        costUsd: evalCost + summaryCost,
        error: s.data ? null : s.error,
        finishedAt: new Date(),
      },
    });
    if (!s.data) {
      const stopped = s.runs.some((r) => r.status === "stopped_over_budget");
      await db.approvalItem.create({
        data: {
          kind: stopped ? "stopped_run" : "failed_run",
          step: 9,
          status: "awaiting_approval",
          title: stopped ? "Stopped: over budget" : "Failed: weekly summary",
          detail: `Weekly summary: ${stopped ? "the run went above 3x its budget or hit max turns; nothing was saved." : s.error} Corrections were still collected. Run the weekly job again from the Feedback page.`,
          agentRunId: last?.runId,
        },
      });
    }
    await flushTelemetry();
    return s.data
      ? { ok: true, message: `Weekly job done: ${collected.added} new correction(s), ${facts.length} facts, ${(s.data as WeeklySummary).issues.length} issue(s). Cost $${(evalCost + summaryCost).toFixed(3)}.` }
      : { ok: false, message: `Corrections collected, but the summary failed: ${s.error}` };
  } catch (e) {
    await db.weeklyReport.update({ where: { id: reportId }, data: { status: "failed", error: e instanceof Error ? e.message : String(e), finishedAt: new Date() } });
    throw e;
  }
}
