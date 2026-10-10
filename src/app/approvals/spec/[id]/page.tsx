import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { dateTime, usd } from "@/lib/format";
import type { JobSpecData, OpenQuestionAnswer } from "@/agents/job-spec/schema";
import { icons } from "../../../icons";
import { SpecEditor } from "./spec-editor";
import { PageHeader } from "../../../page-header";

// Job spec review mockup (2026-10-09): big title with status tags, the original brief as a reference card on the left,
// the draft spec on the right in numbered sections, open questions as cream cards, lime Approve spec at the bottom.
const muted = "text-stone-500";
const tag = "rounded-md px-3 py-1 text-base";
const STATUS: Record<string, { label: string; style: string }> = {
  awaiting_approval: { label: "Awaiting approval", style: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", style: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", style: "bg-rose-100 text-rose-800" },
};

// Job statuses while Steps 2-4 are still working on it (the approved panel says they're running).
const EARLY = ["ready_for_sourcing", "sourcing", "enriching", "screening"];

// Review one job spec: original brief side by side with the agent's draft (Step 1 approval).
export default async function SpecReviewPage({ params }: PageProps<"/approvals/spec/[id]">) {
  await connection();
  const { id } = await params;
  const spec = await db.jobSpec.findUnique({ where: { id }, include: { brief: { include: { client: true } }, job: true } });
  if (!spec) notFound();

  // Earlier versions of this spec (each rejected with a comment, then regenerated).
  const history = [];
  for (let prevId = spec.previousSpecId; prevId; ) {
    const prev = await db.jobSpec.findUnique({ where: { id: prevId } });
    if (!prev) break;
    history.push(prev);
    prevId = prev.previousSpecId;
  }
  const newer = spec.status === "rejected" ? await db.jobSpec.findFirst({ where: { previousSpecId: spec.id }, select: { id: true } }) : null;
  const runs = await db.agentRun.findMany({ where: { id: { in: spec.agentRunIds as string[] } }, orderBy: { createdAt: "asc" } });
  const cost = runs.reduce((n, r) => n + r.costUsd, 0);
  const budget = runs.reduce((n, r) => n + r.budgetUsd, 0) / Math.max(runs.length, 1);
  const lastRun = runs[runs.length - 1];

  const data = spec.spec as JobSpecData;
  const answers = spec.answers as OpenQuestionAnswer[];
  const awaiting = spec.status === "awaiting_approval";
  // Same rule as the editor: saved answers if they match the open questions, else the agent's questions, none answered.
  const saved = answers.filter((a) => !a.applied);
  const openCount = !awaiting ? 0 : saved.length === data.open_questions.length ? saved.filter((a) => !a.answered).length : data.open_questions.length;
  const status = STATUS[spec.status] ?? { label: spec.status.replaceAll("_", " "), style: "bg-stone-200 text-stone-700" };

  return (
    <div className="text-ink">
      <PageHeader
        back={{ href: "/approvals", label: "Approval queue" }}
        title="Job spec review"
        meta={
          <>
            <span className={`${tag} ${status.style}`}>{status.label}</span>
            <span>{spec.brief.client.name}</span>
            <span>· Step 1</span>
            {spec.roleCount > 1 && (
              <span className={`${tag} bg-sky-100 text-sky-800`}>
                Role {spec.roleIndex + 1} of {spec.roleCount} from this brief
              </span>
            )}
          </>
        }
        right={
          <div className="flex flex-col items-start gap-4 sm:items-center">
            {openCount > 0 && (
              <a href="#open-questions" className="rounded-xl border border-stone-300 px-5 py-3.5 text-lg hover:bg-white">
                {openCount === 1 ? "1 open question" : `${openCount} open questions`} ↓
              </a>
            )}
            {/* Run details: what the agent cost against its budget, and its Langfuse trace. */}
            <details className="group relative">
              <summary className={`cursor-pointer list-none text-base ${muted} underline underline-offset-4 hover:text-ink [&::-webkit-details-marker]:hidden`}>
                Run details
              </summary>
              <div className="absolute left-0 z-20 mt-3 w-72 sm:right-0 sm:left-auto rounded-xl border border-stone-200 bg-white p-5 text-base shadow-xl">
                <dl className="space-y-2">
                  <div className="flex justify-between gap-4">
                    <dt className={muted}>Agent cost</dt>
                    <dd>{usd(cost)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className={muted}>Budget</dt>
                    <dd>{usd(budget)}</dd>
                  </div>
                  {lastRun && (
                    <div className="flex justify-between gap-4">
                      <dt className={muted}>Model</dt>
                      <dd className="truncate">{lastRun.model}</dd>
                    </div>
                  )}
                </dl>
                {runs.length > 1 && <p className={`mt-3 ${muted}`}>Needed a schema retry.</p>}
                {lastRun?.traceUrl && (
                  <a href={lastRun.traceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block underline underline-offset-4">
                    Langfuse trace ↗
                  </a>
                )}
              </div>
            </details>
          </div>
        }
      />

      {(spec.agentNote || history[0]?.rejectComment) && (
        <div className="mt-8 space-y-3">
          {spec.agentNote && <p className="rounded-xl border border-stone-300 bg-white px-6 py-4 text-lg">Agent note: {spec.agentNote}</p>}
          {history[0]?.rejectComment && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 text-lg text-amber-900">
              Regenerated after rejection. Your comment: “{history[0].rejectComment}”
            </p>
          )}
        </div>
      )}

      <div className="mt-10 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.85fr)] lg:gap-8">
        <section className="rounded-xl border border-stone-300 bg-white px-6 py-7 sm:px-8">
          <div className={`font-mono text-sm tracking-[0.2em] uppercase ${muted}`}>Original brief / Reference</div>
          <h2 className="mt-4 text-2xl leading-snug">{spec.brief.subject}</h2>
          <div className={`mt-4 space-y-1 text-base ${muted}`}>
            <div>{spec.brief.client.name}</div>
            <div>
              {spec.brief.fromName} · {dateTime(spec.brief.receivedAt)}
            </div>
          </div>
          <pre className="mt-6 border-y border-stone-200 py-6 font-sans text-lg leading-loose whitespace-pre-wrap">{spec.brief.body}</pre>
          <p className={`mt-4 text-sm ${muted}`}>Original wording preserved</p>
        </section>

        <section className="overflow-hidden rounded-xl border border-stone-300 bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-stone-200 px-6 py-7 sm:px-10">
            <h2 className="text-3xl">{awaiting ? "Draft spec" : "Spec"}</h2>
            {awaiting && <span className={`text-base ${muted}`}>Edit before approving</span>}
          </div>
          <SpecEditor specId={spec.id} initialSpec={data} initialAnswers={answers} readOnly={!awaiting} />
          {spec.status === "approved" && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-5 border-t border-emerald-200 bg-emerald-50 px-6 py-7 sm:px-10">
              <span className="text-emerald-700">{icons.check}</span>
              <div className="min-w-0 flex-1">
                <p className="text-2xl font-semibold text-emerald-900">Spec approved · job created</p>
                <p className="mt-1 text-lg text-emerald-800">
                  {spec.decidedAt && dateTime(spec.decidedAt)}
                  {spec.fieldsEdited ? ` · ${spec.fieldsEdited} field(s) edited` : " · no edits"}
                  {spec.job && EARLY.includes(spec.job.status) && " · sourcing, enrichment and screening are running"}
                </p>
              </div>
              {spec.job && (
                <Link href={`/jobs/${spec.job.id}`} className="inline-flex items-center gap-6 rounded-xl bg-brand px-7 py-3.5 text-lg font-semibold hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover">
                  Open job {icons.arrowUpRight}
                </Link>
              )}
            </div>
          )}
          {spec.status === "rejected" && (
            <div className="border-t border-rose-200 bg-rose-50 px-6 py-7 sm:px-10">
              <p className="text-2xl font-semibold text-rose-900">Rejected · sent back to the agent</p>
              <p className="mt-1 text-lg text-rose-800">
                {spec.decidedAt && `${dateTime(spec.decidedAt)} · `}Your comment: “{spec.rejectComment}”
              </p>
              {newer && (
                <Link href={`/approvals/spec/${newer.id}`} className="mt-4 inline-block text-lg text-rose-900 underline underline-offset-4">
                  See the new draft →
                </Link>
              )}
            </div>
          )}
        </section>
      </div>

      {history.length > 0 && (
        <div className="mt-12">
          <h2 className={`font-mono text-sm tracking-[0.2em] uppercase ${muted}`}>Earlier versions</h2>
          <ul className="mt-4 divide-y divide-stone-300 border-y border-stone-300 text-lg">
            {history.map((h) => (
              <li key={h.id}>
                <Link href={`/approvals/spec/${h.id}`} className="block py-4 hover:underline">
                  {dateTime(h.createdAt)} · rejected: “{h.rejectComment}”
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
