"use server";

import { approveInterviewTimes, type TimesDecision } from "@/agents/scheduling/workflow";
import { zonedToUtc } from "@/lib/timezones";
import { asState, type ActionState } from "../action-state";

// Interview-times screen (specs/08, since 2026-10-08): times typed in the candidate's time zone.
export async function approveTimesAction(interviewId: string, d: Omit<TimesDecision, "slots"> & { localSlots: string[]; tz: string }): Promise<ActionState> {
  return asState(async () => {
    let slots: string[];
    try {
      slots = d.localSlots.filter(Boolean).map((x) => zonedToUtc(x, d.tz).toISOString());
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    return approveInterviewTimes(interviewId, { subject: d.subject, body: d.body, slots });
  });
}
