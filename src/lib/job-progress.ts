// Pipeline numbers for the Jobs pages (read-only, from the database).
import { db } from "@/lib/db";
import { isStuck, jobBudget, RUNNING_STATUSES } from "@/agents/pipeline/workflow";

export const STAGES = ["sourced", "shortlisted", "contacted", "replied", "prescreened", "submitted", "interview", "hired"] as const;

// Stages a shortlisted candidate can't come back from on this job.
export const OUT_STAGES = ["declined", "client_rejected", "withdrew"];

// The status a job shows (tags on Jobs, Job page, Briefs): worked out from its candidates first. Hired beats
// everything; "needs_candidates" = everyone on the shortlist is out (2026-10-10).
export function displayStatus(job: { status: string }, p: { stageCounts: Record<string, number>; stuck: boolean; noneLeft: boolean } | undefined): string {
  if (p?.stageCounts.hired) return "hired";
  if (p?.stuck) return "stuck";
  if (p?.noneLeft) return "needs_candidates";
  return job.status;
}

export async function jobProgress(jobs: { id: string; status: string; pipelineUpdatedAt: Date | null; extraBudgetUsd: number }[]) {
  const ids = jobs.map((j) => j.id);
  const [entries, results, costs, messages, outcomes] = await Promise.all([
    db.pipelineEntry.findMany({ where: { jobId: { in: ids } }, select: { jobId: true, candidateId: true, stage: true, outreachNote: true } }),
    db.screeningResult.findMany({ where: { jobId: { in: ids }, current: true }, select: { jobId: true, filteredOut: true } }),
    db.agentRun.groupBy({ by: ["jobId"], where: { jobId: { in: ids } }, _sum: { costUsd: true } }),
    db.message.findMany({ where: { jobId: { in: ids }, direction: "outbound" }, select: { jobId: true, candidateId: true, kind: true, status: true } }),
    db.outcome.findMany({ where: { jobId: { in: ids } }, select: { jobId: true, candidateId: true, stageBefore: true } }),
  ]);
  const profiled = new Set(
    (await db.candidateProfile.findMany({ where: { candidateId: { in: entries.map((e) => e.candidateId) } }, select: { candidateId: true } })).map((p) => p.candidateId),
  );
  return new Map(
    jobs.map((job) => {
      const mine = entries.filter((e) => e.jobId === job.id);
      const res = results.filter((r) => r.jobId === job.id);
      // Stage counts are cumulative: a shortlisted candidate was also sourced. "declined" (said no) counts
      // as replied, and is also shown on its own; "client_rejected" counts as submitted; "withdrew" (Step 9) counts
      // at the stage the candidate had reached.
      const level = (e: { candidateId: string; stage: string }) => {
        const stage = e.stage === "withdrew" ? (outcomes.find((o) => o.jobId === job.id && o.candidateId === e.candidateId)?.stageBefore ?? "replied") : e.stage;
        return STAGES.indexOf(({ declined: "replied", client_rejected: "submitted" }[stage] ?? stage) as (typeof STAGES)[number]);
      };
      const stageCounts = Object.fromEntries(STAGES.map((s, i) => [s, mine.filter((e) => level(e) >= i).length])) as Record<(typeof STAGES)[number], number>;
      const declined = mine.filter((e) => e.stage === "declined").length;
      const msgs = messages.filter((m) => m.jobId === job.id);
      // Drafts on the Review outreach screen. Interview-times emails ("scheduling") are approved on their own screen.
      const pendingDrafts = msgs.filter((m) => m.status === "awaiting_approval" && m.kind !== "scheduling").length;
      const toDraft = mine.filter((e) => e.stage !== "sourced" && !e.outreachNote).length;
      const firstDrafted = new Set(msgs.filter((m) => m.kind === "first").map((m) => m.candidateId)).size;
      const cost = costs.find((c) => c.jobId === job.id)?._sum.costUsd ?? 0;
      const budget = jobBudget(job);
      const running = RUNNING_STATUSES.includes(job.status);
      const stuck = isStuck(job);
      const progress =
        job.status === "sourcing"
          ? "Sourcing: the agent is searching…"
          : job.status === "enriching"
            ? `Enrichment: ${mine.filter((e) => profiled.has(e.candidateId)).length} of ${mine.length} profiles`
            : job.status === "screening"
              ? `Screening: ${res.length} of ${mine.length} candidates (${res.filter((r) => r.filteredOut).length} filtered out before scoring)`
              : job.status === "drafting_outreach"
                ? firstDrafted < toDraft
                  ? `Outreach: ${firstDrafted} of ${toDraft} first messages drafted`
                  : "Agents working: replies, pre-screens, submissions and interviews…"
                : null;
      // Everyone on the shortlist is out (said no, client said no, withdrew) and nobody was hired: the job needs
      // candidates, whatever its pipeline status still says ("outreach").
      const shortlist = mine.filter((e) => e.stage !== "sourced");
      const noneLeft = shortlist.length > 0 && shortlist.every((e) => OUT_STAGES.includes(e.stage)) && ["outreach", "drafting_outreach"].includes(job.status);
      return [job.id, { stageCounts, declined, pendingDrafts, cost, budget, share: cost / budget, running, stuck, progress, scored: res.length, noneLeft }];
    }),
  );
}

export type JobProgress = NonNullable<ReturnType<Awaited<ReturnType<typeof jobProgress>>["get"]>>;
