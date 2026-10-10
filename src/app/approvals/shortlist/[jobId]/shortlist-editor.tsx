"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SENIORITIES, type JobSpecData } from "@/agents/job-spec/schema";
import type { ActionState } from "../../../action-state";
import { approveShortlistAction, editSpecAndResourceAction } from "../../../jobs/actions";
import { icons } from "../../../icons";

export type ShortlistRow = {
  candidateId: string;
  name: string;
  language: string;
  title: string | null;
  years: number | null;
  location: string | null;
  filteredOut: boolean;
  filterReason: string | null;
  score: number | null;
  confidence: string | null;
  reasons: string | null;
  mustHaveMet: string[];
  mustHaveMissing: string[];
  dealbreaker: string | null;
  missingFields: number;
  outsideEu: boolean;
  selected: boolean;
  overrideScore: number | null;
  overrideNote: string;
};

const SPEC_LISTS = [
  ["must_have", "Must have"],
  ["nice_to_have", "Nice to have"],
  ["dealbreakers", "Dealbreakers"],
  ["location", "Location"],
] as const;

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
// Shortlist review mockup (2026-10-09): rows instead of a table, selected rows tinted lime with a lime edge.
const muted = "text-stone-500";
const label = "mb-1.5 block font-mono text-xs tracking-[0.15em] uppercase text-stone-500";
const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base disabled:bg-stone-50";
const cols = "lg:grid-cols-[2.5rem_minmax(0,1.7fr)_minmax(0,1fr)_8rem_8.5rem]";

const scoreColor = (s: number | null) => (s == null ? "text-stone-400" : s >= 75 ? "text-olive" : s >= 40 ? "text-ink" : "text-rose-700");
// "Go (main language)" → "Go": the short skill name is enough in the Fit to check column.
const short = (skill: string) => skill.replace(/\s*\(.*\)\s*$/, "");
// The agent's reasons as one point per sentence (display only; the stored text is unchanged).
const sentences = (text: string | null) => (text ?? "").split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map((l) => l.trim()).filter(Boolean);

