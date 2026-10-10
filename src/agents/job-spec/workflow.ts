// Step 1 workflow: save agent drafts, put them in the approval queue, handle approve / reject.
// Approvals are database status only (awaiting_approval -> approved / rejected); nothing is kept in memory.
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { RunAgentResult } from "../run-agent";
import { getTelemetry, flushTelemetry } from "../telemetry";
import { applyAnswersToSpec, generateJobSpecs, regenerateJobSpec } from "./agent";
import { jobSpecSchema, SPEC_FIELDS, type JobSpecData, type OpenQuestionAnswer } from "./schema";

const STEP = 1;

export type WorkflowResult = { ok: boolean; message: string; specId?: string; jobId?: string };

// A run that produced nothing goes to the approval queue so a human sees it.
async function queueProblem(runs: RunAgentResult[], error: string | null, ctx: { briefId: string; clientId: string; what: string; rejectedSpecId?: string }) {
  const last = runs[runs.length - 1];
  const stopped = runs.some((r) => r.status === "stopped_over_budget");
  await db.approvalItem.create({
    data: {
      kind: stopped ? "stopped_run" : "failed_run",
      step: STEP,
      status: "awaiting_approval",
      title: stopped ? "Stopped: over budget" : "Failed: no valid spec",
      detail: `${ctx.what}. ${stopped ? "The run went above 3x its budget or hit max turns; nothing was saved." : error ?? ""}`.trim(),
      clientId: ctx.clientId,
      briefId: ctx.briefId,
      jobSpecId: ctx.rejectedSpecId, // set when a regeneration failed: "Try again" regenerates that spec
      agentRunId: last?.runId,
    },
  });
  return { ok: false, message: stopped ? "Stopped: over budget. Nothing was saved; see the approval queue." : `No valid spec: ${error}` };
}

const answersFor = (spec: JobSpecData): OpenQuestionAnswer[] =>
  spec.open_questions.map((question) => ({ question, answered: false, answer: "" }));

async function saveDraft(args: {
  id: string;
  briefId: string;
  clientId: string;
  spec: JobSpecData;
  roleIndex: number;
  roleCount: number;
  note: string | null;
  previousSpecId?: string;
  runs: RunAgentResult[];
}) {
  const last = args.runs[args.runs.length - 1];
  const saved = await db.jobSpec.create({
    data: {
      id: args.id,
      briefId: args.briefId,
      clientId: args.clientId,
      roleIndex: args.roleIndex,
      roleCount: args.roleCount,
      status: "awaiting_approval",
      agentDraft: args.spec,
      spec: args.spec,
      answers: answersFor(args.spec),
      agentNote: args.note,
      previousSpecId: args.previousSpecId,
      agentRunIds: args.runs.map((r) => r.runId),
      traceId: last.traceId,
    },
  });
  await db.approvalItem.create({
    data: {
      kind: "job_spec",
      step: STEP,
      status: "awaiting_approval",
      title: `Job spec: ${args.spec.title}`,
      detail: args.roleCount > 1 ? `Role ${args.roleIndex + 1} of ${args.roleCount} from this brief.` : null,
      clientId: args.clientId,
      briefId: args.briefId,
      jobSpecId: saved.id,
      agentRunId: last.runId,
    },
  });
  return saved;
}

// "Create spec" button.
// `allowExisting` is for automated tests only, so they don't depend on what's in the app.
export async function createSpecsFromBrief(briefId: string, opts: { allowExisting?: boolean } = {}): Promise<WorkflowResult> {
  const active = await db.jobSpec.count({ where: { briefId, status: { in: ["awaiting_approval", "approved"] } } });
  if (active && !opts.allowExisting) return { ok: false, message: "This brief already has a spec waiting for approval or approved." };

  const specIds = [randomUUID(), randomUUID(), randomUUID()];
  const { data, runs, error, brief } = await generateJobSpecs(briefId, { specIds });
  if (!data) return queueProblem(runs, error, { briefId, clientId: brief.clientId, what: `Create spec for "${brief.subject}"` });

  for (const [i, spec] of data.specs.entries()) {
    await saveDraft({ id: specIds[i], briefId, clientId: brief.clientId, spec, roleIndex: i, roleCount: data.specs.length, note: data.note, runs });
  }
  const n = data.specs.length;
  return { ok: true, message: `${n === 1 ? "1 spec" : `${n} specs`} created, waiting in the approval queue.` };
}

