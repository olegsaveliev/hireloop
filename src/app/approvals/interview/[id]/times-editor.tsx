"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cityOf, slotLine, withinWorkingHours, zonedToUtc } from "@/lib/timezones";
import type { ActionState } from "../../../action-state";
import { icons } from "../../../icons";
import { approveTimesAction } from "../../interview-actions";

const MARKER = "{{slots}}";
const label = "font-mono text-xs tracking-[0.2em] uppercase text-stone-500";
const field = "w-full rounded-lg border border-stone-300 bg-field px-3.5 py-2 text-base focus:border-stone-500 focus:outline-none";

// Pick the interview times (typed in the candidate's time zone, shown in both), optionally edit the email, send.
// The email is folded: most of the time only the times need a look.
export function TimesEditor(props: {
  now: number;
  interviewId: string;
  jobId: string;
  candidateName: string;
  candidateTz: string;
  clientTz: string;
  subject: string;
  body: string;
  slots: string[];
  calendarChecked: boolean;
}) {
  const router = useRouter();
  const [slots, setSlots] = useState(props.slots);
  const [subject, setSubject] = useState(props.subject);
  const [body, setBody] = useState(props.body);
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();

  const check = (local: string) => {
    if (!local) return null;
    try {
      const d = zonedToUtc(local, props.candidateTz);
      const ok = withinWorkingHours(d, props.candidateTz) && withinWorkingHours(d, props.clientTz) && d.getTime() > props.now;
      // "Mon 12 Oct, 09:00-10:00 Warsaw time (UTC+2) = 09:00-10:00 Berlin time (UTC+2)" -> main line + client side.
      const [main, other] = slotLine(d, props.candidateTz, props.clientTz).split(" = ");
      return { main, other: other ?? null, ok };
    } catch {
      return null;
    }
  };
  const markerOk = body.split(MARKER).length === 2;
  const anyBad = slots.some((s) => s && !check(s)?.ok) || !slots.some(Boolean) || !markerOk;
  const firstName = props.candidateName.split(" ")[0];

  return (
    <>
      <div className="px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={label}>Times to offer · 60 min</span>
          <span className="text-sm text-stone-500">
            In {cityOf(props.candidateTz)} time ({firstName}){cityOf(props.candidateTz) !== cityOf(props.clientTz) ? `, with ${cityOf(props.clientTz)} time for the client` : ""}
          </span>
        </div>
        <ol className="mt-3 space-y-2">
          {slots.map((s, i) => {
            const c = check(s);
            return (
              <li key={i} className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5 ${c && !c.ok ? "border-rose-200 bg-rose-50" : "border-stone-200 bg-field"}`}>
                <span className="rounded-md bg-soft px-2 py-0.5 font-mono text-xs text-olive">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-[1_1_220px]">
                  {c ? (
                    <>
                      <div className="text-base font-medium">{c.main}</div>
                      {c.other && <div className="text-sm text-stone-500">Client: {c.other}</div>}
                      {!c.ok && <div className="text-sm text-rose-700">Outside 09:00-19:00 on a weekday for one side, or in the past</div>}
                    </>
                  ) : (
                    <div className="text-sm text-stone-500">Pick a date and time</div>
                  )}
                </div>
                <input
                  type="datetime-local"
                  step={900}
                  value={s}
                  aria-label={`Time ${i + 1}`}
                  onChange={(e) => setSlots((x) => x.map((v, j) => (j === i ? e.target.value : v)))}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setSlots((x) => x.filter((_, j) => j !== i))}
                  disabled={slots.length === 1}
                  aria-label={`Remove time ${i + 1}`}
                  title="Remove"
                  className="grid size-8 place-items-center rounded-lg text-stone-400 hover:bg-stone-200 hover:text-ink disabled:opacity-30"
                >
                  {icons.x}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {slots.length < 5 ? (
            <button type="button" onClick={() => setSlots((x) => [...x, x.at(-1) ?? ""])} className="text-sm text-olive hover:underline">
              + Add a time
            </button>
          ) : (
            <span />
          )}
          <span className={`text-xs ${props.calendarChecked ? "text-stone-500" : "text-amber-800"}`}>
            {props.calendarChecked
              ? "Suggested times avoid your busy hours in Google Calendar; times you change aren't checked."
              : "Your Google Calendar wasn't checked (connect again on the Briefs page): check you're free yourself."}
          </span>
        </div>
      </div>

      <details className="group border-t border-stone-200">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 font-medium">
            <span className="text-[10px] transition-transform group-open:rotate-90">▶</span>
            Email to {firstName}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-stone-500 group-open:hidden">{subject}</span>
        </summary>
        <div className="space-y-3 px-5 pb-5 sm:px-6">
          <label className="block">
            <span className="mb-1 block text-sm text-stone-600">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 flex flex-wrap justify-between gap-2 text-sm text-stone-600">
              Message
              <span className="text-xs text-stone-500">{MARKER} = where the numbered times go · signature and opt-out line are added</span>
            </span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className={`${field} leading-relaxed`} />
          </label>
        </div>
      </details>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-200 bg-field px-5 py-3 sm:px-6">
        <span className="text-sm">
          {state ? (
            <span className={state.ok ? "text-emerald-700" : "text-rose-700"}>{state.message}</span>
          ) : !markerOk ? (
            <span className="text-rose-700">Keep {MARKER} exactly once in the email.</span>
          ) : (
            <span className="text-stone-500">{firstName} picks one by replying with its number.</span>
          )}
        </span>
        <button
          disabled={pending || anyBad}
          onClick={() =>
            start(async () => {
              const r = await approveTimesAction(props.interviewId, { subject, body, localSlots: slots, tz: props.candidateTz });
              setState(r);
              if (r?.ok) router.push(`/jobs/${props.jobId}`);
            })
          }
          className="inline-flex items-center gap-3 rounded-lg bg-brand px-4 py-2 text-base font-semibold hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed disabled:text-ink/40"
        >
          {pending ? "Sending…" : `Approve and send ${slots.length} time${slots.length === 1 ? "" : "s"}`} {icons.arrowUpRight}
        </button>
      </footer>
    </>
  );
}
