// Step 9: human corrections from earlier steps -> new items in that agent's Langfuse dataset (docs/specs/09-feedback-loop.md).
// No AI. Scans the database (the corrections are already stored by Steps 1-7), saves each one once in
// dataset_corrections, and pushes new ones to Langfuse. Runs when an outcome is recorded, from the weekly job, and
// from `npm run eval` (which also runs the checkable ones, see correctionEvalItems).
// Checkable (automatic pass/fail): a screening score the recruiter overrode (pass if within SCORE_TOLERANCE) and a
// reply classification the recruiter marked Wrong (pass if the right intent). Everything else (edited or rejected
// drafts, a pre-screen call the recruiter disagreed with) is a reference example: in the dataset, not run.
import { db } from "@/lib/db";
import { SCORE_TOLERANCE } from "@/config/feedback";
import type { AgentName } from "@/config/budgets";
import type { JobSpecData } from "../job-spec/schema";
import type { ScreeningData } from "../screening/schema";
import type { ReplyClassification } from "../outreach/schema";
import { getThread, threadText } from "../tools/mock-inbox";
import { getTelemetry } from "../telemetry";

export type CorrectionSource =
  | "job_spec_edited"
  | "job_spec_rejected"
  | "screening_override"
  | "outreach_edited"
  | "outreach_rejected"
  | "classifier_corrected"
  | "inbound_classifier_corrected"
  | "prescreen_disagreed"
  | "submission_edited"
  | "submission_rejected";

export const SOURCE_LABELS: Record<CorrectionSource, string> = {
  job_spec_edited: "Spec edited before approval",
  job_spec_rejected: "Spec rejected with a comment",
  screening_override: "Screening score overridden",
  outreach_edited: "Draft edited before sending",
  outreach_rejected: "Draft rejected with a comment",
  classifier_corrected: "Reply intent marked Wrong",
  inbound_classifier_corrected: "Ignored email marked as a brief",
  prescreen_disagreed: "Recruiter disagreed with the recommendation",
  submission_edited: "Submission edited by the account manager",
  submission_rejected: "Submission rejected with a comment",
};

type NewCorrection = {
  agent: AgentName;
  source: CorrectionSource;
  sourceId: string;
  jobId?: string | null;
  candidateId?: string | null;
  input: object;
  agentOutput: object;
  correctedOutput: object;
  expected: string;
  checkKind?: "score_within" | "intent_is" | "kind_is" | null;
  checkValue?: number | string | null;
};

const norm = (v: unknown) => JSON.stringify(Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === "string" ? v.trim() || null : (v ?? null));
// Top-level fields whose value changed (whitespace and empty list items ignored).
export const changedFields = (a: Record<string, unknown>, b: Record<string, unknown>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => norm(a[k]) !== norm(b[k]));
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));

// The agent that wrote a message: the agent of its run (outreach drafts and suggested replies share the messages table).
async function agentOf(runIds: unknown): Promise<string | null> {
  const ids = Array.isArray(runIds) ? (runIds as string[]) : [];
  if (!ids.length) return null;
  return (await db.agentRun.findFirst({ where: { id: { in: ids } } }))?.agent ?? null;
}

// ---------- find corrections in the database ----------

