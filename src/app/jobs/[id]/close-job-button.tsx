"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CLOSE_REASONS, type CloseReason } from "@/config/feedback";
import type { ActionState } from "../../action-state";
import { closeJobAction } from "../actions";
import { field, panelLabel } from "./card-styles";

type Impact = { drafts: number; items: number; arranging: number; booked: number; submissions: number };

// Job page "Close position" (2026-10-10): pick why, add a note, see what gets cancelled, then close. Same dialog look
// as the app's confirm box. `suggested` = the reason picked first (e.g. no suitable candidates when nobody is left).
export function CloseJobButton({ jobId, title, impact, suggested }: { jobId: string; title: string; impact: Impact; suggested?: CloseReason }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CloseReason | "">(suggested ?? "");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const effects = [
    impact.drafts && `${plural(impact.drafts, "unsent draft is", "unsent drafts are")} cancelled`,
    impact.submissions && `${plural(impact.submissions, "submission isn't", "submissions aren't")} sent`,
    impact.arranging && `${plural(impact.arranging, "interview being arranged is", "interviews being arranged are")} cancelled`,
    impact.booked && `${plural(impact.booked, "booked interview is", "booked interviews are")} cancelled (Google emails the guests if there's a calendar event): tell the candidate and client yourself`,
    impact.items && `${plural(impact.items, "item leaves", "items leave")} the approval queue`,
  ].filter(Boolean) as string[];

  function close() {
    startTransition(async () => {
      const r = await closeJobAction(jobId, reason, note);
      setResult(r);
      if (r?.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => (setResult(null), setOpen(true))} className="whitespace-nowrap rounded-xl border border-stone-300 px-5 py-2.5 text-base text-ink hover:bg-white">
        Close position
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 text-ink">
            <div className="hl-dim absolute inset-0 bg-stone-900/30" onClick={() => setOpen(false)} />
            <div role="dialog" aria-modal="true" aria-labelledby="close-title" className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
              <h2 id="close-title" className="text-2xl leading-tight font-bold tracking-tight break-words">
                Close {title}?
              </h2>
              <p className="mt-2 text-base text-stone-500">Agents stop and nothing more goes out. Everything that happened stays. You can reopen it later.</p>

              <div className={`mt-6 ${panelLabel}`}>Why</div>
              <div role="radiogroup" aria-label="Why" className="mt-2 flex flex-wrap gap-2">
                {(Object.keys(CLOSE_REASONS) as CloseReason[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={reason === k}
                    onClick={() => setReason(k)}
                    className={`rounded-xl border px-4 py-2 text-base ${reason === k ? "border-ink bg-ink text-white" : "border-stone-300 text-stone-600 hover:bg-stone-50 hover:text-ink"}`}
                  >
                    {CLOSE_REASONS[k]}
                  </button>
                ))}
              </div>

              <label className="mt-5 block">
                <span className={panelLabel}>Note {reason === "other" ? "*" : "(optional)"}</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. the client froze hiring until Q1" className={`mt-1 ${field}`} />
              </label>

              {effects.length > 0 && (
                <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="font-semibold">When you close it</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {effects.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result && !result.ok && <p className="mt-4 text-sm text-rose-700">{result.message}</p>}
              <div className="mt-8 flex flex-wrap justify-end gap-3">
                <button type="button" autoFocus onClick={() => setOpen(false)} className="rounded-xl border border-stone-300 px-5 py-2.5 text-base hover:bg-stone-100">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending || !reason || (reason === "other" && !note.trim())}
                  onClick={close}
                  className="rounded-xl bg-ink px-5 py-2.5 text-base font-semibold text-white hover:bg-black disabled:opacity-40"
                >
                  {pending ? "Closing…" : "Close position"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
