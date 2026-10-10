"use client";

import { useActionState } from "react";
import type { ActionState } from "../action-state";
import { runFollowUpsAction } from "./actions";

// "Run follow-ups now" (no timers locally): drafts the follow-ups that are due (3 days after the last message).
export function FollowUpsButton({ jobId }: { jobId: string }) {
  const [state, run, pending] = useActionState<ActionState>(() => runFollowUpsAction(jobId), null);
  return (
    <form action={run} className="flex items-center gap-3">
      {state && <span className={`max-w-md text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
      <button disabled={pending} className="whitespace-nowrap rounded-xl border border-stone-300 px-5 py-2.5 text-base text-ink hover:bg-white disabled:opacity-40">
        {pending ? "Drafting follow-ups… (~20s)" : "Run follow-ups now"}
      </button>
    </form>
  );
}