export function ShortlistEditor({
  jobId,
  rows: initialRows,
  spec,
  status,
}: {
  jobId: string;
  rows: ShortlistRow[];
  spec: JobSpecData;
  status: string;
}) {
  const router = useRouter();
  const canDecide = status === "awaiting_shortlist";
  const canEditSpec = status === "awaiting_shortlist" || status === "no_candidates";
  const [rows, setRows] = useState(initialRows);
  const [overrideText, setOverrideText] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialRows.map((r) => [r.candidateId, r.overrideScore != null ? String(r.overrideScore) : ""])),
  );
  const [result, setResult] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const [showFiltered, setShowFiltered] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Spec editing (the "reject" path).
  const [editing, setEditing] = useState(status === "no_candidates");
  const [title, setTitle] = useState(spec.title);
  const [seniority, setSeniority] = useState(spec.seniority ?? "");
  const [lists, setLists] = useState(() => Object.fromEntries(SPEC_LISTS.map(([k]) => [k, spec[k].join("\n")])) as Record<(typeof SPEC_LISTS)[number][0], string>);
  const [comment, setComment] = useState("");

  const update = (id: string, patch: Partial<ShortlistRow>) => setRows((rs) => rs.map((r) => (r.candidateId === id ? { ...r, ...patch } : r)));
  const selectedCount = rows.filter((r) => r.selected).length;
  const scored = rows.filter((r) => !r.filteredOut);
  const filtered = rows.filter((r) => r.filteredOut);

  function approve() {
    setResult(null);
    const decisions = rows.map((r) => {
      const text = overrideText[r.candidateId]?.trim() ?? "";
      return { candidateId: r.candidateId, selected: r.selected, overrideScore: text === "" ? null : Number(text), overrideNote: r.overrideNote };
    });
    startTransition(async () => {
      const r = await approveShortlistAction(jobId, decisions);
      setResult(r);
      if (r?.ok) router.push(`/jobs/${jobId}`);
    });
  }

  function saveSpec() {
    setResult(null);
    const edited: JobSpecData = {
      ...spec,
      title: title.trim(),
      seniority: (seniority || null) as JobSpecData["seniority"],
      must_have: lines(lists.must_have),
      nice_to_have: lines(lists.nice_to_have),
      dealbreakers: lines(lists.dealbreakers),
      location: lines(lists.location),
    };
    startTransition(async () => {
      const r = await editSpecAndResourceAction(jobId, edited, comment);
      setResult(r);
      if (r?.ok) router.push("/jobs");
    });
  }


  const renderRow = (r: ShortlistRow) => {
    const override = overrideText[r.candidateId] ?? "";
    return (
      <li
        key={r.candidateId}
        className={`grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-3 border-l-4 px-4 py-4 sm:px-5 lg:items-start lg:gap-x-5 ${cols} ${r.selected ? "border-olive-line bg-tint" : "border-transparent"}`}
      >
        <input
          type="checkbox"
          checked={r.selected}
          disabled={!canDecide}
          onChange={(e) => update(r.candidateId, { selected: e.target.checked })}
          className="mt-1 size-5 accent-olive"
          aria-label={`Shortlist ${r.name}`}
        />
        <div className="min-w-0">
          <div className="text-lg font-medium">{r.name}</div>
          <div className={`text-base ${muted}`}>
            {r.title ?? "title unknown"} · {r.years ?? "?"}y · {r.location ?? "location unknown"}
            {r.language !== "en" && <span className="ml-2 rounded bg-stone-100 px-1.5 text-sm">{r.language.toUpperCase()} profile</span>}
          </div>
          <button
            type="button"
            onClick={() => setOpen((o) => ({ ...o, [r.candidateId]: !o[r.candidateId] }))}
            aria-expanded={!!open[r.candidateId]}
            className="mt-1.5 flex items-center gap-1.5 text-base text-stone-600 hover:text-ink"
          >
            <span className={`text-xs transition-transform ${open[r.candidateId] ? "rotate-90" : ""}`}>▶</span>
            {r.filteredOut ? "Why filtered" : "Screening reasons"}
          </button>
        </div>
        {/* Phones: the three columns sit under the name, indented past the checkbox. */}
        <div className="col-start-2 space-y-0.5 text-base lg:col-start-auto lg:pt-1">
          {r.dealbreaker && <div className="text-rose-700">Dealbreaker: {r.dealbreaker}</div>}
          {r.mustHaveMissing.length > 0 && <div className="text-amber-800">Not evidenced: {r.mustHaveMissing.map(short).join(", ")}</div>}
          {r.outsideEu && <div className={muted}>Outside EU</div>}
          {!r.dealbreaker && !r.mustHaveMissing.length && !r.outsideEu && <div className={muted}>{r.filteredOut ? "Not scored" : "All must-haves found"}</div>}
        </div>
        <div className="col-start-2 flex items-baseline gap-3 lg:col-start-auto lg:block">
          <div className={`text-3xl leading-none tabular-nums ${scoreColor(r.score)}`}>{r.filteredOut ? "–" : r.score}</div>
          {r.confidence && <div className={`text-sm lg:mt-1.5 ${r.confidence === "low" ? "text-amber-700" : muted}`}>{r.confidence[0].toUpperCase() + r.confidence.slice(1)} confidence</div>}
        </div>
        <div className="col-start-2 lg:col-start-auto">
          <input
            inputMode="numeric"
            placeholder="—"
            disabled={!canDecide}
            value={override}
            onChange={(e) => setOverrideText((o) => ({ ...o, [r.candidateId]: e.target.value.replace(/[^\d]/g, "").slice(0, 3) }))}
            className={`${input} max-w-28 lg:max-w-none`}
            aria-label={`Your score for ${r.name}`}
          />
          {override !== "" && (
            <input
              placeholder="Why? (required)"
              disabled={!canDecide}
              value={r.overrideNote}
              onChange={(e) => update(r.candidateId, { overrideNote: e.target.value })}
              className={`${input} mt-2 text-sm`}
            />
          )}
        </div>
        {open[r.candidateId] && <Reasons r={r} />}
      </li>
    );
  };

  return (
    <div className="mt-8">
      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-lg">
              {scored.length === 1 ? "1 candidate" : `${scored.length} candidates`}
              <span className={`text-base ${muted}`}> · {filtered.length} filtered before scoring</span>
            </div>
            <span className="rounded-lg bg-brand px-3 py-1 text-base tabular-nums">{selectedCount} selected</span>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-stone-300 bg-white">
            <div className={`hidden border-b border-stone-200 bg-panel px-5 py-3 text-sm ${muted} lg:grid lg:gap-x-5 ${cols} border-l-4 border-l-transparent`}>
              <span />
              <span>Candidate</span>
              <span>Fit to check</span>
              <span>Agent score</span>
              <span>Your score</span>
            </div>
            <ul className="divide-y divide-stone-200">
              {scored.map((r) => renderRow(r))}
              {filtered.length > 0 && (
                <li className="bg-panel px-5 py-3">
                  <button type="button" onClick={() => setShowFiltered((v) => !v)} className={`text-base ${muted} hover:text-ink`}>
                    {showFiltered ? "▾" : "▸"} {filtered.length} filtered out before scoring (no must-have skill found; not sent to the AI)
                  </button>
                </li>
              )}
              {showFiltered && filtered.map((r) => renderRow(r))}
            </ul>
          </div>
        </>
      )}

      {canDecide && (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-x-6 gap-y-4">
          <div className="flex flex-wrap items-center justify-end gap-3">
            {result && <span className={`max-w-md text-base ${result.ok ? "text-emerald-700" : "text-rose-700"}`}>{result.message}</span>}
            <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-base hover:bg-stone-100">
              Edit spec &amp; re-source
            </button>
            <button
              type="button"
              onClick={approve}
              disabled={pending || selectedCount === 0}
              className="inline-flex items-center gap-5 rounded-xl bg-brand px-5 py-2.5 text-base font-semibold hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed disabled:text-ink/40"
            >
              {pending ? "Saving…" : `Approve shortlist (${selectedCount})`} {icons.arrowUpRight}
            </button>
          </div>
        </div>
      )}

      {canEditSpec && editing && (
        <div className="mt-6 rounded-xl border border-stone-300 bg-white px-5 py-6 sm:px-7">
          <h2 className="text-2xl">Edit the spec and re-run sourcing</h2>
          <p className={`mt-2 max-w-4xl text-base leading-relaxed ${muted}`}>
            Changes the approved spec directly (the job spec agent does not re-run). Sourcing then adds new candidates, skipping people already in
            the pipeline, and everyone is re-screened against the edited spec (current scores are kept as history).
          </p>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div>
              <label className={label}>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Seniority</label>
              <select value={seniority} onChange={(e) => setSeniority(e.target.value)} className={input}>
                <option value="">unclear</option>
                {SENIORITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            {SPEC_LISTS.map(([k, name]) => (
              <div key={k}>
                <label className={label}>{name} (one per line)</label>
                <textarea rows={4} value={lists[k]} onChange={(e) => setLists((l) => ({ ...l, [k]: e.target.value }))} className={input} />
              </div>
            ))}
            <div className="md:col-span-2">
              <label className={label}>Why (optional, kept with the decision)</label>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Client says Kafka is a must after all" className={input} />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {result && !canDecide && <span className={`text-base ${result.ok ? "text-emerald-700" : "text-rose-700"}`}>{result.message}</span>}
            <button type="button" onClick={saveSpec} disabled={pending} className="inline-flex items-center gap-5 rounded-xl bg-brand px-5 py-2.5 text-base font-semibold hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed disabled:text-ink/40">
              {pending ? "Saving…" : "Save spec and re-run sourcing"} {icons.arrowUpRight}
            </button>
          </div>
        </div>
      )}

      {!canDecide && !canEditSpec && <p className={`mt-5 text-base ${muted}`}>This shortlist was already decided. Ticked candidates were shortlisted.</p>}
    </div>
  );
}

