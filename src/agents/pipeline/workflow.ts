// Steps 2-4 workflow for one job: sourcing -> enrichment -> screening -> shortlist approval.
// Everything is driven by the job's status in the database, so the pipeline can stop at any point
// (server restart, job budget reached, a failed run) and resume later: each step only does missing work.
// Approvals are database status only; nothing is kept in memory.
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { personKey } from "@/lib/candidates";
import { ENRICHMENT_CONCURRENCY, JOB_BUDGET_EXTENSION_USD, SCREENING_CONCURRENCY, SOURCING_MAX_CANDIDATES } from "@/config/budgets";
import { flushTelemetry } from "../telemetry";
import { jobSpecSchema } from "../job-spec/schema";
import {
  closeItems,
  ensureBudget,
  heartbeat,
  loadJob,
  PausedForBudget,
  pool,
  queueJobProblem,
  score,
  setStatus,
  type LoadedJob,
  type Problem,
} from "./shared";
import type { WorkflowResult } from "../job-spec/workflow";
import { runSourcingAgent } from "../sourcing/agent";
import { runEnrichmentAgent } from "../enrichment/agent";
import { enrichmentOutputSchema, type CandidateProfileData } from "../enrichment/schema";
import { runScreeningAgent } from "../screening/agent";
import { prefilter } from "../screening/prefilter";
import { CONFIDENCES, type ScreeningData } from "../screening/schema";
import { outreachStep } from "../outreach/workflow";

// Job cost/budget helpers live in ./shared (also used by Step 5); re-exported for the Jobs pages.
export { jobBudget, jobCost } from "./shared";

export const RUNNING_STATUSES = ["sourcing", "enriching", "screening", "drafting_outreach"];
// A running job with no progress for this long is probably stuck (e.g. the app was restarted mid-run).
export const STUCK_AFTER_MS = 3 * 60_000;
// Which status a step resumes from.
const STEP_STATUS: Record<number, string> = { 2: "ready_for_sourcing", 3: "enriching", 4: "screening", 5: "drafting_outreach", 6: "drafting_outreach", 7: "drafting_outreach", 8: "drafting_outreach" };
const RESUMABLE = ["ready_for_sourcing", ...RUNNING_STATUSES];

export type RunOptions = {
  extraTags?: string[];
  // Tests only: stop once the job has moved past this step.
  stopAfter?: "sourcing" | "enrichment";
};

// ---------- Step 2: sourcing ----------

async function sourcingStep(job: LoadedJob, opts: RunOptions) {
  await ensureBudget(job.id, 2);
  await setStatus(job.id, "sourcing");
  const { data, runs, error } = await runSourcingAgent({ jobId: job.id, clientId: job.clientId, spec: job.spec, extraTags: opts.extraTags });
  const last = runs.at(-1)!;
  if (!data) {
    await queueJobProblem(job, 2, "sourcing", [{ runs, error }]);
    await setStatus(job.id, "failed", "Sourcing run failed or stopped; see the approval queue.");
    return;
  }

  // App-side checks: the agent's list is re-checked against the database, never trusted blindly.
  const existing = await db.pipelineEntry.findMany({ where: { jobId: job.id } });
  const existingIds = new Set(existing.map((e) => e.candidateId));
  const lookup = await db.candidate.findMany({
    where: { id: { in: [...existingIds, ...data.candidates.map((c) => c.candidate_id)] } },
  });
  const byId = new Map(lookup.map((c) => [c.id, c]));
  const seen = new Set(existing.map((e) => byId.get(e.candidateId)).filter((c) => !!c).map((c) => personKey(c!)));
  let appDuplicates = 0;
  let unknownIds = 0;
  const toAdd: typeof data.candidates = [];
  for (const c of data.candidates) {
    const cand = byId.get(c.candidate_id);
    if (!cand) {
      unknownIds++;
      continue;
    }
    if (existingIds.has(c.candidate_id) || seen.has(personKey(cand))) {
      appDuplicates++;
      continue;
    }
    seen.add(personKey(cand));
    toAdd.push(c);
  }
  const added = toAdd.slice(0, SOURCING_MAX_CANDIDATES);
  await db.pipelineEntry.createMany({
    data: added.map((c) => ({ jobId: job.id, candidateId: c.candidate_id, stage: "sourced", matchedOn: c.matched_on, sourcingRunId: last.runId })),
  });
  await score(last.traceId, { candidates_found: added.length });
  await flushTelemetry();

  const notes = [
    data.broadened ? `Search broadened once${data.note ? `: ${data.note}` : "."}` : null,
    `Sourcing added ${added.length} candidate(s) (${data.queries.length} queries; ${data.duplicates_skipped + appDuplicates} duplicate(s) skipped).`,
    unknownIds ? `${unknownIds} unknown candidate id(s) from the agent ignored.` : null,
    toAdd.length > added.length ? `${toAdd.length - added.length} more matches over the cap of ${SOURCING_MAX_CANDIDATES} not added.` : null,
  ].filter(Boolean);
  // Headlines, queries and duplicates for the Jobs page card ("Sourcing details").
  await db.job.update({
    where: { id: job.id },
    data: { sourcingSummary: { highlights: data.highlights, queries: data.queries, duplicates: data.duplicates_skipped + appDuplicates } },
  });

  if (added.length === 0 && existing.length === 0) {
    // Spec edge case: zero results -> stop and notify the recruiter.
    await db.approvalItem.create({
      data: {
        kind: "no_candidates",
        step: 2,
        status: "awaiting_approval",
        title: `No candidates found: ${job.title}`,
        detail: `Sourcing found nobody, even after broadening. ${data.note ?? ""} Edit the spec and re-run sourcing, or dismiss.`.trim(),
        clientId: job.clientId,
        jobId: job.id,
        agentRunId: last.runId,
      },
    });
    await setStatus(job.id, "no_candidates", notes.join(" "));
    return;
  }
  await setStatus(job.id, "enriching", notes.join(" "));
}

