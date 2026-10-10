"use client";

import { useActionState } from "react";
import { runConnectionTestAction, type TestRunState } from "./actions";

export function ConnectionTestButton() {
  const [state, action, pending] = useActionState<TestRunState>(runConnectionTestAction, null);
  return (
    <form action={action} className="flex flex-wrap-reverse items-center justify-end gap-3">
      <button disabled={pending} className="whitespace-nowrap rounded-xl border border-stone-300 px-5 py-2.5 text-base text-ink hover:bg-white disabled:opacity-40">
        {pending ? "Running…" : "Run connection test"}
      </button>
      {state && <span className={`text-sm ${state.ok ? "text-emerald-700" : "text-rose-700"}`}>{state.message}</span>}
    </form>
  );
}
