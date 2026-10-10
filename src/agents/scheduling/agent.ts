// Step 8: scheduling agent (docs/specs/08-scheduling-agent.md). Haiku, two small tasks: write the options email
// (around the app's {{slots}} list) and read the candidate's reply. No tools: the workflow finds times (code),
// books (mock_calendar) and sends (mock_inbox).
import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { optionsEmailSchema, schedulingReplySchema } from "./schema";

const AGENT = "scheduling-agent" as const;

export const schedulingSystemPrompt = () => loadPrompt(AGENT);

type Common = {
  jobId?: string; // optional for eval runs (no job)
  clientId?: string;
  candidateId: string;
  extraTags?: string[];
};
const tags = (a: Common) => ["step-8", ...(a.jobId ? [`job:${a.jobId}`] : []), ...(a.clientId ? [`client:${a.clientId}`] : []), ...(a.extraTags ?? [])];

// `firstName`: as in our earlier emails to the candidate (the profile name can be Cyrillic), so it never changes.
export async function runOptionsEmail(args: Common & { firstName: string; jobTitle: string; slotCount: number; mode: "first" | "reschedule"; candidateNote?: string; clientName?: string }) {
  const prompt = [
    "Task: options_email.",
    `candidate_id: ${args.candidateId}\nCandidate's first name: ${args.firstName}\nRole: ${args.jobTitle}\nmode: ${args.mode}\nNumber of options in the list: ${args.slotCount}`,
    args.candidateNote ? `<candidate_message>\n${args.candidateNote}\n</candidate_message>` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await schedulingSystemPrompt(),
      prompt,
      tags: tags(args),
      metadata: { job_id: args.jobId ?? "", candidate_id: args.candidateId, mode: args.mode === "first" ? "options" : "reschedule" },
      jobId: args.jobId,
    },
    // The client name is only used by the app's "client not named" check; the agent never sees it.
    optionsEmailSchema({ clientName: args.clientName }),
  );
}

// `options`: the open options exactly as the candidate saw them (numbered), or [] when none are open.
export async function runReadReply(args: Common & { options: string[]; status: string; reply: string }) {
  const prompt = [
    "Task: read_reply.",
    `candidate_id: ${args.candidateId}`,
    `Interview status: ${args.status === "confirmed" ? "already booked" : args.options.length ? "options sent, waiting for the candidate's choice" : "waiting for the client"}`,
    `<open_options>\n${args.options.length ? args.options.map((o, i) => `${i + 1}. ${o}`).join("\n") : "(none)"}\n</open_options>`,
    `<candidate_message>\n${args.reply}\n</candidate_message>`,
  ].join("\n\n");
  return runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await schedulingSystemPrompt(),
      prompt,
      tags: tags(args),
      metadata: { job_id: args.jobId ?? "", candidate_id: args.candidateId, mode: "read_reply" },
      jobId: args.jobId,
    },
    schedulingReplySchema(args.options.length),
  );
}

// A scheduling trace with no model call (e.g. no overlap found before any email was written), so the interview's
// scores (escalated) still have a trace. Not an agent run: no agent_runs row, no cost.
export async function codeOnlyTrace(args: Common & { reason: string }): Promise<string> {
  return context.with(ROOT_CONTEXT, () =>
    startActiveObservation(AGENT, async (span) =>
      propagateAttributes({ traceName: AGENT, tags: [...tags(args), "no-llm"], sessionId: args.jobId ? `job:${args.jobId}` : undefined, metadata: { candidate_id: args.candidateId, mode: "escalation" } }, async () => {
        span.update({ output: args.reason });
        return span.traceId;
      }),
    ),
  );
}
