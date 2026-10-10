"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "../../action-state";
import { OUTCOMES, type OutcomeKind } from "@/config/feedback";
import { recordOutcomeAction } from "../actions";
import { btnLime, btnOutline, field, panel, panelLabel, type Tone } from "./card-styles";
import { Actions, TabHead, Tag } from "./card-ui";

type Existing = { outcome: string; reason: string; scoredCount: number } | null;

// Step 9 on the Job page: the candidate's final outcome + reason. Shown once a candidate replied; recorded again it
// replaces the old one. The reason is checked for protected attributes in code (src/config/feedback.ts).
export function OutcomeForm({ jobId, candidateId, options, existing }: { jobId: string; candidateId: string; options: OutcomeKind[]; existing: Existing }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeKind>((existing?.outcome as OutcomeKind) ?? options[0]);
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [state, run, pending] = useActionState<ActionState>(async () => {
    const r = await recordOutcomeAction(jobId, candidateId, outcome, reason);
    if (r?.ok) setOpen(false);
    return r;
  }, null);

  const label = existing ? (OUTCOMES[existing.outcome as OutcomeKind]?.label ?? existing.outcome) : null;
  const tone: Tone = existing?.outcome === "hired" ? "solid" : existing?.outcome === "rejected_by_client" ? "rose" : "grey";
  return (
    <div className={panel}>
      {existing ? (
        <TabHead tag={<Tag tone={tone}>{label}</Tag>} text={<>“{existing.reason}”</>} />
      ) : (
        <TabHead tag={<Tag tone="grey">Not recorded</Tag>} text="Record how it ended: it teaches the agents (Feedback page)." />
      )}
      {open ? (
        <form action={run} className="mt-5 space-y-4">
          <div role="radiogroup" aria-label="Outcome" className="flex flex-wrap gap-2">
            {options.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={outcome === o}
                onClick={() => setOutcome(o)}
                className={`rounded-xl border px-4 py-2 text-base ${outcome === o ? "border-ink bg-ink text-white" : "border-stone-300 text-stone-600 hover:bg-white hover:text-ink"}`}
              >
                {OUTCOMES[o].label}
              </button>
            ))}
          </div>
          <label className="block">
            <span className={panelLabel}>Reason</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="About the job only, e.g. “accepted another offer”, “system design round was weak”."
              className={`mt-1 ${field}`}
            />
            <span className="mt-1 block text-sm text-stone-500">No age, family, health, religion, nationality or gender.</span>
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 pt-4">
            {state && !state.ok && <span className="mr-auto max-w-xl text-sm text-rose-700">{state.message}</span>}
            <button type="button" onClick={() => setOpen(false)} className={btnOutline}>
              Cancel
            </button>
            <button disabled={pending} className={btnLime}>
              {pending ? "Recording…" : "Record outcome"}
            </button>
          </div>
        </form>
      ) : (
        <Actions note={state?.ok ? <span className="text-emerald-700">{state.message}</span> : undefined}>
          <button onClick={() => setOpen(true)} className={btnOutline}>
            {existing ? "Change outcome" : "Record outcome…"}
          </button>
        </Actions>
      )}
    </div>
  );
}
