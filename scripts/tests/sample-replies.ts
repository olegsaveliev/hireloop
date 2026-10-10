// Automated tests only: stands in for a candidate answering pre-screen questions or interview times (no AI).
// Builds an answer email from the questions actually sent, so the three demo cases always fit them:
// full answers with the rate in range, rate 40% over range, and only 2 answers.
import { SENDER_NAME } from "@/config/outreach";
import { parseRate, rateLike } from "@/lib/rates";
import type { PrescreenQuestion } from "@/agents/prescreen/schema";

export const SAMPLE_ANSWER_KINDS = {
  full: "Full answers, rate in range",
  rate_high: "Rate 40% over range",
  partial: "Only 2 answers",
} as const;
export type SampleAnswerKind = keyof typeof SAMPLE_ANSWER_KINDS;

function rateAnswer(rateRange: string | null, kind: SampleAnswerKind): string {
  const r = parseRate(rateRange);
  if (!rateRange || !r) return kind === "rate_high" ? "$90/hr on a B2B contract." : "$50/hr on a B2B contract.";
  const value = kind === "rate_high" ? r.high * 1.4 : (r.low + r.high) / 2;
  return `${rateLike(rateRange, value)} on a B2B contract.`;
}

function answer(q: PrescreenQuestion, rateRange: string | null, kind: SampleAnswerKind): string {
  if (q.topic === "rate") return rateAnswer(rateRange, kind);
  if (q.topic === "availability" || q.topic === "notice_period") return "I could start in about 3 weeks: my notice period is 2 weeks.";
  if (/\b(b2b|contract)\b/i.test(q.about + q.question)) return "Yes, B2B works for me: I've worked on B2B contracts for the last 3 years.";
  if (q.topic === "must_have") return `Yes: I've used ${q.about} in production for the last 3 years in my current role.`;
  return "Yes, that works for me.";
}

export function sampleAnswers(kind: SampleAnswerKind, questions: PrescreenQuestion[], rateRange: string | null, fullName: string): string {
  const answered = kind === "partial" ? questions.slice(0, Math.min(2, questions.length - 1)) : questions;
  const intro = kind === "partial" ? "Quick answers to the first two for now, I'll come back on the rest:" : "Thanks, here are my answers:";
  return [`Hi ${SENDER_NAME},`, intro, answered.map((q, i) => `${i + 1}. ${answer(q, rateRange, kind)}`).join("\n"), `Best,\n${fullName.split(/\s+/)[0]}`].join("\n\n");
}

// Step 8: the candidate's answer to interview times (built from the options actually sent).
export const SAMPLE_SCHEDULING_KINDS = {
  pick1: "Option 1 works",
  pick2: "Option 2 works",
  reschedule: "None work / move it",
  thanks: "Thanks, see you then",
  decline: "No longer interested",
} as const;
export type SampleSchedulingKind = keyof typeof SAMPLE_SCHEDULING_KINDS;

// `options`: the option lines as the candidate saw them ("Tue 13 Oct, 16:00-17:00 Kyiv time (UTC+3) = ...").
export function sampleSchedulingReply(kind: SampleSchedulingKind, options: string[], firstName: string): string {
  const when = (i: number) => options[i]?.split(" = ")[0].replace(/\s*\(UTC[^)]*\)/, "") ?? "that time";
  const body = {
    pick1: `Option 1 (${when(0)}) works for me.`,
    pick2: `${when(1)} is good for me, let's do option 2.`,
    reschedule: "Sorry, none of these work for me this week, I have a release. Could we find other times?",
    thanks: "Thanks, see you then.",
    decline: "Thanks, but I've accepted another offer, so I'll withdraw.",
  }[kind];
  return `Hi ${SENDER_NAME},\n\n${body}\n\nBest,\n${firstName}`;
}
