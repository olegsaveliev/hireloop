// Step 1: job spec agent (docs/specs/01-job-spec-agent.md). Runs the model; saves nothing.
// Saving and approvals live in ./workflow.ts.
import { z } from "zod";
import { db } from "@/lib/db";
import { loadPrompt } from "../prompts";
import { runAgentWithSchema, parseJson } from "../structured-output";
import { mockAtsServer, MOCK_ATS_TOOLS } from "../tools/mock-ats";
import { jobSpecAgentOutputSchema, jobSpecSchema, type JobSpecData } from "./schema";

const AGENT = "job-spec-agent" as const;

// Budget is per spec: count specs in the output (lenient, the run may not be valid yet).
function countSpecs(output: string): number {
  try {
    const parsed = parseJson(output) as { specs?: unknown[] };
    return Array.isArray(parsed.specs) ? parsed.specs.length : 1;
  } catch {
    return 1;
  }
}

async function loadBrief(briefId: string) {
  const brief = await db.clientBrief.findUniqueOrThrow({ where: { id: briefId }, include: { client: true } });
  return brief;
}

// The brief fields the agent sees. A saved brief has them; eval items (src/evals/datasets.ts) carry them directly.
export type BriefInput = Pick<Awaited<ReturnType<typeof loadBrief>>, "id" | "clientId" | "fromName" | "subject" | "receivedAt" | "body"> & {
  client: { name: string; country: string };
  attachmentNames?: unknown; // string[] for Gmail briefs (docs/specs/11-gmail-inbound.md); content not read yet
};

const attachments = (brief: BriefInput) => (Array.isArray(brief.attachmentNames) ? (brief.attachmentNames as string[]) : []);

function briefText(brief: BriefInput) {
  return [
    `Client: ${brief.client.name} (client_id: ${brief.clientId}, ${brief.client.country})`,
    `From: ${brief.fromName}`,
    `Subject: ${brief.subject}`,
    `Received: ${brief.receivedAt.toISOString().slice(0, 10)}`,
    ...(attachments(brief).length
      ? [`Attachments: ${attachments(brief).join(", ")} (not read: their content is unknown. If role details may be in them, add an open question to check the attachment.)`]
      : []),
    "",
    brief.body,
  ].join("\n");
}

const baseRun = (brief: BriefInput, systemPrompt: string) => ({
  agent: AGENT,
  systemPrompt,
  mcpServers: { mock_ats: mockAtsServer() },
  allowedTools: [MOCK_ATS_TOOLS.getPastJobs],
  countUnits: countSpecs,
});

// "Create spec": brief -> one spec per role.
// `specIds`: ids the caller will use when saving, recorded in the trace metadata (one per spec produced).
export async function generateJobSpecs(briefId: string, opts: { extraTags?: string[]; specIds?: string[] } = {}) {
  return generateJobSpecsFromBrief(await loadBrief(briefId), opts);
}

export async function generateJobSpecsFromBrief<B extends BriefInput>(brief: B, opts: { extraTags?: string[]; specIds?: string[] } = {}) {
  const result = await runAgentWithSchema(
    {
      ...baseRun(brief, await loadPrompt(AGENT)),
      prompt: `Create the job spec(s) for this client brief.\n\n<brief>\n${briefText(brief)}\n</brief>`,
      tags: ["step-1", `client:${brief.clientId}`, ...(opts.extraTags ?? [])],
      metadata: { brief_id: brief.id },
      metadataFromOutput: (out) => ({ job_spec_id: (opts.specIds ?? []).slice(0, countSpecs(out)).join(",") }),
    },
    jobSpecAgentOutputSchema,
  );
  return { ...result, brief };
}

// Reject with comment: regenerate one spec, using the recruiter's comment.
const singleSpecOutputSchema = z.object({ specs: z.array(jobSpecSchema).length(1), note: z.string().nullable() });

export async function regenerateJobSpec(args: {
  briefId: string;
  rejectedSpec: JobSpecData;
  comment: string;
  roleIndex: number;
  roleCount: number;
  rejectedSpecId: string;
  newSpecId: string;
}) {
  const brief = await loadBrief(args.briefId);
  const roleLine =
    args.roleCount > 1
      ? `This brief describes ${args.roleCount} roles. Regenerate ONLY the spec for role ${args.roleIndex + 1} ("${args.rejectedSpec.title}").`
      : "Regenerate the spec for this brief.";
  const result = await runAgentWithSchema(
    {
      ...baseRun(brief, await loadPrompt(AGENT)),
      prompt: [
        `<brief>\n${briefText(brief)}\n</brief>`,
        `<rejected_spec>\n${JSON.stringify(args.rejectedSpec, null, 2)}\n</rejected_spec>`,
        `<recruiter_comment>\n${args.comment}\n</recruiter_comment>`,
        `The recruiter rejected the spec above with this comment. ${roleLine}`,
        "Apply the comment. Treat facts in the comment as coming from the client (they count as part of the brief).",
        'Return exactly one spec in "specs", with "note" set to null or a short note about what you changed.',
      ].join("\n\n"),
      tags: ["step-1", `client:${brief.clientId}`, "regenerate"],
      metadata: { brief_id: brief.id, job_spec_id: args.newSpecId, rejected_spec_id: args.rejectedSpecId },
    },
    singleSpecOutputSchema,
  );
  return { ...result, brief };
}

// "Apply answers": the recruiter typed client answers to open questions; the agent merges them into the fields.
export async function applyAnswersToSpec(args: {
  briefId: string;
  specId: string;
  currentSpec: JobSpecData;
  answered: { question: string; answer: string }[];
}) {
  const brief = await loadBrief(args.briefId);
  const result = await runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await loadPrompt("job-spec-apply-answers"),
      prompt: [
        `<brief>\n${briefText(brief)}\n</brief>`,
        `<current_spec>\n${JSON.stringify(args.currentSpec, null, 2)}\n</current_spec>`,
        `<answers>\n${JSON.stringify(args.answered, null, 2)}\n</answers>`,
        "Update the spec with these answers.",
      ].join("\n\n"),
      tags: ["step-1", `client:${brief.clientId}`, "apply-answers"],
      metadata: { brief_id: brief.id, job_spec_id: args.specId },
    },
    singleSpecOutputSchema,
  );
  return result;
}
