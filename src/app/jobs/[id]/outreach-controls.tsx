"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { INTENTS, type Intent } from "@/agents/outreach/schema";
import type { ActionState } from "../../action-state";
import { reviewClassificationAction } from "../actions";

const Result = ({ r }: { r: ActionState }) => (r ? <span className={`text-sm ${r.ok ? "text-emerald-700" : "text-rose-700"}`}>{r.message}</span> : null);

// Recruiter checks the classifier: Correct, or Wrong + the right intent (stage/follow-ups follow it).
export function ClassificationReview({ messageId, intent, reviewed }: { messageId: string; intent: string; reviewed: boolean | null }) {
  const router = useRouter();
  const [wrong, setWrong] = useState(false);
  const [choice, setChoice] = useState<Intent | "">("");
  const [result, setResult] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const run = (correct: boolean, i?: Intent) =>
    startTransition(async () => {
      setResult(await reviewClassificationAction(messageId, correct, i));
      setWrong(false);
      router.refresh();
    });
  if (reviewed !== null && !result) return <span className="text-sm text-stone-500">{reviewed ? "✓ you marked this correct" : "✎ corrected by you"}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      {result ? (
        <Result r={result} />
      ) : wrong ? (
        <>
          <select value={choice} onChange={(e) => setChoice(e.target.value as Intent)} className="rounded-lg border border-stone-300 bg-white px-2 py-1">
            <option value="">right intent…</option>
            {INTENTS.filter((i) => i !== intent).map((i) => (
              <option key={i} value={i}>{i.replaceAll("_", " ")}</option>
            ))}
          </select>
          <button type="button" disabled={pending || !choice} onClick={() => run(false, choice as Intent)} className="rounded-lg bg-ink px-3 py-1 text-white disabled:opacity-40">
            Save
          </button>
        </>
      ) : (
        <>
          <span className="text-stone-500">Right?</span>
          <button type="button" disabled={pending} onClick={() => run(true)} className="rounded-lg border border-stone-300 bg-white px-3 py-1 hover:bg-stone-100">
            Correct
          </button>
          <button type="button" disabled={pending} onClick={() => setWrong(true)} className="rounded-lg border border-stone-300 bg-white px-3 py-1 hover:bg-stone-100">
            Wrong
          </button>
        </>
      )}
    </span>
  );
}