// ---------- Step 3: enrichment ----------

async function enrichmentStep(job: LoadedJob, opts: RunOptions) {
  const entries = await db.pipelineEntry.findMany({ where: { jobId: job.id } });
  const ids = entries.map((e) => e.candidateId);
  const done = new Set((await db.candidateProfile.findMany({ where: { candidateId: { in: ids } }, select: { candidateId: true } })).map((p) => p.candidateId));
  const todo = ids.filter((id) => !done.has(id));
  const problems: Problem[] = [];

  try {
    await pool(todo, ENRICHMENT_CONCURRENCY, async (candidateId) => {
      await ensureBudget(job.id, 3);
      const r = await runEnrichmentAgent({ candidateId, jobId: job.id, extraTags: opts.extraTags });
      if (!r.data) {
        problems.push({ candidateId, runs: r.runs, error: r.error });
        return;
      }
      await db.candidateProfile.upsert({
        where: { candidateId },
        create: { candidateId, data: r.data, missingCount: r.data.missing_fields.length, agentRunId: r.runs.at(-1)!.runId },
        update: { data: r.data, missingCount: r.data.missing_fields.length, agentRunId: r.runs.at(-1)!.runId },
      });
      await score(r.runs.at(-1)!.traceId, { missing_fields_count: r.data.missing_fields.length });
      await heartbeat(job.id);
    });
  } finally {
    await queueJobProblem(job, 3, "enrichment", problems, todo.length);
    await flushTelemetry();
  }
  await setStatus(job.id, "screening");
}

// ---------- Step 4: screening ----------

const CONFIDENCE_RANK: Record<string, number> = Object.fromEntries(CONFIDENCES.map((c, i) => [c, i]));

// Ranking for the shortlist table: score (recruiter override wins), then confidence, then years
// (spec edge case "Ties: order by confidence, then years of experience"). Filtered-out candidates last.
export function rankResults<T extends { filteredOut: boolean; score: number | null; overrideScore?: number | null; confidence: string | null; years: number | null }>(
  rows: T[],
  opts: { useOverrides: boolean } = { useOverrides: true },
): T[] {
  const eff = (r: T) => (opts.useOverrides && r.overrideScore != null ? r.overrideScore : (r.score ?? -1));
  return [...rows].sort(
    (a, b) =>
      Number(a.filteredOut) - Number(b.filteredOut) ||
      eff(b) - eff(a) ||
      (CONFIDENCE_RANK[a.confidence ?? "low"] ?? 9) - (CONFIDENCE_RANK[b.confidence ?? "low"] ?? 9) ||
      (b.years ?? 0) - (a.years ?? 0),
  );
}

