import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import type { CandidateProfileData } from "@/agents/enrichment/schema";
import { CV_MAX_FILE_MB, CV_MAX_FILES_PER_UPLOAD, CV_READER_CONCURRENCY } from "@/config/budgets";
import { cityOf, fold, headline } from "@/lib/candidates";
import { db } from "@/lib/db";
import { ActionButton } from "../action-button";
import { icons } from "../icons";
import { deleteCvAction } from "./actions";
import { UploadForm } from "./upload-form";

const ink = "text-ink";
const muted = "text-stone-500";
const line = "border-stone-300";
const outlineLink = `inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-5 py-2.5 text-base hover:bg-white ${line} ${ink}`;
const badge = "rounded px-2 py-0.5 text-xs font-normal tracking-normal";
const SOURCES: Record<string, string> = { pdf_upload: "Uploaded PDF", cv_upload: "CV", linkedin_export: "LinkedIn export", referral_note: "Referral note" };
// A candidate's stage on their latest job, as the tag says it. Green = still in play, grey = out, solid green = hired.
const STAGE: Record<string, string> = {
  sourced: "Sourced",
  shortlisted: "Shortlisted",
  contacted: "Contacted",
  replied: "Replied",
  declined: "Declined",
  prescreened: "Pre-screened",
  submitted: "Sent to client",
  client_rejected: "Client said no",
  interview: "Interview",
  hired: "Hired",
  withdrew: "Withdrew",
};
const OUT = ["declined", "client_rejected", "withdrew"];
const PAGE = 30;

type Query = { tab?: string; q?: string; more?: string; open?: string };

