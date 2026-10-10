import { after } from "next/server";
import { runPipeline } from "@/agents/pipeline/workflow";
import type { WorkflowResult } from "@/agents/job-spec/workflow";
import { db } from "@/lib/db";

// Steps 5-7 work started from a click (answers arrived, "Prepare submission", a rate typed in): the job's
// Steps 5-7 run does whatever is missing, in the background. Only for a job that is idle in "outreach".
export async function continueJobInBackground(result: WorkflowResult): Promise<WorkflowResult> {
  const jobId = result.jobId;
  if (!result.ok || !jobId) return result;
  const { count } = await db.job.updateMany({ where: { id: jobId, status: "outreach" }, data: { status: "drafting_outreach", pipelineUpdatedAt: new Date() } });
  if (count) {
    after(async () => {
      const r = await runPipeline(jobId);
      console.log(`[pipeline ${jobId}] ${r.message}`);
    });
  }
  return result;
}

// Steps 2-4 take minutes, so they run after the response is sent; the Jobs page refreshes while they run.
// Progress lives in the database (job status), not in memory. Later this becomes a Trigger.dev task.
export async function startPipelineInBackground(result: WorkflowResult): Promise<WorkflowResult> {
  const jobId = result.jobId;
  if (result.ok && jobId) {
    // Mark it running now, so the page that re-renders after the click already shows progress.
    await db.job.updateMany({ where: { id: jobId, status: "ready_for_sourcing" }, data: { status: "sourcing", pipelineUpdatedAt: new Date() } });
    await db.job.update({ where: { id: jobId }, data: { pipelineUpdatedAt: new Date() } });
    after(async () => {
      const r = await runPipeline(jobId);
      console.log(`[pipeline ${jobId}] ${r.message}`);
    });
  }
  return result;
}