export async function findCorrections(skip: Set<string>): Promise<NewCorrection[]> {
  const out: NewCorrection[] = [];
  const isNew = (source: CorrectionSource, id: string) => !skip.has(`${source}:${id}`);

  // Step 1: specs edited on approval, or rejected with a comment. Input = the brief (same shape as the eval items).
  const specs = await db.jobSpec.findMany({
    where: { OR: [{ status: "approved", fieldsEdited: { gt: 0 } }, { status: "rejected", rejectComment: { not: null } }] },
    include: { brief: true, job: { select: { id: true } } },
  });
  for (const s of specs) {
    const source: CorrectionSource = s.status === "approved" ? "job_spec_edited" : "job_spec_rejected";
    if (!isNew(source, s.id)) continue;
    const draft = s.agentDraft as Record<string, unknown>;
    const brief = { brief: { id: s.brief.id, client_id: s.brief.clientId, from: s.brief.fromName, subject: s.brief.subject, received: s.brief.receivedAt.toISOString().slice(0, 10), body: s.brief.body } };
    if (source === "job_spec_edited") {
      const fields = changedFields(draft, s.spec as Record<string, unknown>);
      out.push({
        agent: "job-spec-agent", source, sourceId: s.id, jobId: s.job?.id, input: brief, agentOutput: draft,
        correctedOutput: s.spec as object,
        expected: `Role ${s.roleIndex + 1} of ${s.roleCount}: the recruiter changed ${fields.join(", ")}. Recruiter's version: ${JSON.stringify(pick(s.spec as Record<string, unknown>, fields))}`,
      });
    } else {
      out.push({ agent: "job-spec-agent", source, sourceId: s.id, input: brief, agentOutput: draft, correctedOutput: { comment: s.rejectComment }, expected: `Role ${s.roleIndex + 1} of ${s.roleCount}: rejected. Recruiter's comment: “${s.rejectComment}”` });
    }
  }

  // Step 4: screening scores the recruiter overrode (current screening only: it matches the job's current spec).
  const overrides = await db.screeningResult.findMany({ where: { overrideScore: { not: null }, current: true, filteredOut: false }, include: { job: { include: { jobSpec: true } } } });
  for (const r of overrides) {
    if (!isNew("screening_override", r.id) || !r.data) continue;
    const profile = await db.candidateProfile.findUnique({ where: { candidateId: r.candidateId } });
    if (!profile) continue;
    const data = r.data as ScreeningData;
    out.push({
      agent: "screening-agent", source: "screening_override", sourceId: r.id, jobId: r.jobId, candidateId: r.candidateId,
      input: { spec: r.job.jobSpec.spec as JobSpecData, profile: profile.data as object },
      agentOutput: { score: r.score, confidence: r.confidence, reasons: data.reasons },
      correctedOutput: { score: r.overrideScore, note: r.overrideNote },
      expected: `score ${r.overrideScore} +/- ${SCORE_TOLERANCE} (recruiter's override; the agent said ${r.score})${r.overrideNote ? `. Recruiter's note: “${r.overrideNote}”` : ""}`,
      checkKind: "score_within", checkValue: r.overrideScore,
    });
  }

  // Step 5: replies whose intent the recruiter marked Wrong. Input = the thread up to that reply + the job spec.
  const wrong = await db.message.findMany({ where: { direction: "inbound", classifierCorrect: false }, include: { job: { include: { jobSpec: true } } } });
  for (const m of wrong) {
    if (!isNew("classifier_corrected", m.id) || !m.intent) continue;
    const c = m.classification as ReplyClassification;
    const at = m.sentAt ?? m.createdAt;
    const thread = (await getThread(m.jobId, m.candidateId)).filter((x) => (x.sentAt ?? x.createdAt) <= at);
    const candidate = await db.candidate.findUnique({ where: { id: m.candidateId } });
    out.push({
      agent: "reply-classifier", source: "classifier_corrected", sourceId: m.id, jobId: m.jobId, candidateId: m.candidateId,
      input: { reply: m.body, today: at.toISOString().slice(0, 10), spec: m.job.jobSpec.spec as JobSpecData, thread: threadText(thread), candidate_id: m.candidateId, full_name: candidate?.fullName ?? m.candidateId },
      agentOutput: c, correctedOutput: { intent: m.intent },
      expected: `intent ${m.intent} (the recruiter corrected “${c.intent}”)`,
      checkKind: "intent_is", checkValue: m.intent,
    });
  }

  // Gmail inbound (docs/specs/11-gmail-inbound.md): ignored emails the recruiter marked "This is a brief".
  const wrongInbound = await db.inboundEmail.findMany({ where: { classifierWrong: true } });
  for (const e of wrongInbound) {
    if (!isNew("inbound_classifier_corrected", e.id)) continue;
    out.push({
      agent: "inbound-classifier", source: "inbound_classifier_corrected", sourceId: e.id,
      input: { fromName: e.fromName, fromEmail: e.fromEmail, subject: e.subject, body: e.body, attachmentNames: e.attachmentNames as string[] },
      agentOutput: { kind: "not_brief", reason: e.reason }, correctedOutput: { kind: "brief" },
      expected: "kind brief (the recruiter marked this ignored email as a brief)",
      checkKind: "kind_is", checkValue: "brief",
    });
  }

  // Step 5: drafts edited before sending, or rejected with a comment (outreach drafts and the classifier's suggested replies).
  const drafts = await db.message.findMany({
    where: { direction: "outbound", kind: { in: ["first", "follow_up", "reply"] }, OR: [{ status: "sent" }, { status: "rejected", rejectComment: { not: null } }] },
    include: { job: { select: { title: true } } },
  });
  for (const m of drafts) {
    const a = m.agentDraft as { subject: string; body: string } | null;
    if (!a) continue;
    const edited = m.status === "sent" && (a.subject.trim() !== m.subject.trim() || a.body.trim() !== m.body.trim());
    if (m.status === "sent" && !edited) continue;
    const source: CorrectionSource = edited ? "outreach_edited" : "outreach_rejected";
    if (!isNew(source, m.id)) continue;
    const agent = ((await agentOf(m.agentRunIds)) ?? "outreach-draft") as AgentName;
    const thread = (await getThread(m.jobId, m.candidateId)).filter((x) => (x.sentAt ?? x.createdAt) < m.createdAt);
    out.push({
      agent: agent === "reply-classifier" ? "reply-classifier" : "outreach-draft", source, sourceId: m.id, jobId: m.jobId, candidateId: m.candidateId,
      input: { job_title: m.job.title, candidate_id: m.candidateId, kind: m.kind, sequence_step: m.sequenceStep, thread: threadText(thread) },
      agentOutput: a,
      correctedOutput: edited ? { subject: m.subject, body: m.body } : { comment: m.rejectComment },
      expected: edited ? `The recruiter's edited version (sent): subject “${m.subject}”, body: ${m.body}` : `Rejected. Recruiter's comment: “${m.rejectComment}”`,
    });
  }

  // Step 6: the recruiter disagreed with the pre-screen recommendation (proceed -> didn't submit, stop -> submitted).
  const prescreens = await db.prescreen.findMany({ where: { OR: [{ recommendation: "proceed", decision: "dont_submit" }, { recommendation: "stop", decision: "submit" }] } });
  for (const p of prescreens) {
    if (!isNew("prescreen_disagreed", p.id)) continue;
    const thread = await getThread(p.jobId, p.candidateId);
    out.push({
      agent: "prescreen-agent", source: "prescreen_disagreed", sourceId: p.id, jobId: p.jobId, candidateId: p.candidateId,
      input: { task: "summary", candidate_id: p.candidateId, questions: p.questions as object, thread: threadText(thread) },
      agentOutput: (p.data as object) ?? { recommendation: p.recommendation },
      correctedOutput: { decision: p.decision },
      expected: `The agent recommended “${p.recommendation}”; the recruiter decided “${p.decision === "submit" ? "submit" : "don't submit"}”.`,
    });
  }

  // Step 7: submissions the account manager edited before sending, or rejected with a comment.
  const subs = await db.submission.findMany({ where: { OR: [{ status: "sent" }, { status: "rejected", rejectComment: { not: null } }] } });
  for (const s of subs) {
    const fields = changedFields(s.agentDraft as Record<string, unknown>, s.data as Record<string, unknown>);
    const edited = s.status === "sent" && fields.length > 0;
    if (s.status === "sent" && !edited) continue;
    const source: CorrectionSource = edited ? "submission_edited" : "submission_rejected";
    if (!isNew(source, s.id)) continue;
    out.push({
      agent: "submission-agent", source, sourceId: s.id, jobId: s.jobId, candidateId: s.candidateId,
      input: { candidate_id: s.candidateId, client_id: s.clientId, anonymized: s.anonymized, format: s.format as object },
      agentOutput: s.agentDraft as object,
      correctedOutput: edited ? (s.data as object) : { comment: s.rejectComment },
      expected: edited ? `The account manager changed ${fields.join(", ")}: ${JSON.stringify(pick(s.data as Record<string, unknown>, fields))}` : `Rejected. Account manager's comment: “${s.rejectComment}”`,
    });
  }
  return out;
}

