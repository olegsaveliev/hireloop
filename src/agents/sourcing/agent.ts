// Step 2: sourcing agent (docs/specs/02-sourcing-agent.md). Runs the model; saves nothing.
// The app (src/agents/pipeline/workflow.ts) re-checks duplicates, applies the cap, and saves to the pipeline.
import { SOURCING_MAX_CANDIDATES, SOURCING_MIN_CANDIDATES } from "@/config/budgets";
import type { JobSpecData } from "../job-spec/schema";
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { MOCK_ATS_TOOLS, sourcingAtsServer, type SearchLog } from "../tools/mock-ats";
import { sourcingOutputSchema } from "./schema";

const AGENT = "sourcing-agent" as const;

// jobId/clientId are optional for eval runs (evals/), which belong to no job.
// The exact system prompt (prompt file + limits from config). Also used by `npm run eval` for the prompt version.
export const sourcingSystemPrompt = async () =>
  (await loadPrompt(AGENT)).replaceAll("{{MIN}}", String(SOURCING_MIN_CANDIDATES)).replaceAll("{{MAX}}", String(SOURCING_MAX_CANDIDATES));

export async function runSourcingAgent(args: { jobId?: string; clientId?: string; spec: JobSpecData; extraTags?: string[] }) {
  const jobId = args.jobId ?? "eval-no-job";
  const log: SearchLog = [];
  const systemPrompt = await sourcingSystemPrompt();
  const { title, seniority, must_have, nice_to_have, dealbreakers, location } = args.spec;

  const result = await runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt,
      prompt: [
        `Job id: ${jobId}`,
        `<spec>\n${JSON.stringify({ title, seniority, must_have, nice_to_have, dealbreakers, location }, null, 2)}\n</spec>`,
        "Find candidates for this job.",
      ].join("\n\n"),
      tags: ["step-2", ...(args.jobId ? [`job:${args.jobId}`] : []), ...(args.clientId ? [`client:${args.clientId}`] : []), ...(args.extraTags ?? [])],
      metadata: { job_id: args.jobId ?? "" },
      jobId: args.jobId,
      mcpServers: { mock_ats: sourcingAtsServer({ jobId, specLocation: location, log }) },
      allowedTools: [MOCK_ATS_TOOLS.searchCandidates, MOCK_ATS_TOOLS.getPipeline],
      // Spec: "Metadata: query count, results per query".
      // Langfuse drops metadata values over 200 characters, so each query gets its own key.
      metadataFromOutput: () => ({
        query_count: String(log.length),
        location_filter: log[0]?.location_filter.length ? "on" : "off",
        ...Object.fromEntries(log.map((l, i) => [`query_${i + 1}`, `${l.query} -> ${l.results} result(s)`.slice(0, 200)])),
      }),
    },
    sourcingOutputSchema,
  );
  return { ...result, searchLog: log };
}
