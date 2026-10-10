import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { dateTime, initials, sentences } from "@/lib/format";
import type { CandidateProfileData } from "@/agents/enrichment/schema";
import type { PrescreenSummary } from "@/agents/prescreen/schema";
import type { ScreeningData } from "@/agents/screening/schema";
import type { SubmissionData } from "@/agents/submission/schema";
import { candidateRef, clientEmailOf, confirmedRateOf } from "@/agents/submission/workflow";
import type { SubmissionFormat } from "@/config/submission";
import { icons } from "../../../icons";
import { StatusBadge } from "../../../status-badge";
import { SubmissionEditor } from "./submission-editor";
import { PageHeader } from "../../../page-header";

// Step 7 approval: the account manager sees the profile in the client's format next to the source data.
export default async function SubmissionApprovalPage({ params }: PageProps<"/approvals/submission/[id]">) {
  await connection();
  const { id } = await params;
  const sub = await db.submission.findUnique({ where: { id } });
  if (!sub) notFound();
  const [job, client, candidate, profileRow, screening, pre, previous, newer, sentMsg] = await Promise.all([
    db.job.findUniqueOrThrow({ where: { id: sub.jobId }, include: { jobSpec: { include: { brief: true } } } }),
    db.client.findUniqueOrThrow({ where: { id: sub.clientId } }),
    db.candidate.findUniqueOrThrow({ where: { id: sub.candidateId } }),
    db.candidateProfile.findUnique({ where: { candidateId: sub.candidateId } }),
    db.screeningResult.findFirst({ where: { jobId: sub.jobId, candidateId: sub.candidateId, current: true } }),
    db.prescreen.findUnique({ where: { jobId_candidateId: { jobId: sub.jobId, candidateId: sub.candidateId } } }),
    sub.previousSubmissionId ? db.submission.findUnique({ where: { id: sub.previousSubmissionId } }) : null,
    db.submission.findFirst({ where: { previousSubmissionId: sub.id } }),
    sub.messageId ? db.message.findUnique({ where: { id: sub.messageId }, select: { toEmail: true } }) : null,
  ]);
  const contact = await clientEmailOf(sub.clientId, job.jobSpec.briefId);
  const pending = sub.status === "awaiting_approval";
  const data = sub.data as SubmissionData;
  const format = sub.format as SubmissionFormat;
  const profile = profileRow?.data as CandidateProfileData | undefined;
  const s = screening?.data as ScreeningData | null;
  const ps = pre?.data as PrescreenSummary | null;
  const shownAs = sub.anonymized ? candidateRef(sub.candidateId) : candidate.fullName;

  const fullStatus = SUB_STATUS[sub.status] ?? { label: sub.status.replaceAll("_", " "), style: "bg-stone-200 text-stone-700" };
  const why = sentences(s?.reasons ?? null);
  const meta = [profile?.years_experience != null && `${profile.years_experience} years`, profile?.location].filter(Boolean).join(" · ");

  return (
    <div className="text-ink">
      <PageHeader
        back={{ href: "/approvals", label: "Approval queue" }}
        title="Send to client"
        meta={
          <>
            <span className="break-words">{shownAs}</span>
            <span className={`rounded-md px-2 py-0.5 text-sm ${fullStatus.style}`}>{fullStatus.label}</span>
            {sub.anonymized && <span className="rounded-md bg-violet-100 px-2 py-0.5 text-sm text-violet-800">Anonymized for this client</span>}
            <span>
              {client.name} · {job.title}
            </span>
          </>
        }
        subtitle="Edit the profile before account manager approval. Nothing reaches the client until approved."
        right={
          <Link href={`/jobs/${job.id}`} className={`text-sm ${muted} underline underline-offset-4 hover:text-ink`}>
            Job page
          </Link>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-stone-300 bg-white px-5 py-3.5 sm:px-6">
        <span className="hidden size-10 shrink-0 place-items-center rounded-full bg-soft text-sm text-olive sm:grid">{initials(candidate.fullName)}</span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium break-words">{candidate.fullName}</div>
          <div className={`text-sm break-all ${muted}`}>
            To client · {pending ? (contact?.email ?? "no email yet") : (sentMsg?.toEmail ?? contact?.email ?? "no email")}
          </div>
        </div>
        <Link
          href={`/submissions/${sub.id}?print=1`}
          target="_blank"
          title="Save as PDF"
          aria-label="Save the client profile as PDF"
          className="grid size-10 place-items-center rounded-lg bg-soft text-olive hover:bg-soft-hover"
        >
          {icons.fileDown}
        </Link>
      </div>

      {pending && !contact && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-semibold">Can&apos;t send yet: {client.name} has no email</div>
          <div>
            Add it on the{" "}
            <Link href="/clients" className="underline underline-offset-2">
              Clients page
            </Link>{" "}
            (Edit email), then come back and approve.
          </div>
        </div>
      )}

      {(newer || previous || sub.status !== "awaiting_approval") && (
        <div className="mt-4 space-y-3">
          {newer && (
            <div className="rounded-r-lg border-l-4 border-olive-line bg-soft px-4 py-2 text-sm">
              This version was rejected.{" "}
              <Link href={`/approvals/submission/${newer.id}`} className="underline underline-offset-2">
                Open the rewritten version →
              </Link>
            </div>
          )}
          {previous && <div className="rounded-r-lg border-l-4 border-olive-line bg-soft px-4 py-2 text-sm">Rewritten after your comment: “{previous.rejectComment}”</div>}
          {sub.status !== "awaiting_approval" && (
            <div className="rounded-lg bg-stone-200/60 px-4 py-3 text-sm text-stone-700">
              {sub.status === "sent" ? `Sent to ${sentMsg?.toEmail || "the client"}` : sub.status === "withdrawn" ? "Not submitted (Don't submit)" : `Rejected: “${sub.rejectComment}”`}
              {sub.decidedAt ? ` · ${dateTime(sub.decidedAt)}` : ""}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-8">
        <SubmissionEditor
          submissionId={sub.id}
          fields={format.fields}
          initial={{ headline: data.headline, summary: data.summary, key_skills: data.key_skills, experience_highlights: data.experience_highlights, rate: data.rate, availability: data.availability }}
          sources={(sub.agentDraft as SubmissionData).highlight_sources ?? []}
          editable={pending}
          toEmail={contact?.email ?? null}
        />

        <aside className="min-w-0 space-y-5 text-sm">
          <div>
            <div className={label}>Internal reference · not sent</div>
            <div className="mt-3 text-xl tracking-tight">{profile?.current_title ?? "Title unknown"}</div>
            {meta && <div className={`mt-1 text-base ${muted}`}>{meta}</div>}
            <div className={`text-base ${muted}`}>English: {profile?.english_level ?? "not stated"}</div>
            {profile && profile.recent_stack.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {profile.recent_stack.map((t) => (
                  <span key={t} className="rounded-md bg-soft px-2 py-0.5 text-xs text-olive">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {profile && (
              <Fold title="Experience & skills">
                <div>Skills: {profile.skills.join(", ") || "–"}</div>
                {profile.job_history.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {profile.job_history.map((j, i) => (
                      <li key={i}>
                        {j.title}, {j.company} <span className={muted}>({j.start} – {j.end})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Fold>
            )}
            {profile && profile.key_facts.length > 0 && (
              <Fold title="Key facts">
                <Bullets items={profile.key_facts} />
              </Fold>
            )}
          </div>

          <div className="border-t border-stone-300 pt-5">
            <div className="flex items-center gap-3">
              <span className={label}>Screening · Step 4</span>
              {screening && <span className="rounded-md bg-brand px-2 py-0.5 text-xs font-semibold tabular-nums">{screening.overrideScore ?? screening.score ?? "–"}</span>}
            </div>
            <div className="mt-2 text-stone-600">
              {screening?.confidence ?? "–"} confidence · Must-haves met: {s?.must_have_met.join(", ") || "–"}
            </div>
            {s?.must_have_missing.length ? <div className="text-amber-700">Missing: {s.must_have_missing.join(", ")}</div> : null}
            {why.length > 0 && <p className="mt-2 leading-relaxed text-stone-600">{why[0]}</p>}
            {why.length > 1 && (
              <Fold title="Full screening reasons">
                <Bullets items={why.slice(1)} />
              </Fold>
            )}
            {screening?.overrideNote && <div className="mt-3 rounded-lg bg-soft px-4 py-2.5 text-stone-700">Recruiter note: {screening.overrideNote}</div>}
          </div>

          <div className="border-t border-stone-300 pt-5">
            <div className="flex items-center gap-3">
              <span className={label}>Pre-screen · Step 6</span>
              {ps && <StatusBadge status={ps.recommendation} />}
            </div>
            {ps ? (
              <>
                <p className="mt-2 leading-relaxed text-stone-600">{ps.summary}</p>
                {ps.red_flags.length > 0 && <div className="mt-2 text-red-800">Red flags (internal, not sent): {ps.red_flags.join("; ")}</div>}
                <div className="mt-2 text-stone-600">
                  Confirmed rate: <span className="font-semibold text-ink">{confirmedRateOf(pre)}</span>
                  {pre?.confirmedRate ? " (typed by the recruiter)" : ""}
                </div>
                <div className="text-stone-600">Availability: {ps.availability ?? "not stated"}</div>
                <Fold title={`Questions and answers (${ps.answers.length})`}>
                  <ol className="list-decimal space-y-1.5 pl-4">
                    {ps.answers.map((a, i) => (
                      <li key={i}>
                        <span className={muted}>{a.question}</span> {a.answer ?? <span className="text-amber-700">not answered</span>}
                      </li>
                    ))}
                  </ol>
                </Fold>
              </>
            ) : (
              <p className={`mt-2 ${muted}`}>No pre-screen.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

const muted = "text-stone-500";
const label = "font-mono text-xs tracking-[0.2em] uppercase text-stone-500";
const SUB_STATUS: Record<string, { label: string; style: string }> = {
  awaiting_approval: { label: "Awaiting approval", style: "bg-amber-100 text-amber-800" },
  sent: { label: "Sent to client", style: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", style: "bg-rose-100 text-rose-800" },
  withdrawn: { label: "Not submitted", style: "bg-stone-200 text-stone-600" },
};

// A folded list in the source column (same look as "Full screening reasons" on Review outreach).
function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group mt-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-olive [&::-webkit-details-marker]:hidden">
        <span className="text-[10px] transition-transform group-open:rotate-90">▶</span>
        {title}
      </summary>
      <div className="mt-2 text-stone-600">{children}</div>
    </details>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((w, i) => (
        <li key={i} className="flex gap-3 leading-snug">
          <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-olive-mid" />
          {w}
        </li>
      ))}
    </ul>
  );
}
