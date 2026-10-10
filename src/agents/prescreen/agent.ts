// Step 6: pre-screen agent (docs/specs/06-prescreen-agent.md). Sonnet, two tasks: write questions, summarize answers.
// Everything is in the prompt (no tools) and the agent saves nothing: the workflow sends and saves.
import { SENDER_SIGNATURE } from "@/config/outreach";
import { QUESTIONS_INTRO, QUESTIONS_OUTRO, RATE_FAR_ABOVE_RATIO } from "@/config/prescreen";
import { rateAboveRange } from "@/lib/rates";
import type { CandidateProfileData } from "../enrichment/schema";
import type { JobSpecData } from "../job-spec/schema";
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { prescreenQuestionsSchema, prescreenSummarySchema, type PrescreenQuestion, type PrescreenSummary } from "./schema";

const AGENT = "prescreen-agent" as const;

// What the agent may know about the job. No client name (guardrail); no open_questions (those are questions
// for the client, not the candidate). Dealbreakers are included so questions can check them (never quoted).
const prescreenJob = (spec: JobSpecData) => ({
  title: spec.title,
  seniority: spec.seniority,
  must_have: spec.must_have,
  nice_to_have: spec.nice_to_have,
  dealbreakers: spec.dealbreakers,
  location: spec.location,
  rate_range: spec.rate_range,
});

// The profile without contacts.
const prescreenProfile = (p: CandidateProfileData) => ({
  current_title: p.current_title,
  years_experience: p.years_experience,
  recent_stack: p.recent_stack,
  skills: p.skills,
  location: p.location,
  english_level: p.english_level,
  job_history: p.job_history,
  key_facts: p.key_facts,
});

// The exact system prompt. Also used by `npm run eval` for the prompt version.
export const prescreenSystemPrompt = () => loadPrompt(AGENT);

type Common = {
  jobId?: string; // optional for eval runs (no job)
  clientId?: string;
  spec: JobSpecData;
  candidateId: string;
  fullName: string;
  profile: CandidateProfileData;
  thread: string;
  extraTags?: string[];
};

const tags = (a: Common) => ["step-6", ...(a.jobId ? [`job:${a.jobId}`] : []), ...(a.clientId ? [`client:${a.clientId}`] : []), ...(a.extraTags ?? [])];

// `previous`: the recruiter rejected the drafted questions email with a comment; the agent rewrites the questions.
export async function runPrescreenQuestions(args: Common & { previous?: { body: string; comment: string } }) {
  const prompt = [
    "Task: questions.",
    `candidate_id: ${args.candidateId}\nCandidate's full name: ${args.fullName}`,
    `<job_spec>\n${JSON.stringify(prescreenJob(args.spec), null, 2)}\n</job_spec>`,
    `<candidate_profile>\n${JSON.stringify(prescreenProfile(args.profile), null, 2)}\n</candidate_profile>`,
    `<thread>\n${args.thread}\n</thread>`,
    ...(args.previous
      ? [`<previous_questions_email>\n${args.previous.body}\n</previous_questions_email>\n\n<recruiter_comment>\n${args.previous.comment}\n</recruiter_comment>\n\nThe recruiter rejected the questions above. Write the questions again, following the recruiter's comment.`]
      : []),
  ].join("\n\n");
  return runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await prescreenSystemPrompt(),
      prompt,
      tags: [...tags(args), ...(args.previous ? ["redraft"] : [])],
      metadata: { job_id: args.jobId ?? "", candidate_id: args.candidateId, mode: args.previous ? "questions-redraft" : "questions" },
      jobId: args.jobId,
    },
    prescreenQuestionsSchema,
  );
}

export async function runPrescreenSummary(args: Common & { questions: PrescreenQuestion[] }) {
  const prompt = [
    "Task: summary.",
    `candidate_id: ${args.candidateId}\nCandidate's full name: ${args.fullName}`,
    `<job_spec>\n${JSON.stringify(prescreenJob(args.spec), null, 2)}\n</job_spec>`,
    `<candidate_profile>\n${JSON.stringify(prescreenProfile(args.profile), null, 2)}\n</candidate_profile>`,
    `<questions_sent>\n${args.questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}\n</questions_sent>`,
    `<thread>\n${args.thread}\n</thread>`,
  ].join("\n\n");
  const result = await runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await prescreenSystemPrompt(),
      prompt,
      tags: tags(args),
      metadata: { job_id: args.jobId ?? "", candidate_id: args.candidateId, mode: "summary" },
      jobId: args.jobId,
    },
    prescreenSummarySchema(args.questions.length),
  );
  return { ...result, data: result.data ? applyRateRule(result.data, args.spec.rate_range) : null };
}

// App-side rule (spec edge case "rate far above range: red flag, recommendation = discuss"): checked in code
// too, so it holds whatever the model said. "stop" stays stop.
export function applyRateRule(s: PrescreenSummary, rateRange: string | null): PrescreenSummary {
  const above = rateAboveRange(s.rate_expectation, rateRange);
  if (above === null || above <= RATE_FAR_ABOVE_RATIO) return s;
  const flagged = s.red_flags.some((f) => /rate|range|\$|€|budget/i.test(f));
  return {
    ...s,
    red_flags: flagged ? s.red_flags : [...s.red_flags, `Rate ${s.rate_expectation} is about ${Math.round(above * 100)}% above the range ${rateRange}`],
    recommendation: s.recommendation === "proceed" ? "discuss" : s.recommendation,
  };
}

// The questions email: a fixed template around the agent's questions.
export function questionsEmail(firstName: string, questions: PrescreenQuestion[]): string {
  return [`Hi ${firstName},`, QUESTIONS_INTRO, questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n"), QUESTIONS_OUTRO, SENDER_SIGNATURE].join("\n\n");
}
