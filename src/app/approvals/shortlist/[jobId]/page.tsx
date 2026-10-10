import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { icons } from "../../../icons";
import { rankResults } from "@/agents/pipeline/workflow";
import { DEALBREAKER_MAX_SCORE } from "@/agents/screening/agent";
import type { CandidateProfileData } from "@/agents/enrichment/schema";
import type { ScreeningData } from "@/agents/screening/schema";
import type { JobSpecData } from "@/agents/job-spec/schema";
import { STATUS } from "../../../jobs/status";
import { countsLine, sourcingInfo, SourcingDetailsBody } from "../../../jobs/sourcing";
import { ShortlistEditor, type ShortlistRow } from "./shortlist-editor";
import { PageHeader } from "../../../page-header";

// Shortlist review mockup (2026-10-09): big job title, the sourcing headlines in a lime box, one row per candidate
// (fit to check, agent score, your score), lime Approve shortlist at the bottom.
const muted = "text-stone-500";

// "Outside EU" in the Fit to check column: only when the spec asks for the EU and the profile's country is not in it.
const EU = ["Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czechia", "Czech Republic", "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden"];
const outsideEu = (spec: JobSpecData, location: string | null | undefined) =>
  !!location && spec.location.some((l) => /\bEU\b/.test(l)) && !EU.includes(location.split(",").pop()!.trim());

// How many top-ranked candidates start ticked. recruiter_agreement = share of these the recruiter keeps.
const PRESELECT_TOP = 10;

// Step 4 approval: the recruiter picks the shortlist (or edits the spec and re-sources).
export default async function ShortlistPage({ params }: PageProps<"/approvals/shortlist/[jobId]">) {
  await connection();
  const { jobId } = await params;
  const job = await db.job.findUnique({ where: { id: jobId }, include: { jobSpec: true } });
  if (!job) notFound();
  const [client, entries, results] = await Promise.all([
    db.client.findUnique({ where: { id: job.clientId } }),
    db.pipelineEntry.findMany({ where: { jobId } }),
    db.screeningResult.findMany({ where: { jobId, current: true } }),
  ]);
  const ids = results.map((r) => r.candidateId);
  const [candidates, profiles] = await Promise.all([
    db.candidate.findMany({ where: { id: { in: ids } } }),
    db.candidateProfile.findMany({ where: { candidateId: { in: ids } } }),
  ]);
  const spec = job.jobSpec.spec as JobSpecData;
  const decided = job.status !== "awaiting_shortlist";

  const ranked = rankResults(
    results.map((r) => {
      const profile = profiles.find((p) => p.candidateId === r.candidateId)?.data as CandidateProfileData | undefined;
      return { ...r, years: profile?.years_experience ?? null, profile };
    }),
    { useOverrides: decided },
  );
  let preselected = 0;
  const rows: ShortlistRow[] = ranked.map((r) => {
    const s = r.data as ScreeningData | null;
    const c = candidates.find((x) => x.id === r.candidateId);
    const stage = entries.find((e) => e.candidateId === r.candidateId)?.stage ?? "sourced";
    const preselect = !decided && !r.filteredOut && (r.score ?? 0) > DEALBREAKER_MAX_SCORE && preselected++ < PRESELECT_TOP;
    return {
      candidateId: r.candidateId,
      name: c?.fullName ?? r.candidateId,
      language: c?.language ?? "en",
      title: r.profile?.current_title ?? null,
      years: r.years,
      location: r.profile?.location ?? null,
      filteredOut: r.filteredOut,
      filterReason: r.filterReason,
      score: r.score,
      confidence: r.confidence,
      reasons: s?.reasons ?? null,
      mustHaveMet: s?.must_have_met ?? [],
      mustHaveMissing: s?.must_have_missing ?? [],
      dealbreaker: s?.dealbreaker_hit ?? null,
      missingFields: r.profile?.missing_fields.length ?? 0,
      outsideEu: outsideEu(spec, r.profile?.location),
      selected: decided ? stage === "shortlisted" : preselect,
      overrideScore: r.overrideScore,
      overrideNote: r.overrideNote ?? "",
    };
  });
  const status = STATUS[job.status] ?? { label: job.status.replaceAll("_", " "), style: "bg-stone-200 text-stone-700" };
  const sourcing = await sourcingInfo(job);
  const counts = countsLine(sourcing);
  // Box headline: "Search broadened" plus the agent's headline titles; the text is their sentences
  // (jobs sourced before headlines existed have none, so the box is just the headline and the details).
  const headline = [sourcing.broadened && "Search broadened", ...sourcing.highlights.map((h) => h.title)].filter(Boolean).join(" · ") || "Sourcing notes";
  const boxText = sourcing.highlights.map((h) => h.text).join(" ");

  return (
    <div className="text-ink">
      <PageHeader
        back={{ href: `/jobs/${job.id}`, label: "Job page" }}
        title="Shortlist review"
        meta={
          <>
            <span className="break-words">
              {job.title} · {client?.name}
            </span>
            <span className={`rounded-md px-2.5 py-0.5 ${status.style}`}>{status.label}</span>
          </>
        }
      />

      {(job.pipelineNote || sourcing.highlights.length > 0) && (
        <div className="mt-6 rounded-r-xl border-l-4 border-olive-line bg-soft px-5 py-4 sm:px-7">
          <div className="text-lg font-medium">{headline}</div>
          {boxText && <p className="mt-1 max-w-5xl text-base leading-relaxed text-stone-600">{boxText}</p>}
          {sourcing.hasDetails && (
            <details className="group mt-3">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 text-base [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <span className="transition-transform group-open:rotate-45">{icons.plus}</span>
                  Full sourcing details
                </span>
                {counts && <span className={`text-sm ${muted}`}>{counts}</span>}
              </summary>
              <div className="mt-4 pl-7">
                <SourcingDetailsBody s={sourcing} showBroadened={false} />
              </div>
            </details>
          )}
        </div>
      )}

      <ShortlistEditor jobId={job.id} rows={rows} spec={spec} status={job.status} />
    </div>
  );
}