// ---------- save + push to Langfuse ----------

// Saves corrections not seen before and pushes every unsynced one to its agent's Langfuse dataset.
// Returns how many were new and how many were pushed. Safe to run any time (never adds the same correction twice).
export async function collectCorrections(): Promise<{ added: number; synced: number; syncError: string | null }> {
  const seen = await db.datasetCorrection.findMany({ select: { source: true, sourceId: true } });
  const found = await findCorrections(new Set(seen.map((s) => `${s.source}:${s.sourceId}`)));
  let added = 0;
  for (const c of found) {
    const { count } = await db.datasetCorrection.createMany({
      data: [{ ...c, jobId: c.jobId ?? null, candidateId: c.candidateId ?? null, checkKind: c.checkKind ?? null, checkValue: c.checkValue ?? undefined, langfuseItemId: `correction-${c.source.replaceAll("_", "-")}-${c.sourceId}` }],
    }).catch(() => ({ count: 0 })); // unique (source, sourceId): a parallel run already saved it
    added += count;
  }
  const r = await syncCorrections();
  return { added, ...r };
}

export async function syncCorrections(agent?: string): Promise<{ synced: number; syncError: string | null }> {
  const todo = await db.datasetCorrection.findMany({ where: { syncedAt: null, ...(agent ? { agent } : {}) }, orderBy: { createdAt: "asc" } });
  if (!todo.length) return { synced: 0, syncError: null };
  const { langfuse } = getTelemetry();
  const datasets = new Set<string>();
  let synced = 0;
  try {
    for (const c of todo) {
      if (!datasets.has(c.agent)) {
        // Normally created by the agent's eval items already (src/evals/datasets.ts); create it if not.
        await langfuse.api.datasets.create({ name: c.agent, description: `${c.agent} eval items (src/evals/datasets.ts) + recruiter corrections (Step 9)` }).catch(() => undefined);
        datasets.add(c.agent);
      }
      await langfuse.api.datasetItems.create({
        datasetName: c.agent,
        id: c.langfuseItemId,
        input: c.input,
        expectedOutput: { expected: c.expected, corrected_output: c.correctedOutput },
        metadata: { test_case: SOURCE_LABELS[c.source as CorrectionSource] ?? c.source, eval: !!c.checkKind, item_id: c.langfuseItemId, correction: true, source: c.source, job_id: c.jobId, candidate_id: c.candidateId, agent_output: c.agentOutput },
      });
      await db.datasetCorrection.update({ where: { id: c.id }, data: { syncedAt: new Date() } });
      synced++;
    }
    return { synced, syncError: null };
  } catch (e) {
    // Saved in the database either way; the next run pushes what's left.
    return { synced, syncError: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- checks for `npm run eval` ----------

export type CorrectionCheck = { passed: boolean; detail: string };

export function correctionCheck(c: { checkKind: string | null; checkValue: unknown }): ((out: unknown) => CorrectionCheck) | null {
  if (c.checkKind === "score_within") {
    const want = Number(c.checkValue);
    return (out) => {
      const s = (out as ScreeningData).score;
      return { passed: Math.abs(s - want) <= SCORE_TOLERANCE, detail: `${Math.abs(s - want) <= SCORE_TOLERANCE ? "ok" : "FAIL"} score ${s}, recruiter said ${want} (+/- ${SCORE_TOLERANCE})` };
    };
  }
  if (c.checkKind === "kind_is") {
    const want = String(c.checkValue);
    return (out) => {
      const k = (out as { kind: string }).kind;
      return { passed: k === want, detail: `${k === want ? "ok" : "FAIL"} kind ${k}, recruiter said ${want}` };
    };
  }
  if (c.checkKind === "intent_is") {
    const want = String(c.checkValue);
    return (out) => {
      const i = (out as ReplyClassification).intent;
      return { passed: i === want, detail: `${i === want ? "ok" : "FAIL"} intent ${i}, recruiter said ${want}` };
    };
  }
  return null;
}

// The agent's checkable corrections as eval items (same shape as src/evals/datasets.ts items).
export async function correctionEvalItems(agent: string) {
  const rows = await db.datasetCorrection.findMany({ where: { agent, checkKind: { not: null } }, orderBy: { createdAt: "asc" } });
  return rows.map((c) => ({ id: c.langfuseItemId, name: `Correction: ${SOURCE_LABELS[c.source as CorrectionSource] ?? c.source}`, input: c.input, expected: c.expected, check: correctionCheck(c)! }));
}
