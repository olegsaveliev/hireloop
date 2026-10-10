// Step 4: screening agent (docs/specs/04-screening-agent.md). One Opus run per candidate, effort "low"
// (src/config/models.ts). Input is the spec and the structured profile only; saves nothing.
import type { CandidateProfileData } from "../enrichment/schema";
import type { JobSpecData } from "../job-spec/schema";
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { screeningOutputSchema, type ScreeningData } from "./schema";

const AGENT = "screening-agent" as const;
export const DEALBREAKER_MAX_SCORE = 20;

// The spec fields screening needs (rate, selling points and open questions don't change the score).
export const screeningSpec = (spec: JobSpecData) => ({
  title: spec.title,
  seniority: spec.seniority,
  must_have: spec.must_have,
  nice_to_have: spec.nice_to_have,
  dealbreakers: spec.dealbreakers,
  location: spec.location,
});

// The profile without contacts (not needed for scoring).
const screeningProfile = (p: CandidateProfileData): Omit<CandidateProfileData, "contacts"> =>
  Object.fromEntries(Object.entries(p).filter(([k]) => k !== "contacts")) as Omit<CandidateProfileData, "contacts">;

// App-side rule: any dealbreaker hit -> score max 20, even if the model scored higher.
export function applyDealbreakerCap(data: ScreeningData): ScreeningData {
  return data.dealbreaker_hit && data.score > DEALBREAKER_MAX_SCORE ? { ...data, score: DEALBREAKER_MAX_SCORE } : data;
}

export async function runScreeningAgent(args: {
  jobId?: string; // optional for eval runs (no job)
  clientId?: string;
  spec: JobSpecData;
  profile: CandidateProfileData;
  extraTags?: string[];
}) {
  const result = await runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await loadPrompt(AGENT),
      prompt: [
        `<spec>\n${JSON.stringify(screeningSpec(args.spec), null, 2)}\n</spec>`,
        `<candidate_profile>\n${JSON.stringify(screeningProfile(args.profile), null, 2)}\n</candidate_profile>`,
        "Score this candidate against the spec.",
      ].join("\n\n"),
      tags: ["step-4", ...(args.jobId ? [`job:${args.jobId}`] : []), ...(args.clientId ? [`client:${args.clientId}`] : []), ...(args.extraTags ?? [])],
      metadata: { job_id: args.jobId ?? "", candidate_id: args.profile.candidate_id, candidates_scored: "1" },
      jobId: args.jobId,
    },
    screeningOutputSchema,
  );
  const data = result.data ? applyDealbreakerCap({ ...result.data, candidate_id: args.profile.candidate_id }) : null;
  return { ...result, data };
}
