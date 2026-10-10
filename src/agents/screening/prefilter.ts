// Pre-filter before screening (Phase 2 cost decision). Plain code, no AI, free.
// A candidate is filtered out only when the spec has searchable must-have skills and NONE of them appear
// in the candidate's skills, recent stack, current title or past job titles. Everyone else goes to Opus.
// Deliberately crude and lenient: one matching word is enough to pass.
import type { CandidateProfileData } from "../enrichment/schema";

// Words in must-haves that are not skills ("4+ years of experience", "English B2 minimum", "B2B contract").
const STOPWORDS = new Set(
  ("a an and or of in on with for the to at by as is be from plus least minimum min max strong good solid " +
    "years year experience exp commercial knowledge skills skill level english german polish ukrainian " +
    "b1 b2 c1 c2 upper intermediate fluent native contract b2b employment start asap latest december january " +
    "remote onsite on-site hybrid office eu cet time zone timezone overlap hours senior middle junior lead " +
    "engineer developer dev role team work working proven hands-on hands background understanding similar " +
    "e.g etc like ideally preferably must nice have").split(/\s+/),
);

// Same skill, different spelling.
const SYNONYMS: Record<string, string> = {
  postgres: "postgresql", js: "javascript", ts: "typescript", k8s: "kubernetes", golang: "go",
  "react.js": "react", reactjs: "react", "node.js": "node", nodejs: "node", "vue.js": "vue",
  amazon: "aws", "next.js": "next", nextjs: "next", "c#": "csharp", ".net": "dotnet",
};

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#.]+/u)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean)
    .map((t) => SYNONYMS[t] ?? t);
}

export function mustHaveTerms(mustHave: string[]): string[] {
  return [...new Set(mustHave.flatMap(tokens).filter((t) => !STOPWORDS.has(t) && !/^\d+\+?$/.test(t)))];
}

export type PrefilterResult = { pass: true } | { pass: false; reason: string };

export function prefilter(mustHave: string[], profile: CandidateProfileData): PrefilterResult {
  const terms = mustHaveTerms(mustHave);
  if (!terms.length) return { pass: true }; // nothing searchable to check (e.g. a vague spec)
  const have = new Set(
    [...profile.skills, ...profile.recent_stack, profile.current_title ?? "", ...profile.job_history.map((j) => j.title)].flatMap(tokens),
  );
  if (terms.some((t) => have.has(t))) return { pass: true };
  return {
    pass: false,
    reason: `Pre-filter: none of the must-haves (${mustHave.join(", ")}) found in skills, stack or job titles. Not scored by the AI.`,
  };
}
