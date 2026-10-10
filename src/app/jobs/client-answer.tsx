"use client";

import { useActionState } from "react";
import type { ActionState } from "../action-state";
import { btnLime, btnOutline, panel } from "./[id]/card-styles";
import { TabHead, Tag } from "./[id]/card-ui";
import { clientRejectsAction, requestInterviewAction, runSchedulingRemindersAction } from "./actions";

export type ClientHint = { suggestion: string | null; label: string | null; reason: string | null };

// The AI's suggestion under a real client reply (the account manager still decides).
export function HintLine({ hint }: { hint: ClientHint }) {
  return (
    <div className="rounded-r-lg border-l-4 border-olive-line bg-soft px-4 py-3 text-base text-stone-700">
      <span className="font-medium text-olive">AI hint: {hint.label}</span>
      {hint.reason ? <span className="text-stone-600"> · {hint.reason}</span> : null}
    </div>
  );
}

// Step 8 trigger: the client's answer to a sent submission, recorded once their reply arrives in Gmail (specs/13).
// `hint`: that reply's AI suggestion; null = no reply yet (nothing to record). The suggested answer is the lime button.
export function ClientAnswer({ submissionId, hint }: { submissionId: string; hint: ClientHint | null }) {
  const [state, run, pending] = useActionState<ActionState>(() => requestInterviewAction(submissionId), null);
  const [rejState, reject, rejecting] = useActionState<ActionState>(() => clientRejectsAction(submissionId), null);
  const shown = state ?? rejState;
  const rejectFirst = hint?.suggestion === "rejected";
  return (
    <div className={panel}>
      <TabHead
        tag={<Tag tone={hint ? "amber" : "grey"}>{hint ? "Client replied" : "Waiting for client"}</Tag>}
        text={hint ? "Record what the client said." : "No answer from the client yet. It arrives when you click Check replies."}
      />
      {hint && (
        <>
          {hint.label && (
            <div className="mt-4">
              <HintLine hint={hint} />
            </div>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 pt-4">
            {shown && <span className={`mr-auto max-w-md text-sm ${shown.ok ? "text-emerald-700" : "text-rose-700"}`}>{shown.message}</span>}
            <form action={reject}>
              <button disabled={pending || rejecting} className={rejectFirst ? btnLime : btnOutline}>
                {rejecting ? "Recording…" : "Client rejected"}
              </button>
            </form>
            <form action={run}>
              <button disabled={pending || rejecting} className={rejectFirst ? btnOutline : btnLime}>
                {pending ? "Finding times… (~10s)" : "Client wants interview"}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

// "Run reminders now" (no timers locally): reminders 24h before an interview, nudges after 48h without an answer.
export function RemindersButton({ jobId }: { jobId: string }) {
  const [state, run, pending] = useActionState<ActionState>(() => runSchedulingRemindersAction(jobId), null);
  return (
    <form action={run} className="flex items-center gap-3">
      {state && <span className={`max-w-md text-sm ${state.ok ? "text-emerald-700" : "text-rose-700"}`}>{state.message}</span>}
      <button disabled={pending} className="whitespace-nowrap rounded-xl border border-stone-300 px-5 py-2.5 text-base text-ink hover:bg-white disabled:opacity-40">
        {pending ? "Sending…" : "Run reminders now"}
      </button>
    </form>
  );
}
