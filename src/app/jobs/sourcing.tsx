import { db } from "@/lib/db";

// The sourcing agent's last run for one job, shared by the Jobs card and the Shortlist review page:
// headlines (jobs.sourcingSummary), query and duplicate counts, and the pipeline note as a list of points.
const muted = "text-stone-500";
const LOW_SCORES = "Everyone scored under 40";

type SourcingSummary = { highlights?: { title: string; text: string }[]; queries?: string[]; duplicates?: number };
export type SourcingInfo = Awaited<ReturnType<typeof sourcingInfo>>;

// The sourcing note as a list: one point per sentence, candidate ids ("cand-009") replaced by names, the
// "Search broadened once:" prefix turned into a flag, and the app's closing count sentence dropped
// (the counts are already in the details header).
function noteLines(note: string, names: Map<string, string>) {
  const broadened = /^Search broadened once\b/.test(note);
  const text = note
    .replace(/^Search broadened once[:.]?\s*/, "")
    .replace(/Sourcing added \d+ candidate\(s\) \(\d+ queries; \d+ duplicate\(s\) skipped\)\.\s*/, "")
    .replace(/cand-\d+/g, (id) => names.get(id) ?? id);
  const lines = text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((l) => l.trim())
    .filter(Boolean);
  return { broadened, lines };
}

export async function sourcingInfo(job: { pipelineNote: string | null; sourcingSummary: unknown }) {
  // Jobs sourced before the headlines existed only have the note: its last sentence still gives the counts.
  const summary = (job.sourcingSummary ?? {}) as SourcingSummary;
  const counted = job.pipelineNote?.match(/\((\d+) queries; (\d+) duplicate/);
  const highlights = [...(summary.highlights ?? [])];
  if (job.pipelineNote?.includes(LOW_SCORES)) highlights.push({ title: "Low scores", text: "Everyone scored under 40: the spec may be too strict." });
  const ids = [...new Set(job.pipelineNote?.match(/cand-\d+/g) ?? [])];
  const people = ids.length ? await db.candidate.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const notes = noteLines(job.pipelineNote ?? "", new Map(people.map((c) => [c.id, c.fullName])));
  return {
    highlights,
    queries: summary.queries ?? [],
    queryCount: summary.queries?.length ?? (counted ? Number(counted[1]) : null),
    duplicates: summary.duplicates ?? (counted ? Number(counted[2]) : null),
    broadened: notes.broadened,
    notes: notes.lines,
    hasDetails: !!(job.pipelineNote || summary.queries?.length),
  };
}

export function countsLine(s: SourcingInfo) {
  if (s.queryCount === null) return null;
  return `${s.queryCount === 1 ? "1 query" : `${s.queryCount} queries`} · ${s.duplicates === 1 ? "1 duplicate" : `${s.duplicates} duplicates`} skipped`;
}

// Inside "Sourcing details": the broadened flag, the queries as chips, the agent's notes as bullets.
export function SourcingDetailsBody({ s, showBroadened = true }: { s: SourcingInfo; showBroadened?: boolean }) {
  return (
    <div className="space-y-4 text-base">
      {showBroadened && s.broadened && <span className="inline-block rounded-md bg-soft px-2.5 py-0.5 text-sm text-olive">Search broadened once</span>}
      {s.queries.length > 0 && (
        <div>
          <div className={`font-mono text-xs tracking-[0.2em] uppercase ${muted}`}>Queries</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {s.queries.map((q, i) => (
              <span key={i} className="rounded-md bg-stone-100 px-2.5 py-0.5 font-mono text-sm">
                {q}
              </span>
            ))}
          </div>
        </div>
      )}
      {s.notes.length > 0 && (
        <div>
          <div className={`font-mono text-xs tracking-[0.2em] uppercase ${muted}`}>Agent notes</div>
          <ul className="mt-2 max-w-4xl space-y-1.5">
            {s.notes.map((l, i) => (
              <li key={i} className="flex gap-3 leading-snug text-stone-600">
                <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-olive-mid" />
                {l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