const LOW_SCORES_NOTE = "Everyone scored under 40: the spec may be too strict.";

async function screeningStep(job: LoadedJob, opts: RunOptions) {
  const entries = await db.pipelineEntry.findMany({ where: { jobId: job.id } });
  const profiles = await db.candidateProfile.findMany({ where: { candidateId: { in: entries.map((e) => e.candidateId) } } });
  const scored = new Set(
    (await db.screeningResult.findMany({ where: { jobId: job.id, current: true }, select: { candidateId: true } })).map((r) => r.candidateId),
  );
  const todo = profiles.filter((p) => !scored.has(p.candidateId));
  const problems: Problem[] = [];

  try {
    await pool(todo, SCREENING_CONCURRENCY, async (row) => {
      const profile = enrichmentOutputSchema.parse(row.data) as CandidateProfileData;
      const pf = prefilter(job.spec.must_have, profile);
      if (!pf.pass) {
        await db.screeningResult.create({ data: { jobId: job.id, candidateId: row.candidateId, filteredOut: true, filterReason: pf.reason } });
        return;
      }
      await ensureBudget(job.id, 4);
      const r = await runScreeningAgent({ jobId: job.id, clientId: job.clientId, spec: job.spec, profile, extraTags: opts.extraTags });
      const last = r.runs.at(-1)!;
      if (!r.data) {
        problems.push({ candidateId: row.candidateId, runs: r.runs, error: r.error });
        return;
      }
      await db.screeningResult.create({
        data: {
          jobId: job.id,
          candidateId: row.candidateId,
          data: r.data as ScreeningData,
          score: r.data.score,
          confidence: r.data.confidence,
          agentRunId: last.runId,
          traceId: last.traceId,
        },
      });
      await heartbeat(job.id);
    });
  } finally {
    await queueJobProblem(job, 4, "screening", problems, todo.length);
    await flushTelemetry();
  }

  const results = await db.screeningResult.findMany({ where: { jobId: job.id, current: true } });
  if (!results.length) {
    await setStatus(job.id, "failed", "No candidate could be screened; see the approval queue.");
    return;
  }
  const scoredRows = results.filter((r) => !r.filteredOut);
  const filtered = results.length - scoredRows.length;
  const allLow = scoredRows.length > 0 && scoredRows.every((r) => (r.score ?? 0) < 40);
  const lowNote = allLow ? LOW_SCORES_NOTE : null;
  const current = await db.job.findUniqueOrThrow({ where: { id: job.id } });
  const previous = current.pipelineNote?.replace(LOW_SCORES_NOTE, "").trim(); // don't repeat it on re-runs
  const note = [previous, lowNote].filter(Boolean).join(" ");

  const waiting = await db.approvalItem.count({ where: { jobId: job.id, kind: "shortlist", status: "awaiting_approval" } });
  if (!waiting) {
    await db.approvalItem.create({
      data: {
        kind: "shortlist",
        step: 4,
        status: "awaiting_approval",
        title: `Shortlist: ${job.title}`,
        detail: `${scoredRows.length} candidate(s) scored${filtered ? `, ${filtered} filtered out before scoring` : ""}.${lowNote ? ` ${lowNote}` : ""}`,
        clientId: job.clientId,
        jobId: job.id,
      },
    });
  }
  await setStatus(job.id, "awaiting_shortlist", note || null);
}

// ---------- entry point ----------

// Runs whatever is left for this job, step by step, until it needs a human or is done.
export async function runPipeline(jobId: string, opts: RunOptions = {}): Promise<WorkflowResult> {
  try {
    for (;;) {
      const job = await loadJob(jobId);
      if (job.status === "ready_for_sourcing" || job.status === "sourcing") {
        await sourcingStep(job, opts);
        if (opts.stopAfter === "sourcing") return { ok: true, message: "Stopped after sourcing (test)." };
      } else if (job.status === "enriching") {
        await enrichmentStep(job, opts);
        if (opts.stopAfter === "enrichment") return { ok: true, message: "Stopped after enrichment (test)." };
      }
      else if (job.status === "screening") await screeningStep(job, opts);
      else if (job.status === "drafting_outreach") await outreachStep(job, opts);
      else return { ok: !["failed", "stopped"].includes(job.status), message: statusMessage(job.status) };
    }
  } catch (e) {
    if (e instanceof PausedForBudget) return { ok: false, message: statusMessage("paused_over_budget") };
    const message = e instanceof Error ? e.message : String(e);
    const job = await db.job.findUnique({ where: { id: jobId } });
    if (job) {
      const step = job.status === "drafting_outreach" ? 5 : 2; // 5 = the Steps 5-8 run
      await setStatus(jobId, "failed", `Pipeline error: ${message}`);
      await db.approvalItem.create({
        data: { kind: "failed_run", step, status: "awaiting_approval", title: "Failed: pipeline error", detail: `${job.title}: ${message}. Try again resumes where it stopped.`, clientId: job.clientId, jobId },
      });
    }
    return { ok: false, message: `Pipeline error: ${message}` };
  }
}

