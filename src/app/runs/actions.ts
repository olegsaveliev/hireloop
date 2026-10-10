"use server";

import { revalidatePath } from "next/cache";
import { runConnectionTest } from "@/agents/connection-test";

export type TestRunState = { message: string; ok: boolean } | null;

// Phase 0: a tiny Haiku run that proves Claude + Langfuse + agent_runs work together.
export async function runConnectionTestAction(): Promise<TestRunState> {
  try {
    const r = await runConnectionTest();
    revalidatePath("/runs");
    return r.status === "succeeded"
      ? { ok: true, message: `Claude replied: "${r.output}". Cost $${r.costUsd.toFixed(4)}. Trace sent to Langfuse.` }
      : { ok: false, message: `Run ${r.status}. See the row below for details.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
