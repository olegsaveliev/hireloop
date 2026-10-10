// Helpers shared by the job workflows (Steps 2-4 in pipeline/workflow.ts, Step 5 in outreach/workflow.ts).
// Everything is database state; nothing is kept in memory.
import { db } from "@/lib/db";
import { JOB_BUDGET_EXTENSION_USD, JOB_BUDGET_USD } from "@/config/budgets";
import type { RunAgentResult } from "../run-agent";
import { getTelemetry } from "../telemetry";
import { jobSpecSchema, type JobSpecData } from "../job-spec/schema";

export class PausedForBudget extends Error {}



// Never overwrites "closed": a step that was running when the recruiter closed the position must not reopen it.
export async function setStatus(jobId: string, status: string, pipelineNote?: string | null) {
  await db.job.updateMany({
    where: { id: jobId, status: { not: "closed" } },
    data: { status, pipelineUpdatedAt: new Date(), ...(pipelineNote !== undefined ? { pipelineNote } : {}) },
  });
}

export const heartbeat = (jobId: string) => db.job.update({ where: { id: jobId }, data: { pipelineUpdatedAt: new Date() } });

export async function jobCost(jobId: string): Promise<number> {
  const agg = await db.agentRun.aggregate({ where: { jobId }, _sum: { costUsd: true } });
  return agg._sum.costUsd ?? 0;
}

export const jobBudget = (job: { extraBudgetUsd: number }) => JOB_BUDGET_USD + job.extraBudgetUsd;

// Hard stop (CLAUDE.md job-level budget): checked before every agent run in the pipeline.
export async function ensureBudget(jobId: string, step: number) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status === "paused_over_budget") throw new PausedForBudget(); // another worker already paused it
  const cost = await jobCost(jobId);
  const budget = jobBudget(job);
  if (cost < budget) return;
  await db.job.update({ where: { id: jobId }, data: { status: "paused_over_budget", pipelineUpdatedAt: new Date() } });
  const waiting = await db.approvalItem.count({ where: { jobId, kind: "job_budget", status: "awaiting_approval" } });
  if (!waiting) {
    await db.approvalItem.create({
      data: {
        kind: "job_budget",
        step,
        status: "awaiting_approval",
        title: `Job over budget: continue? (${job.title})`,
        detail: `Agent cost so far $${cost.toFixed(2)} of $${budget.toFixed(2)}. The pipeline is paused before step ${step}. Continue adds $${JOB_BUDGET_EXTENSION_USD.toFixed(2)} to this job's budget.`,
        clientId: job.clientId,
        jobId,
      },
    });
  }
  throw new PausedForBudget();
}

// Run `fn` over items, `limit` at a time. Waits for every started item, then rethrows the first error.
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  let firstError: unknown = null;
  const worker = async () => {
    while (queue.length && !firstError) {
      const item = queue.shift()!;
      try {
        await fn(item);
      } catch (e) {
        firstError ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (firstError) throw firstError;
}

export async function score(traceId: string | null | undefined, scores: Record<string, number>) {
  if (!traceId) return;
  const { langfuse } = getTelemetry();
  for (const [name, value] of Object.entries(scores)) langfuse.score.create({ traceId, name, value });
}

export type Problem = { candidateId?: string; runs: RunAgentResult[]; error: string | null };

// One queue item per job and step, however many candidates failed (avoids 20 separate items).
export async function queueJobProblem(job: { id: string; clientId: string; title: string }, step: number, what: string, problems: Problem[], total?: number) {
  if (!problems.length) return;
  const stopped = problems.some((p) => p.runs.some((r) => r.status === "stopped_over_budget"));
  const names = problems.map((p) => p.candidateId).filter(Boolean);
  await db.approvalItem.create({
    data: {
      kind: stopped ? "stopped_run" : "failed_run",
      step,
      status: "awaiting_approval",
      title: stopped ? "Stopped: over budget" : `Failed: ${what}`,
      detail:
        `${what} for "${job.title}"` +
        (total ? `: ${problems.length} of ${total} candidate(s) (${names.join(", ")})` : "") +
        `. ${stopped ? "A run went above 3x its budget or hit max turns; nothing was saved for it." : (problems[0].error ?? "")}` +
        " Try again re-runs only what is missing.",
      clientId: job.clientId,
      jobId: job.id,
      agentRunId: problems[0].runs.at(-1)?.runId,
    },
  });
}

export async function loadJob(jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { jobSpec: true } });
  return { ...job, spec: jobSpecSchema.parse(job.jobSpec.spec) as JobSpecData };
}
export type LoadedJob = Awaited<ReturnType<typeof loadJob>>;

export async function closeItems(jobId: string, kinds: string[], status: "approved" | "rejected", detailSuffix?: string) {
  const items = await db.approvalItem.findMany({ where: { jobId, kind: { in: kinds }, status: "awaiting_approval" } });
  for (const item of items) {
    await db.approvalItem.update({
      where: { id: item.id },
      data: { status, decidedAt: new Date(), ...(detailSuffix ? { detail: `${item.detail ?? ""} ${detailSuffix}`.trim() } : {}) },
    });
  }
}