function statusMessage(status: string): string {
  return (
    {
      awaiting_shortlist: "Sourcing, enrichment and screening done. The shortlist is waiting in the approval queue.",
      no_candidates: "No candidates found. See the approval queue.",
      paused_over_budget: "Paused: the job reached its budget. See the approval queue.",
      failed: "The pipeline stopped with a problem. See the approval queue.",
      shortlisted: "Shortlist already approved.",
      outreach: "Outreach drafts are waiting in the approval queue.",
      stopped: "This job was stopped.",
      closed: "This position is closed.",
    }[status] ?? `Job is ${status.replaceAll("_", " ")}.`
  );
}

export function isStuck(job: { status: string; pipelineUpdatedAt: Date | null }) {
  return RUNNING_STATUSES.includes(job.status) && (!job.pipelineUpdatedAt || Date.now() - job.pipelineUpdatedAt.getTime() > STUCK_AFTER_MS);
}

// Buttons "Start sourcing" / "Resume": checks it's safe to start, then the caller runs runPipeline.
export async function canStartPipeline(jobId: string): Promise<WorkflowResult> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (RUNNING_STATUSES.includes(job.status) && !isStuck(job)) return { ok: false, message: "Already running." };
  if (job.status === "failed") {
    // Resume from the earliest step with missing work.
    const entries = await db.pipelineEntry.count({ where: { jobId } });
    const shortlisted = await db.pipelineEntry.count({ where: { jobId, stage: { not: "sourced" } } });
    await setStatus(jobId, shortlisted ? "drafting_outreach" : entries ? "enriching" : "ready_for_sourcing");
  } else if (!RESUMABLE.includes(job.status)) return { ok: false, message: statusMessage(job.status) };
  return { ok: true, message: "Started. This page refreshes while it runs (a few minutes for ~20 candidates).", jobId };
}

// ---------- human decisions ----------

export type ShortlistDecision = { candidateId: string; selected: boolean; overrideScore: number | null; overrideNote: string };

async function resultsWithYears(jobId: string) {
  const results = await db.screeningResult.findMany({ where: { jobId, current: true } });
  const profiles = await db.candidateProfile.findMany({ where: { candidateId: { in: results.map((r) => r.candidateId) } } });
  return results.map((r) => {
    const p = profiles.find((x) => x.candidateId === r.candidateId)?.data as CandidateProfileData | undefined;
    return { ...r, years: p?.years_experience ?? null };
  });
}

