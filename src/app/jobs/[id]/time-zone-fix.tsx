"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "../../action-state";
import { Dropdown } from "../../dropdown";
import { setCandidateTimeZoneAction } from "../actions";
import { btnLime, field, panelLabel } from "./card-styles";

// Interview tab, when scheduling stopped because the candidate's time zone couldn't be read from their location:
// pick it here and the times are found again (2026-10-10). Options: [zone, label] from the server.
// guess = the zone read from the location now (more places are known than when scheduling stopped), pre-picked.
export function TimeZoneFix({ interviewId, location, guess, options }: { interviewId: string; location: string | null; guess: string | null; options: [string, string][] }) {
  const [tz, setTz] = useState(guess ?? "");
  const [state, run, pending] = useActionState<ActionState>(() => setCandidateTimeZoneAction(interviewId, tz), null);
  return (
    <form action={run} className="mt-5">
      <label className={panelLabel} htmlFor={`tz-${interviewId}`}>
        Candidate&apos;s time zone
      </label>
      <p className="mt-1 text-sm text-stone-500">
        {guess
          ? `From “${location}” it looks like this one. Check it and save.`
          : location
            ? `Their profile says “${location}”, which doesn't tell the time zone. Pick it, or ask them.`
            : "Their profile has no location. Pick it, or ask them."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Dropdown
          id={`tz-${interviewId}`}
          size="lg"
          placeholder="Choose a time zone"
          value={tz}
          onChange={setTz}
          options={options.map(([value, label]) => ({ value, label }))}
          className="min-w-0 flex-[1_1_280px]"
          buttonClassName={field}
        />
        <button disabled={pending || !tz} className={btnLime}>
          {pending ? "Finding times… (~10s)" : "Save and find times"}
        </button>
      </div>
      {state && <p className={`mt-2 text-sm ${state.ok ? "text-emerald-700" : "text-rose-700"}`}>{state.message}</p>}
    </form>
  );
}
