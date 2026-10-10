"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "../action-state";
import { setConfirmedRateAction } from "../jobs/actions";

// Step 7 "Rate needed": the recruiter types the rate confirmed with the candidate (lime button, approval queue look).
export function RateForm({ jobId, candidateId, placeholder }: { jobId: string; candidateId: string; placeholder: string }) {
  const router = useRouter();
  const [rate, setRate] = useState("");
  const [result, setResult] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {result && <span className={`max-w-xs text-sm ${result.ok ? "text-green-700" : "text-red-700"}`}>{result.message}</span>}
      <input value={rate} onChange={(e) => setRate(e.target.value)} placeholder={placeholder} className="w-44 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-base text-ink" aria-label="Confirmed rate" />
      <button
        type="button"
        disabled={pending || !rate.trim()}
        onClick={() =>
          startTransition(async () => {
            setResult(await setConfirmedRateAction(jobId, candidateId, rate));
            router.refresh();
          })
        }
        className="whitespace-nowrap rounded-xl border border-brand bg-brand px-5 py-2.5 text-base font-semibold text-ink hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed disabled:text-ink/40"
      >
        {pending ? "Saving…" : "Save rate"}
      </button>
    </div>
  );
}