// Opened "Screening reasons": must-haves found / not evidenced and any dealbreaker on the left, the agent's
// reasons as bullets on the right. Spans the row under the name, score and inputs.
function Reasons({ r }: { r: ShortlistRow }) {
  const heading = "font-mono text-xs tracking-[0.2em] uppercase text-stone-500";
  const points = sentences(r.filteredOut ? r.filterReason : r.reasons);
  const hasSkills = r.mustHaveMet.length + r.mustHaveMissing.length > 0 || r.dealbreaker;
  return (
    <div className={`col-start-2 grid gap-x-8 gap-y-4 rounded-lg bg-page px-4 py-4 text-base lg:col-span-4 ${hasSkills ? "md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]" : ""}`}>
      {hasSkills && (
        <div>
          <div className={heading}>Must-haves</div>
          <ul className="mt-2 space-y-1.5">
            {r.mustHaveMet.map((m) => (
              <li key={m} className="flex gap-2 leading-snug">
                <span className="font-semibold text-olive" aria-label="found">✓</span>
                {m}
              </li>
            ))}
            {r.mustHaveMissing.map((m) => (
              <li key={m} className="flex gap-2 leading-snug text-amber-800">
                <span className="font-semibold" aria-label="not evidenced">✗</span>
                <span>
                  {m} <span className="text-sm text-stone-500">· not evidenced</span>
                </span>
              </li>
            ))}
          </ul>
          {r.dealbreaker && <div className="mt-3 rounded-md bg-rose-50 px-2.5 py-1.5 text-rose-800">Dealbreaker: {r.dealbreaker}</div>}
        </div>
      )}
      <div>
        <div className={heading}>{r.filteredOut ? "Why filtered" : "Why this score"}</div>
        <ul className="mt-2 max-w-3xl space-y-1.5">
          {points.map((l, i) => (
            <li key={i} className="flex gap-3 leading-snug text-stone-700">
              <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-olive-mid" />
              {l}
            </li>
          ))}
        </ul>
        {r.missingFields > 0 && <p className="mt-3 text-sm text-stone-500">{r.missingFields} profile field(s) missing</p>}
      </div>
    </div>
  );
}
