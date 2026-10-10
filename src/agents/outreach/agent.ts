// Step 5: outreach agent (docs/specs/05-outreach-agent.md). Sonnet drafts messages, Haiku classifies replies.
// Both get everything in the prompt (no tools) and save nothing: the workflow saves the result.
import { SENDER_SIGNATURE } from "@/config/outreach";
import type { CandidateProfileData } from "../enrichment/schema";
import type { JobSpecData } from "../job-spec/schema";
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { outreachDraftSchema, replyClassificationSchema, type ReplyClassification } from "./schema";

const DRAFT_AGENT = "outreach-draft" as const;
const CLASSIFIER_AGENT = "reply-classifier" as const;

export type DraftMode = "first" | "follow_up" | "reply";

// What the agents may know about the job: spec fields only. No client name (guardrail), no dealbreakers
// or open questions (internal).
export const outreachJob = (spec: JobSpecData) => ({
  title: spec.title,
  seniority: spec.seniority,
  must_have: spec.must_have,
  nice_to_have: spec.nice_to_have,
  location: spec.location,
  rate_range: spec.rate_range,
  selling_points: spec.selling_points,
});

// The profile without contacts and bookkeeping fields.
const outreachProfile = (p: CandidateProfileData) => ({
  current_title: p.current_title,
  years_experience: p.years_experience,
  recent_stack: p.recent_stack,
  skills: p.skills,
  location: p.location,
  job_history: p.job_history,
  key_facts: p.key_facts,
});

const withSignature = (prompt: string) => prompt.replaceAll("{{SIGNATURE}}", SENDER_SIGNATURE);
// The exact system prompts. Also used by `npm run eval` for the prompt version.
export const draftSystemPrompt = async () => withSignature(await loadPrompt(DRAFT_AGENT));
export const classifierSystemPrompt = async () => withSignature(await loadPrompt(CLASSIFIER_AGENT));

export async function runOutreachDraftAgent(args: {
  jobId?: string; // optional for eval runs (no job)
  clientId?: string;
  clientName: string; // only for the app-side "client not named" check; never shown to the agent
  spec: JobSpecData;
  candidateId: string;
  fullName: string;
  profile: CandidateProfileData;
  shortlistReasons: string | null;
  mode: DraftMode;
  sequenceStep: number | null;
  thread: string;
  previousDraft?: { subject: string; body: string; comment: string };
  extraTags?: string[];
}) {
  const task =
    args.mode === "first"
      ? "Task: first. Write the first message to this candidate."
      : args.mode === "follow_up"
        ? `Task: follow_up. They haven't replied. Write follow-up number ${(args.sequenceStep ?? 2) - 1} of 2.`
        : "Task: reply. Answer the candidate's latest message in the thread.";
  const prompt = [
    task,
    `candidate_id: ${args.candidateId}\nsequence_step: ${args.sequenceStep ?? "null"}\nCandidate's full name: ${args.fullName}`,
    `<job_spec>\n${JSON.stringify(outreachJob(args.spec), null, 2)}\n</job_spec>`,
    `<candidate_profile>\n${JSON.stringify(outreachProfile(args.profile), null, 2)}\n</candidate_profile>`,
    `<why_shortlisted>\n${args.shortlistReasons ?? "(no reasons recorded)"}\n</why_shortlisted>`,
    `<thread>\n${args.thread}\n</thread>`,
    args.previousDraft
      ? `<previous_draft>\nSubject: ${args.previousDraft.subject}\n\n${args.previousDraft.body}\n</previous_draft>\n\n` +
        `<recruiter_comment>\n${args.previousDraft.comment}\n</recruiter_comment>\n\nRewrite the draft following the recruiter's comment.`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const mode = args.previousDraft ? "redraft" : args.mode;
  return runAgentWithSchema(
    {
      agent: DRAFT_AGENT,
      systemPrompt: await draftSystemPrompt(),
      prompt,
      tags: ["step-5", ...(args.jobId ? [`job:${args.jobId}`] : []), ...(args.clientId ? [`client:${args.clientId}`] : []), ...(args.previousDraft ? ["redraft"] : []), ...(args.extraTags ?? [])],
      metadata: { job_id: args.jobId ?? "", candidate_id: args.candidateId, mode, sequence_step: String(args.sequenceStep ?? "") },
      jobId: args.jobId,
    },
    outreachDraftSchema(args.clientName),
  );
}

export async function runReplyClassifier(args: {
  jobId?: string; // optional for eval runs (no job)
  clientId?: string;
  spec: JobSpecData;
  candidateId: string;
  fullName: string;
  thread: string; // includes the new reply as the last message
  extraTags?: string[];
  today?: Date;
}) {
  const today = (args.today ?? new Date()).toISOString().slice(0, 10);
  const prompt = [
    `Today is ${today}. Candidate's full name: ${args.fullName}`,
    `<job_details>\n${JSON.stringify(outreachJob(args.spec), null, 2)}\n</job_details>`,
    `<thread>\n${args.thread}\n</thread>`,
    "Classify the candidate's latest message.",
  ].join("\n\n");
  const result = await runAgentWithSchema(
    {
      agent: CLASSIFIER_AGENT,
      systemPrompt: await classifierSystemPrompt(),
      prompt,
      tags: ["step-5", ...(args.jobId ? [`job:${args.jobId}`] : []), ...(args.clientId ? [`client:${args.clientId}`] : []), ...(args.extraTags ?? [])],
      metadata: { job_id: args.jobId ?? "", candidate_id: args.candidateId, mode: "classify" },
      jobId: args.jobId,
    },
    replyClassificationSchema,
  );
  // App-side rule: no reply to a "no" or an auto-reply, and none to "interested" (Step 6 sends pre-screen questions instead).
  const data: ReplyClassification | null = result.data
    ? { ...result.data, suggested_reply: ["not_interested", "out_of_office", "interested"].includes(result.data.intent) ? null : result.data.suggested_reply }
    : null;
  return { ...result, data };
}

// Money amounts like "$55", "55 USD", "€4,000", "60/hr" -> numbers, for the "rate_range only" check.
function amounts(text: string): number[] {
  const re = /(?:[$€£]\s?(\d[\d,.]*)k?|(\d[\d,.]*)\s?k?\s?(?:usd|eur|pln|uah|\$|€|£|\/\s?h(?:ou)?r|per hour|an hour))/gi;
  return [...text.matchAll(re)].map((m) => Number((m[1] ?? m[2]).replace(/,/g, ""))).filter((n) => !Number.isNaN(n));
}

// Warning for the send screen when a reply mentions money that isn't in the spec's rate_range.
export function rateWarning(reply: string, rateRange: string | null): string | null {
  const allowed = new Set([...(rateRange ?? "").matchAll(/\d[\d,.]*/g)].map((m) => Number(m[0].replace(/,/g, ""))));
  const bad = amounts(reply).filter((n) => !allowed.has(n));
  return bad.length ? `Mentions an amount that is not in the spec's rate range (${rateRange ?? "none set"}): ${bad.join(", ")}` : null;
}