export async function approveShortlist(jobId: string, decisions: ShortlistDecision[], opts: { startOutreach?: boolean } = { startOutreach: true }): Promise<WorkflowResult> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status !== "awaiting_shortlist") return { ok: false, message: `This job is ${job.status.replaceAll("_", " ")}, not waiting for a shortlist.` };
  const selected = decisions.filter((d) => d.selected);
  if (!selected.length) return { ok: false, message: "Select at least one candidate (or use 'Edit spec and re-source')." };
  for (const d of decisions) {
    if (d.overrideScore === null) continue;
    if (!Number.isInteger(d.overrideScore) || d.overrideScore < 0 || d.overrideScore > 100) return { ok: false, message: "Override scores must be whole numbers from 0 to 100." };
    if (!d.overrideNote.trim()) return { ok: false, message: "Add a note to every score you override." };
  }

  const rows = await resultsWithYears(jobId);
  // recruiter_agreement: share of the agent's top 10 (by agent score, before overrides) the recruiter kept.
  const top = rankResults(rows.filter((r) => !r.filteredOut), { useOverrides: false }).slice(0, 10);
  const selectedIds = new Set(selected.map((d) => d.candidateId));
  const agreement = top.length ? top.filter((r) => selectedIds.has(r.candidateId)).length / top.length : 0;
  const decisionOf = new Map(decisions.map((d) => [d.candidateId, d]));

  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const d = decisionOf.get(r.candidateId);
      await tx.screeningResult.update({
        where: { id: r.id },
        data: { overrideScore: d?.overrideScore ?? null, overrideNote: d?.overrideScore != null ? d.overrideNote.trim() : null },
      });
    }
    await tx.pipelineEntry.updateMany({ where: { jobId, candidateId: { in: [...selectedIds] } }, data: { stage: "shortlisted" } });
    // Step 5 starts right away: the caller runs the pipeline, which drafts the first messages.
    await tx.job.update({
      where: { id: jobId },
      data: { status: opts.startOutreach ? "drafting_outreach" : "shortlisted", pipelineUpdatedAt: new Date(), recruiterAgreement: Number(agreement.toFixed(3)) },
    });
  });
  await closeItems(jobId, ["shortlist"], "approved");

  // Langfuse scores. Screening is one trace per candidate, so job-level scores go on each of them.
  const overrides = decisions.filter((d) => d.overrideScore !== null).length;
  for (const r of rows.filter((x) => x.traceId)) {
    await score(r.traceId, {
      recruiter_agreement: Number(agreement.toFixed(3)),
      overrides: decisionOf.get(r.candidateId)?.overrideScore != null ? 1 : 0, // sum over the job = override count
    });
  }
  // later_shortlisted_ratio on each sourcing run: shortlisted / sourced by that run.
  const entries = await db.pipelineEntry.findMany({ where: { jobId } });
  const runIds = [...new Set(entries.map((e) => e.sourcingRunId).filter((x): x is string => !!x))];
  for (const run of await db.agentRun.findMany({ where: { id: { in: runIds } } })) {
    const mine = entries.filter((e) => e.sourcingRunId === run.id);
    await score(run.traceId, { later_shortlisted_ratio: Number((mine.filter((e) => e.stage === "shortlisted").length / mine.length).toFixed(3)) });
  }
  await flushTelemetry();
  return {
    ok: true,
    message: `Shortlist approved: ${selected.length} candidate(s) moved to shortlisted.${opts.startOutreach ? " Outreach drafts are being written now." : ""} Agreement with the agent's top ${top.length}: ${Math.round(agreement * 100)}%.${overrides ? ` ${overrides} score override(s) saved.` : ""}`,
    jobId,
  };
}

// "Add to shortlist" on the Job page's Not shortlisted tab (2026-10-10): after the shortlist was approved (e.g. everyone
// on it dropped out), the recruiter adds someone from the pool. The caller starts the outreach step, which drafts their
// first message for approval like for anyone else on the shortlist.
export const ADD_TO_SHORTLIST_STATUSES = ["shortlisted", "drafting_outreach", "outreach"];
export async function addToShortlist(jobId: string, candidateId: string): Promise<WorkflowResult> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!ADD_TO_SHORTLIST_STATUSES.includes(job.status)) return { ok: false, message: `This job is ${job.status.replaceAll("_", " ")}; pick the shortlist first.` };
  const { count } = await db.pipelineEntry.updateMany({ where: { jobId, candidateId, stage: "sourced" }, data: { stage: "shortlisted" } });
  if (!count) return { ok: false, message: "This candidate is already on the shortlist." };
  await db.job.update({ where: { id: jobId }, data: { pipelineUpdatedAt: new Date() } });
  const name = (await db.candidate.findUnique({ where: { id: candidateId } }))?.fullName ?? candidateId;
  return {
    ok: true,
    message: job.status === "shortlisted" ? `${name} added to the shortlist. Draft outreach writes their first message.` : `${name} added to the shortlist. The agent is writing their first message for your approval.`,
    jobId,
  };
}

