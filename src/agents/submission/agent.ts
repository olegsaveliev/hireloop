// Step 7: submission agent (docs/specs/07-submission-agent.md). Sonnet writes the client profile from the source data.
// Everything is in the prompt (no tools) and it saves nothing: the workflow saves it for the account manager.
import type { SubmissionFormat } from "@/config/submission";
import type { CandidateProfileData } from "../enrichment/schema";
import type { JobSpecData } from "../job-spec/schema";
import type { PrescreenSummary } from "../prescreen/schema";
import type { ScreeningData } from "../screening/schema";
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { submissionSchema, type SubmissionFields } from "./schema";

const AGENT = "submission-agent" as const;

export const submissionSystemPrompt = () => loadPrompt(AGENT);

// The facts the agent may use. No name, no contacts (it never needs them), no red flags (internal).
export function sourceData(args: { profile: CandidateProfileData; screening: ScreeningData | null; prescreen: PrescreenSummary | null }) {
  const p = args.profile;
  return {
    profile: {
      current_title: p.current_title,
      years_experience: p.years_experience,
      skills: p.skills,
      recent_stack: p.recent_stack,
      location: p.location,
      english_level: p.english_level,
      job_history: p.job_history,
      key_facts: p.key_facts,
    },
    screening: args.screening ? { must_have_met: args.screening.must_have_met, reasons: args.screening.reasons } : null,
    prescreen: args.prescreen ? { answers: args.prescreen.answers, availability: args.prescreen.availability, summary: args.prescreen.summary } : null,
  };
}

export async function runSubmissionAgent(args: {
  jobId?: string; // optional for eval runs (no job)
  clientId: string;
  spec: JobSpecData;
  format: SubmissionFormat;
  candidateId: string;
  fullName: string; // only for the app-side anonymization check; never shown to the agent
  profile: CandidateProfileData;
  screening: ScreeningData | null;
  prescreen: PrescreenSummary | null;
  rate: string; // confirmed rate (Step 6 answer or typed by the recruiter)
  previousDraft?: { fields: SubmissionFields; comment: string };
  extraTags?: string[];
}) {
  const source = sourceData(args);
  const sourceText = JSON.stringify(source, null, 2);
  const prompt = [
    `candidate_id: ${args.candidateId}`,
    `<role>\n${JSON.stringify({ title: args.spec.title, seniority: args.spec.seniority, must_have: args.spec.must_have, nice_to_have: args.spec.nice_to_have }, null, 2)}\n</role>`,
    `<client_template>\n${JSON.stringify(args.format, null, 2)}\n</client_template>`,
    `<confirmed_rate>${args.rate}</confirmed_rate>`,
    `<source_data>\n${sourceText}\n</source_data>`,
    args.previousDraft
      ? `<previous_draft>\n${JSON.stringify(args.previousDraft.fields, null, 2)}\n</previous_draft>\n\n<account_manager_comment>\n${args.previousDraft.comment}\n</account_manager_comment>\n\nRewrite the draft following the account manager's comment.`
      : "Write the profile.",
  ].join("\n\n");
  return runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await submissionSystemPrompt(),
      prompt,
      tags: ["step-7", `client:${args.clientId}`, ...(args.jobId ? [`job:${args.jobId}`] : []), ...(args.previousDraft ? ["redraft"] : []), ...(args.extraTags ?? [])],
      metadata: { job_id: args.jobId ?? "", candidate_id: args.candidateId, anonymized: String(args.format.anonymized), mode: args.previousDraft ? "redraft" : "draft" },
      jobId: args.jobId,
    },
    submissionSchema({
      candidateId: args.candidateId,
      clientId: args.clientId,
      anonymized: args.format.anonymized,
      fields: args.format.fields,
      rate: args.rate,
      sourceText,
      who: { fullName: args.fullName, employers: args.profile.job_history.map((j) => j.company) },
    }),
  );
}
