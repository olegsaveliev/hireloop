// Step 6 outputs (docs/specs/06-prescreen-agent.md "Output"). One agent, two tasks: write the questions, then
// summarize the answers. App-side checks (refine) make an output invalid -> one retry.
import { z } from "zod";
import { MAX_QUESTIONS, MIN_QUESTIONS, protectedTopicsIn } from "@/config/prescreen";

export const QUESTION_TOPICS = ["must_have", "rate", "availability", "notice_period", "other"] as const;
export const RECOMMENDATIONS = ["proceed", "discuss", "stop"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

const noProtectedTopic = (s: string) => protectedTopicsIn(s).length === 0;
const protectedMessage = "Don't ask about or mention age, family, health, religion or nationality";

export const prescreenQuestionsSchema = z
  .object({
    candidate_id: z.string(),
    first_name: z.string().min(1), // in Latin letters, for "Hi <first name>," (profiles can be in Cyrillic)
    questions: z
      .array(
        z.object({
          question: z.string().min(5).refine(noProtectedTopic, protectedMessage),
          topic: z.enum(QUESTION_TOPICS),
          about: z.string().min(1), // the spec item it checks, e.g. a must-have, or "rate_range"
        }),
      )
      .min(MIN_QUESTIONS, `Ask at least ${MIN_QUESTIONS} questions`)
      .max(MAX_QUESTIONS, `Ask at most ${MAX_QUESTIONS} questions`),
  })
  .refine((q) => q.questions.some((x) => x.topic === "rate"), "Include a question about their rate")
  .refine((q) => q.questions.some((x) => x.topic === "availability" || x.topic === "notice_period"), "Include a question about availability / notice period")
  .refine((q) => q.questions.some((x) => x.topic === "must_have"), "Include at least one question about a must-have from the spec");
export type PrescreenQuestions = z.infer<typeof prescreenQuestionsSchema>;
export type PrescreenQuestion = PrescreenQuestions["questions"][number];

// The spec's schema, with `answer: null` for a question the candidate didn't answer (spec edge case
// "partial answers: list missing items"; the app lists the nulls). One answer per question asked.
export const prescreenSummarySchema = (questionCount: number) =>
  z.object({
    candidate_id: z.string(),
    answers: z
      .array(z.object({ question: z.string(), answer: z.string().nullable() }))
      .length(questionCount, `Give exactly one entry per question asked (${questionCount}), in order; answer null if not answered`),
    rate_expectation: z.string().nullable(),
    availability: z.string().nullable(),
    red_flags: z.array(z.string().refine(noProtectedTopic, protectedMessage)),
    recommendation: z.enum(RECOMMENDATIONS),
    summary: z.string().min(1).refine(noProtectedTopic, protectedMessage),
  });
export type PrescreenSummary = z.infer<ReturnType<typeof prescreenSummarySchema>>;

export const missingAnswers = (s: PrescreenSummary) => s.answers.filter((a) => !a.answer?.trim()).map((a) => a.question);
export const completeness = (s: PrescreenSummary) => (s.answers.length ? (s.answers.length - missingAnswers(s).length) / s.answers.length : 0);