// ---------- approval decisions ----------

const norm = (v: unknown) =>
  JSON.stringify(Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === "string" ? v.trim() || null : v);

export function countEditedFields(draft: JobSpecData, edited: JobSpecData): number {
  return SPEC_FIELDS.filter((f) => norm(draft[f]) !== norm(edited[f])).length;
}

async function score(traceId: string | null, scores: Record<string, number>) {
  if (!traceId) return;
  const { langfuse } = getTelemetry();
  for (const [name, value] of Object.entries(scores)) langfuse.score.create({ traceId, name, value });
  await flushTelemetry();
}

async function loadPending(specId: string) {
  const spec = await db.jobSpec.findUniqueOrThrow({ where: { id: specId } });
  if (spec.status !== "awaiting_approval") throw new Error(`This spec is already ${spec.status}.`);
  return spec;
}

async function closeApprovalItem(specId: string, status: "approved" | "rejected", jobId?: string) {
  await db.approvalItem.updateMany({
    where: { jobSpecId: specId, status: "awaiting_approval" },
    data: { status, decidedAt: new Date(), jobId },
  });
}

export async function approveSpec(specId: string, edited: unknown, answers: OpenQuestionAnswer[]): Promise<WorkflowResult> {
  const parsed = jobSpecSchema.safeParse(edited);
  if (!parsed.success) return { ok: false, message: `Spec is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const current = await loadPending(specId);
  const fieldsEdited = countEditedFields(jobSpecSchema.parse(current.agentDraft), parsed.data);

  const job = await db.$transaction(async (tx) => {
    await tx.jobSpec.update({
      where: { id: specId },
      data: { status: "approved", spec: parsed.data, answers, fieldsEdited, decidedAt: new Date() },
    });
    const job = await tx.job.create({
      data: { jobSpecId: specId, clientId: current.clientId, title: parsed.data.title, status: "ready_for_sourcing" },
    });
    // Count the cost of every run that led to this spec (incl. rejected versions) towards the job.
    const runIds: string[] = [];
    for (let s: typeof current | null = current; s; s = s.previousSpecId ? await tx.jobSpec.findUnique({ where: { id: s.previousSpecId } }) : null) {
      runIds.push(...(s.agentRunIds as string[]));
    }
    await tx.agentRun.updateMany({ where: { id: { in: runIds }, jobId: null }, data: { jobId: job.id } });
    return job;
  });
  await closeApprovalItem(specId, "approved", job.id);
  await score(current.traceId, { approved_without_edits: fieldsEdited === 0 ? 1 : 0, fields_edited: fieldsEdited, rejected: 0 });
  // Steps 2-4 start from jobs with status "ready_for_sourcing" (the server action starts them in the background).
  return {
    ok: true,
    message: `Approved${fieldsEdited ? ` with ${fieldsEdited} field(s) edited` : " without edits"}. Job created; sourcing, enrichment and screening start now (see Jobs).`,
    jobId: job.id,
  };
}

export async function rejectSpec(specId: string, comment: string): Promise<WorkflowResult> {
  if (!comment.trim()) return { ok: false, message: "Write a comment so the agent knows what to change." };
  const current = await loadPending(specId);
  await db.jobSpec.update({ where: { id: specId }, data: { status: "rejected", rejectComment: comment.trim(), decidedAt: new Date() } });
  await closeApprovalItem(specId, "rejected");
  await score(current.traceId, { approved_without_edits: 0, rejected: 1 });
  return regenerateFrom(specId);
}

// New draft from a rejected spec + its comment.
async function regenerateFrom(rejectedSpecId: string): Promise<WorkflowResult> {
  const current = await db.jobSpec.findUniqueOrThrow({ where: { id: rejectedSpecId } });
  const specId = rejectedSpecId;
  const comment = current.rejectComment ?? "";
  const newSpecId = randomUUID();
  const { data, runs, error } = await regenerateJobSpec({
    briefId: current.briefId,
    rejectedSpec: jobSpecSchema.parse(current.spec),
    comment: comment.trim(),
    roleIndex: current.roleIndex,
    roleCount: current.roleCount,
    rejectedSpecId: specId,
    newSpecId,
  });
  if (!data) return queueProblem(runs, error, { briefId: current.briefId, clientId: current.clientId, what: "Regenerate rejected spec", rejectedSpecId: specId });

  const saved = await saveDraft({
    id: newSpecId,
    briefId: current.briefId,
    clientId: current.clientId,
    spec: data.specs[0],
    roleIndex: current.roleIndex,
    roleCount: current.roleCount,
    note: data.note,
    previousSpecId: specId,
    runs,
  });
  return { ok: true, message: "Rejected. The agent wrote a new draft; it is waiting in the approval queue.", specId: saved.id };
}

// "Decline" on a brief in To do (also "Delete brief" under Email). Refused once a spec is approved (a job and its pipeline hang off it). Draft and rejected specs
// and the brief's queue items go with it. Agent runs stay (cost history). Gmail emails stay recorded as
// `deleted`, so "Check inbox" doesn't bring the brief back; later emails in its thread go to Not briefs.
export async function deleteBrief(briefId: string): Promise<WorkflowResult> {
  const brief = await db.clientBrief.findUniqueOrThrow({ where: { id: briefId }, include: { jobSpecs: true } });
  if (brief.jobSpecs.some((s) => s.status === "approved")) return { ok: false, message: "This brief has an approved spec and a job, so it can't be deleted." };
  const specIds = brief.jobSpecs.map((s) => s.id);
  await db.$transaction([
    // Waiting items and decided history alike: they'd link to a spec that no longer exists.
    db.approvalItem.deleteMany({ where: { OR: [{ briefId }, { jobSpecId: { in: specIds } }] } }),
    // Rejected versions point at the version before them: clear the links, then delete.
    db.jobSpec.updateMany({ where: { id: { in: specIds } }, data: { previousSpecId: null } }),
    db.jobSpec.deleteMany({ where: { id: { in: specIds } } }),
    db.inboundEmail.updateMany({ where: { briefId }, data: { status: "deleted", briefId: null } }),
    db.clientBrief.delete({ where: { id: briefId } }),
  ]);
  return { ok: true, message: `Brief “${brief.subject}” declined and deleted.` };
}

// Stopped / failed runs: the human either dismisses them or tries again.
export async function dismissProblem(itemId: string): Promise<WorkflowResult> {
  await db.approvalItem.update({ where: { id: itemId }, data: { status: "dismissed", decidedAt: new Date() } });
  return { ok: true, message: "Dismissed." };
}

export async function retryProblem(itemId: string): Promise<WorkflowResult> {
  const item = await db.approvalItem.findUniqueOrThrow({ where: { id: itemId } });
  if (!item.briefId) return { ok: false, message: "Nothing to retry." };
  await dismissProblem(itemId);
  return item.jobSpecId ? regenerateFrom(item.jobSpecId) : createSpecsFromBrief(item.briefId);
}

// "Apply answers": merge the recruiter's answers into the spec fields. Nothing is approved or saved as the
// spec here: the editor shows the result and the recruiter still approves. Only the run is recorded
// (so its cost counts towards the job).
export type ApplyAnswersResult = { ok: boolean; message: string; spec?: JobSpecData; note?: string };

export async function applyAnswers(specId: string, currentSpec: unknown, answered: { question: string; answer: string }[]): Promise<ApplyAnswersResult> {
  const parsed = jobSpecSchema.safeParse(currentSpec);
  if (!parsed.success) return { ok: false, message: `Spec is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const eligible = answered.filter((a) => a.question.trim() && a.answer.trim());
  if (!eligible.length) return { ok: false, message: "Type an answer next to at least one question first." };
  const current = await loadPending(specId);

  const { data, runs, error } = await applyAnswersToSpec({ briefId: current.briefId, specId, currentSpec: parsed.data, answered: eligible });
  await db.jobSpec.update({ where: { id: specId }, data: { agentRunIds: [...(current.agentRunIds as string[]), ...runs.map((r) => r.runId)] } });
  if (!data) {
    const stopped = runs.some((r) => r.status === "stopped_over_budget");
    return { ok: false, message: stopped ? "Stopped: over budget. Nothing was changed." : `Could not apply the answers: ${error}` };
  }
  return { ok: true, message: "Answers applied. Check the fields below, then approve.", spec: data.specs[0], note: data.note ?? undefined };
}
