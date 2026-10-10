"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "../action-state";
import { runWeeklyJobAction } from "./actions";

// "Run now" for the weekly job. The checkbox also runs every agent over its dataset (real model calls).
// big = the dark button in the lime banner.
export function WeeklyButton({ running, big = false }: { running: boolean; big?: boolean }) {
  const [evals, setEvals] = useState(false);
  const [state, run, pending] = useActionState<ActionState>(() => runWeeklyJobAction(evals), null);
  return (
    <form action={run} className={`flex flex-wrap items-center gap-3 ${big ? "flex-col items-start" : "justify-end"}`}>
      {state && <span className={`max-w-md text-sm ${state.ok ? "text-emerald-700" : "text-rose-700"}`}>{state.message}</span>}
      <label className={`flex items-center gap-2 text-sm ${big ? "order-last text-ink" : "text-stone-600"}`} title="Runs npm run eval for every agent: ~$0.50, a few minutes">
        <input type="checkbox" checked={evals} onChange={(e) => setEvals(e.target.checked)} className="size-4 accent-ink" />
        Also run every agent&apos;s dataset (~$0.50, a few minutes)
      </label>
      <button disabled={pending || running} className={
          big
            ? "whitespace-nowrap rounded-xl bg-ink px-7 py-4 text-lg font-semibold text-white hover:not-disabled:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            : "whitespace-nowrap rounded-xl border border-brand bg-brand px-5 py-2.5 text-base font-semibold text-ink hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed disabled:text-ink/40"
        }
      >
        {pending ? "Starting…" : running ? "Running…" : big ? "Run review" : "Run now"}
      </button>
    </form>
  );
}
