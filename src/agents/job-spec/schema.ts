// Job spec JSON schema (docs/specs/01-job-spec-agent.md "Output"). Every later agent reads this shape.
import { z } from "zod";

export const SENIORITIES = ["junior", "middle", "senior", "lead"] as const;

export const jobSpecSchema = z.object({
  title: z.string().min(1),
  // null when the brief is unclear or contradictory about seniority (the reason goes in open_questions).
  seniority: z.enum(SENIORITIES).nullable(),
  must_have: z.array(z.string()),
  nice_to_have: z.array(z.string()),
  dealbreakers: z.array(z.string()),
  location: z.array(z.string()),
  rate_range: z.string().nullable(),
  selling_points: z.array(z.string()),
  open_questions: z.array(z.string()),
});
export type JobSpecData = z.infer<typeof jobSpecSchema>;
export const SPEC_FIELDS = Object.keys(jobSpecSchema.shape) as (keyof JobSpecData)[];

// What the agent returns for a brief: one spec per role, plus a note (e.g. "two roles, two specs").
export const jobSpecAgentOutputSchema = z.object({
  specs: z.array(jobSpecSchema).min(1).max(3),
  note: z.string().nullable(),
});
export type JobSpecAgentOutput = z.infer<typeof jobSpecAgentOutputSchema>;

// `applied` = the answer was already merged into the spec fields with "Apply answers" (question no longer open).
export type OpenQuestionAnswer = { question: string; answered: boolean; answer: string; applied?: boolean };
