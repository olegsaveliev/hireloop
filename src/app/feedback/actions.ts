"use server";

import { after } from "next/server";
import { runWeeklyJob, startWeeklyReport } from "@/agents/feedback/weekly";
import { collectCorrections } from "@/agents/feedback/corrections";
import { asState, type ActionState } from "../action-state";

// "Run now" (Step 9 weekly job). The summary takes ~30s and the datasets a few minutes, so it runs after the response;
// the Feedback page refreshes while the report is "running". Hosted version: a Trigger.dev schedule.
export async function runWeeklyJobAction(runEvals: boolean): Promise<ActionState> {
  return asState(async () => {
    const started = await startWeeklyReport();
    if (!started.ok) return started;
    after(async () => {
      try {
        const r = await runWeeklyJob(started.reportId, { runEvals });
        console.log(`[weekly job] ${r.message}`);
      } catch (e) {
        console.error("[weekly job] failed:", e);
      }
    });
    return { ok: true, message: runEvals ? "Started: corrections, datasets (a few minutes), then the summary." : "Started: corrections, then the summary (~30s)." };
  });
}

// "Collect corrections now": the no-AI part of the weekly job on its own.
export async function collectCorrectionsAction(): Promise<ActionState> {
  return asState(async () => {
    const r = await collectCorrections();
    return { ok: !r.syncError, message: `${r.added} new correction(s); ${r.synced} pushed to Langfuse.${r.syncError ? ` Langfuse error: ${r.syncError}` : ""}` };
  });
}