// Candidates (docs/specs/15-cv-upload.md), in the Briefs style: the whole pool sourcing searches, seed candidates and
// uploaded PDF CVs together. The lime banner is the upload box; uploaded ones open as the original PDF and can be
// deleted. "Profile" shows the profile text under the row.
export default async function CandidatesPage({ searchParams }: { searchParams: Promise<Query> }) {
  await connection();
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const [candidates, uploads, entries, profiles] = await Promise.all([
    db.candidate.findMany({ orderBy: { id: "asc" } }),
    db.cvUpload.findMany({ select: { candidateId: true, fileName: true, uploadedAt: true } }),
    db.pipelineEntry.findMany({ select: { candidateId: true, jobId: true, stage: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    db.candidateProfile.findMany({ select: { candidateId: true, data: true } }),
  ]);
  const uploadOf = new Map(uploads.map((u) => [u.candidateId, u]));
  const profileOf = new Map(profiles.map((p) => [p.candidateId, p.data as CandidateProfileData]));
  const jobsOf = (id: string) => entries.filter((e) => e.candidateId === id); // newest first

  // Uploaded first (newest on top), then the rest by id.
  const sorted = [
    ...candidates.filter((c) => uploadOf.has(c.id)).sort((a, b) => +uploadOf.get(b.id)!.uploadedAt - +uploadOf.get(a.id)!.uploadedAt),
    ...candidates.filter((c) => !uploadOf.has(c.id)),
  ];
  const found = q ? sorted.filter((c) => fold(`${c.fullName}\n${c.rawProfile}`).includes(fold(q))) : sorted;
  const tabs = [
    { key: "all", label: "All", list: found },
    { key: "uploaded", label: "Uploaded", list: found.filter((c) => uploadOf.has(c.id)) },
    { key: "onjob", label: "On a job", list: found.filter((c) => jobsOf(c.id).length) },
  ];
  const active = tabs.find((t) => t.key === params.tab) ?? tabs[0];
  const shown = params.more ? active.list : active.list.slice(0, PAGE);

  // Links keep the search and tab; `set` changes some of them.
  const href = (set: Partial<Query>) => {
    const p = new URLSearchParams(Object.entries({ tab: active.key === "all" ? undefined : active.key, q: q || undefined, more: params.more, open: params.open, ...set }).filter(([, v]) => v) as [string, string][]);
    return `/candidates${p.size ? `?${p}` : ""}`;
  };

  const row = (c: (typeof candidates)[number], n: number) => {
    const upload = uploadOf.get(c.id);
    const jobs = jobsOf(c.id);
    const latest = jobs[0];
    const profile = profileOf.get(c.id);
    const years = profile?.years_experience;
    const meta = [c.id, SOURCES[c.source] ?? c.source, profile?.location ?? cityOf(c.rawProfile), years != null && `${years} yrs`].filter(Boolean).join(" / ");
    const open = params.open === c.id;
    const jobLink = latest && `/jobs/${latest.jobId}?tab=${latest.stage === "sourced" ? "pool" : "shortlisted"}#cand-${c.id}`;
    return (
      <li key={c.id} id={c.id} className="flex scroll-mt-6 flex-wrap items-center gap-x-6 gap-y-3 py-6 sm:flex-nowrap">
        <span className={`w-8 shrink-0 self-start pt-1.5 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(n).padStart(2, "0")}</span>
        <div className="min-w-0 flex-[1_1_300px]">
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xl tracking-tight break-words sm:text-2xl ${ink}`}>
            {c.fullName}
            {upload && <span className={`${badge} bg-brand font-semibold!`}>Uploaded</span>}
            {latest && (
              <span className={`${badge} ${latest.stage === "hired" ? "bg-emerald-600 text-white" : OUT.includes(latest.stage) ? "bg-stone-200 text-stone-600" : "bg-emerald-100 text-emerald-800"}`}>
                On {jobs.length} job{jobs.length === 1 ? "" : "s"} · {STAGE[latest.stage] ?? latest.stage}
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-base text-stone-700">{profile?.current_title ?? headline(c.rawProfile)}</div>
          <div className={`mt-1.5 text-sm tracking-wide uppercase ${muted}`}>{meta}</div>
          {open && (
            <div className="mt-4">
              <div className={`text-xs font-semibold tracking-[0.2em] uppercase ${muted}`}>{upload ? "Text the CV reader saved" : "Profile text"}</div>
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-stone-200 bg-white p-4 font-sans text-sm whitespace-pre-wrap">{c.rawProfile}</pre>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 self-start max-sm:basis-full">
          {jobLink && (
            <Link href={jobLink} className={outlineLink}>
              Open job {icons.arrowUpRight}
            </Link>
          )}
          <Link href={`${href({ open: open ? undefined : c.id })}#${c.id}`} scroll={false} className={outlineLink} aria-expanded={open}>
            {open ? "Hide profile" : "Profile"}
          </Link>
          {upload && (
            <>
              <a href={`/candidates/${c.id}/cv`} target="_blank" rel="noreferrer" title={upload.fileName} className={outlineLink}>
                PDF {icons.arrowUpRight}
              </a>
              <ActionButton
                action={deleteCvAction.bind(null, c.id)}
                label={jobs.length ? "Can't delete: this candidate is in a job" : `Delete ${c.fullName}`}
                variant="icon"
                icon={icons.trash}
                disabled={jobs.length > 0}
                confirm={{ title: `Delete ${c.fullName}?`, body: "This deletes the candidate, the PDF and the extracted profile. This can't be undone.", ok: "Delete" }}
              />
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className={`flex flex-col gap-10 pt-2 sm:gap-12 ${ink}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className={`min-w-0 flex-[1_1_240px] text-lg font-semibold tracking-tight uppercase sm:text-xl ${muted}`}>Candidates</div>
        <form action="/candidates" role="search" className="flex max-sm:basis-full">
          {active.key !== "all" && <input type="hidden" name="tab" value={active.key} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Name, stack or city"
            aria-label="Search candidates"
            className={`w-full rounded-xl border bg-field px-4 py-2.5 text-base placeholder:text-stone-400 focus:border-ink focus:outline-none sm:w-72 ${line}`}
          />
        </form>
      </div>

      <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] sm:text-7xl lg:text-[5.5rem]">
        Every CV.
        <br />
        Read for you.
      </h1>

      <UploadForm maxFiles={CV_MAX_FILES_PER_UPLOAD} maxMb={CV_MAX_FILE_MB} concurrency={CV_READER_CONCURRENCY} />

      <div id="list" className="flex scroll-mt-6 flex-col gap-4">
        <nav className="flex flex-wrap gap-1 sm:gap-2" aria-label="Candidates">
          {tabs.map((t) => {
            const on = t.key === active.key;
            return (
              <Link
                key={t.key}
                href={href({ tab: t.key === "all" ? undefined : t.key, more: undefined, open: undefined })}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3.5 py-2.5 text-base whitespace-nowrap sm:px-5 sm:py-3 sm:text-lg ${on ? "bg-ink text-white" : `${muted} hover:text-ink`}`}
              >
                {t.label} · {t.list.length}
              </Link>
            );
          })}
        </nav>

        {q && (
          <div className={`text-base ${muted}`}>
            {active.list.length} found for “{q}”.{" "}
            <Link href={href({ q: undefined, more: undefined })} className="text-ink underline underline-offset-4">
              Clear search
            </Link>
          </div>
        )}

        {shown.length ? (
          <ul className={`divide-y divide-stone-300 border-b ${line}`}>{shown.map((c, i) => row(c, i + 1))}</ul>
        ) : (
          <Empty>
            {q
              ? "Nobody matches that search."
              : { uploaded: "No uploaded CVs yet. Drop a PDF on the lime box.", onjob: "Nobody is on a job yet. Sourcing adds candidates to jobs." }[active.key] ?? "No candidates."}
          </Empty>
        )}

        {shown.length < active.list.length && (
          <Link href={href({ more: "1" })} scroll={false} className={`${outlineLink} self-start`}>
            Show {active.list.length - shown.length} more
          </Link>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{children}</div>;
}
