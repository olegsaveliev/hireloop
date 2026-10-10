// Step 6 pre-screen settings, in one place (docs/specs/06-prescreen-agent.md).

export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 5;

// "Rate far above range" (spec edge case): the candidate's rate is more than this share above the top of the
// spec's rate_range. The app then adds a red flag and turns "proceed" into "discuss", whatever the agent said.
export const RATE_FAR_ABOVE_RATIO = 0.15;

// Guardrail: topics we never ask about or repeat (spec: age, family, health, religion, nationality).
// Checked in code on every question, summary and red flag; a hit = invalid output -> one retry.
// Word lists stay narrow on purpose: "race condition", "Kvitka Health" (a company) or "Poland" are fine.
export const PROTECTED_TOPICS: { topic: string; pattern: RegExp }[] = [
  { topic: "age", pattern: /\b(age|aged|how old|date of birth|year of birth|born in)\b/i },
  { topic: "family", pattern: /\b(married|marital|spouse|wife|husband|children|kids|pregnan\w*|maternity|paternity|family)\b/i },
  { topic: "health", pattern: /\b(your health|health (condition|issue|problem|status)s?|disabilit\w*|disabled|medical (condition|history|issue)s?|illness|sick leave)\b/i },
  { topic: "religion", pattern: /\b(religio\w*|church|mosque|synagogue|faith|pray\w*)\b/i },
  { topic: "nationality", pattern: /\b(nationality|citizenship|citizen|ethnic\w*|race(?! condition)|native country|where are you (originally )?from)\b/i },
];

export function protectedTopicsIn(text: string): string[] {
  return PROTECTED_TOPICS.filter((t) => t.pattern.test(text)).map((t) => t.topic);
}

// The questions email is a fixed template around the agent's questions (no approval needed: low risk).
export const QUESTIONS_INTRO = "Thanks for getting back to me. Before we set up a call, a few quick questions so I can check the fit with the role:";
export const QUESTIONS_OUTRO = "Short answers are perfectly fine.";