// Reject = the recruiter edits the approved spec directly; sourcing then re-runs (skipping people already
// in the pipeline) and everyone is re-screened against the edited spec. The caller starts the pipeline.
export async function editSpecAndResource(jobId: string, edited: unknown, comment: string): Promise<WorkflowResult> {
  const parsed = jobSpecSchema.safeParse(edited);
  if (!parsed.success) return { ok: false, message: `Spec is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!["awaiting_shortlist", "no_candidates"].includes(job.status)) return { ok: false, message: `This job is ${job.status.replaceAll("_", " ")}; the spec can't be edited now.` };

  await db.$transaction([
    db.jobSpec.update({ where: { id: job.jobSpecId }, data: { spec: parsed.data, editedAfterApprovalAt: new Date() } }),
    db.job.update({ where: { id: jobId }, data: { title: parsed.data.title, status: "ready_for_sourcing", pipelineNote: null, sourcingSummary: Prisma.DbNull, pipelineUpdatedAt: new Date() } }),
    db.screeningResult.updateMany({ where: { jobId, current: true }, data: { current: false } }),
  ]);
  await closeItems(jobId, ["shortlist", "no_candidates"], "rejected", comment.trim() ? `Recruiter: ${comment.trim()}` : undefined);
  return { ok: true, message: "Spec updated. Sourcing re-runs now, then everyone is re-screened against the edited spec.", jobId };
}

// Job budget reached: "Continue" adds budget and resumes; "Stop job" ends the pipeline.
export async function continueOverBudget(itemId: string): Promise<WorkflowResult> {
  const item = await db.approvalItem.findUniqueOrThrow({ where: { id: itemId } });
  if (!item.jobId || item.kind !== "job_budget" || item.status !== "awaiting_approval") return { ok: false, message: "Nothing to continue." };
  await db.job.update({
    where: { id: item.jobId },
    data: { extraBudgetUsd: { increment: JOB_BUDGET_EXTENSION_USD }, status: STEP_STATUS[item.step] ?? "enriching", pipelineUpdatedAt: new Date() },
  });
  await db.approvalItem.update({ where: { id: itemId }, data: { status: "approved", decidedAt: new Date() } });
  return { ok: true, message: `Budget raised by $${JOB_BUDGET_EXTENSION_USD.toFixed(2)}. The pipeline continues.`, jobId: item.jobId };
}

export async function stopOverBudget(itemId: string): Promise<WorkflowResult> {
  const item = await db.approvalItem.findUniqueOrThrow({ where: { id: itemId } });
  if (!item.jobId || item.kind !== "job_budget") return { ok: false, message: "Nothing to stop." };
  await db.job.update({ where: { id: item.jobId }, data: { status: "stopped", pipelineNote: "Stopped by a human after reaching the job budget." } });
  await db.approvalItem.update({ where: { id: itemId }, data: { status: "rejected", decidedAt: new Date() } });
  return { ok: true, message: "Job stopped. Nothing else will run for it." };
}

// "Try again" on a job's stopped/failed item: resume from that step (only missing work is redone).
export async function retryJobProblem(itemId: string): Promise<WorkflowResult> {
  const item = await db.approvalItem.findUniqueOrThrow({ where: { id: itemId } });
  if (!item.jobId) return { ok: false, message: "Nothing to retry." };
  const job = await db.job.findUniqueOrThrow({ where: { id: item.jobId } });
  if (!["failed", "awaiting_shortlist", "no_candidates", "outreach", "shortlisted"].includes(job.status)) {
    return { ok: false, message: `This job is ${job.status.replaceAll("_", " ")}; nothing to retry.` };
  }
  await db.approvalItem.update({ where: { id: itemId }, data: { status: "dismissed", decidedAt: new Date() } });
  const entries = await db.pipelineEntry.count({ where: { jobId: job.id } });
  // A sourcing problem re-runs sourcing; enrichment/screening/outreach problems resume at that step.
  // Steps 5-8 (outreach, pre-screen, submission, scheduling) share one resumable run (outreachStep).
  if (item.step >= 5 && item.step <= 8) {
    await setStatus(job.id, "drafting_outreach");
    return { ok: true, message: `Retrying the missing ${{ 5: "outreach", 6: "pre-screen", 7: "submission", 8: "scheduling" }[item.step]} work.`, jobId: job.id };
  }
  await setStatus(job.id, item.step === 2 || !entries ? "ready_for_sourcing" : (STEP_STATUS[item.step] ?? "enriching"));
  return { ok: true, message: "Retrying. Only the missing work is redone.", jobId: job.id };
}
