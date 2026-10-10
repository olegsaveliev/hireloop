"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SubmissionFields } from "@/agents/submission/schema";
import type { ActionState } from "../../../action-state";
import { icons } from "../../../icons";
import { approveSubmissionAction, rejectSubmissionAction, withdrawSubmissionAction } from "../../../jobs/actions";

const input =
  "w-full rounded-lg border border-stone-300 bg-field px-3.5 py-2 text-base focus:border-stone-500 focus:outline-none disabled:bg-stone-50 disabled:text-stone-600";
const muted = "text-stone-500";
const LABELS: Record<keyof SubmissionFields, string> = {
  headline: "Headline",
  summary: "Summary",
  key_skills: "Key skills (comma-separated)",
  experience_highlights: "Experience highlights (one per line)",
  rate: "Rate",
  availability: "Availability",
};
// The profile's fields in numbered sections, as in the mockup. Fields the format leaves out are skipped.
const SECTIONS: { title: string; fields: (keyof SubmissionFields)[]; pair?: boolean }[] = [
  { title: "Introduction", fields: ["headline", "summary"] },
  { title: "Skills & experience", fields: ["key_skills", "experience_highlights"] },
  { title: "Rate & availability", fields: ["rate", "availability"], pair: true },
];
const label = "font-mono text-xs tracking-[0.2em] uppercase text-stone-500";

// Step 7 approval (account manager): the client-facing profile, every field editable, in three numbered sections;
// approve sends it to the client. The source data ("Internal reference") is on the page next to it.
export function SubmissionEditor({
  submissionId,
  fields,
  initial,
  sources,
  editable,
  toEmail,
}: {
  submissionId: string;
  fields: (keyof SubmissionFields)[]; // the client's template fields, in order
  initial: SubmissionFields;
  sources: string[]; // quote behind each experience highlight (agent's version)
  editable: boolean;
  toEmail: string | null; // null = the client has no email yet: sending is switched off
}) {
  const router = useRouter();
  const [f, setF] = useState(() => ({
    ...initial,
    key_skills: initial.key_skills.join(", "),
    experience_highlights: initial.experience_highlights.join("\n"),
  }));
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [result, setResult] = useState<ActionState>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const asFields = (): SubmissionFields => ({
    ...f,
    key_skills: f.key_skills.split(",").map((x) => x.trim()).filter(Boolean),
    experience_highlights: f.experience_highlights.split("\n").map((x) => x.trim()).filter(Boolean),
  });
  const edited = JSON.stringify(asFields()) !== JSON.stringify(initial);
  const run = (key: string, fn: () => Promise<ActionState>) => {
    setResult(null);
    setBusy(key);
    startTransition(async () => {
      const r = await fn();
      setResult(r);
      setBusy(null);
      if (r?.ok) setRejecting(null);
      router.refresh();
    });
  };

  const field = (k: keyof SubmissionFields) => (
    <label key={k} className="block min-w-0">
      <span className="mb-1 block text-sm text-stone-600">{LABELS[k]}</span>
      {k === "headline" || k === "summary" || k === "experience_highlights" ? (
        <textarea
          rows={
            k === "headline"
              ? 2
              : k === "summary"
                ? Math.max(3, Math.ceil(f.summary.length / 80) + 1)
                : Math.max(3, f.experience_highlights.split("\n").length + 1)
          }
          value={f[k]}
          disabled={!editable}
          onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
          className={`${input} leading-relaxed`}
        />
      ) : (
        <input value={f[k]} disabled={!editable} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} className={input} />
      )}
      {k === "experience_highlights" && sources.length > 0 && (
        <details className="group mt-1.5 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-olive [&::-webkit-details-marker]:hidden">
            <span className="text-[10px] transition-transform group-open:rotate-90">▶</span>
            Where each highlight comes from (agent&apos;s quotes from the source data)
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-stone-600">
            {initial.experience_highlights.map((h, i) => (
              <li key={i}>
                {h} <span className="text-stone-400">← “{sources[i]}”</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </label>
  );
  const sections = SECTIONS.map((sec) => ({ ...sec, fields: sec.fields.filter((k) => fields.includes(k)) })).filter((sec) => sec.fields.length > 0);

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-stone-300 bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 px-5 py-3.5 sm:px-6">
        <h2 className="text-xl tracking-tight">Client-facing profile</h2>
        <span className={label}>{editable ? "Editable draft" : "Read only"}</span>
      </header>
      <div className="space-y-6 px-5 py-5 sm:px-6">
        {sections.map((sec, i) => (
          <div key={sec.title}>
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-soft px-2 py-0.5 font-mono text-xs text-olive">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-base">{sec.title}</span>
            </div>
            <div className={`mt-3 gap-4 ${sec.pair ? "grid sm:grid-cols-2" : "space-y-3"}`}>{sec.fields.map(field)}</div>
          </div>
        ))}
      </div>

      {editable ? (
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-200 bg-field px-5 py-3 sm:px-6">
          {rejecting !== null ? (
            <>
              <input
                autoFocus
                value={rejecting}
                onChange={(e) => setRejecting(e.target.value)}
                placeholder="What should change? e.g. shorter summary, lead with AWS"
                className="min-w-0 flex-1 basis-72 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              />
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setRejecting(null)} className={`px-2 text-sm ${muted} hover:text-ink`}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending || !rejecting.trim()}
                  onClick={() => run("reject", () => rejectSubmissionAction(submissionId, rejecting))}
                  className="rounded-lg bg-ink px-4 py-2 text-base text-white hover:bg-black disabled:opacity-40"
                >
                  {busy === "reject" ? "Rewriting… (~25s)" : "Reject and redraft"}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-sm">
                {result ? (
                  <span className={result.ok ? "text-emerald-700" : "text-rose-700"}>{result.message}</span>
                ) : edited ? (
                  <span className="text-olive">edited</span>
                ) : (
                  <span className={toEmail ? muted : "text-rose-700"}>{toEmail ? `Approve sends it to ${toEmail}.` : "No client email yet: add one on the Clients page to send."}</span>
                )}
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run("withdraw", () => withdrawSubmissionAction(submissionId))}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-base hover:bg-stone-100 disabled:opacity-40"
                >
                  {busy === "withdraw" ? "Saving…" : "Don't submit"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setRejecting("")}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-base hover:bg-stone-100 disabled:opacity-40"
                >
                  Reject…
                </button>
                <button
                  type="button"
                  disabled={pending || !toEmail}
                  title={toEmail ? undefined : "Add the client's email on the Clients page first"}
                  onClick={() => run("approve", () => approveSubmissionAction(submissionId, asFields()))}
                  className="inline-flex items-center gap-3 rounded-lg bg-brand px-4 py-2 text-base font-semibold hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed disabled:text-ink/40"
                >
                  {busy === "approve" ? "Sending…" : "Approve and send to client"} {icons.arrowUpRight}
                </button>
              </div>
            </>
          )}
        </footer>
      ) : (
        result && <div className={`border-t border-stone-200 px-5 py-3 text-sm sm:px-6 ${result.ok ? "text-emerald-700" : "text-rose-700"}`}>{result.message}</div>
      )}
    </section>
  );
}
