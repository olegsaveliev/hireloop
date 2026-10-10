import { revalidatePath } from "next/cache";
import type { WorkflowResult } from "@/agents/job-spec/workflow";

// Shared result shape for action buttons.
export type ActionState = WorkflowResult | null;

// Runs a workflow step for a server action: turns errors into a message and refreshes every page.
export async function asState(fn: () => Promise<WorkflowResult>): Promise<WorkflowResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    revalidatePath("/", "layout");
  }
}
