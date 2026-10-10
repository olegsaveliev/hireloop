// Claude model names, in one place so they're easy to swap.
export const MODELS = {
  haiku: "claude-haiku-4-5-20251001", // cheap, high-volume extraction/classification
  sonnet: "claude-sonnet-5-5", // default workhorse
  opus: "claude-opus-5-5", // ranking/judgment only
} as const;

export type ModelKey = keyof typeof MODELS;

// Reasoning effort per agent (how hard the model thinks; lower = cheaper). Agents not listed use the
// model's default. Haiku 4.5 doesn't support effort.
export const AGENT_EFFORT: Partial<Record<string, "low" | "medium" | "high">> = {
  "screening-agent": "low", // Phase 2 cost decision: scoring one profile vs a checklist is a simple task
};

// Models whose "thinking" is switched off. The Agent SDK turns thinking on by default, and thinking is
// billed as output: in Phase 2, Haiku enrichment used 4,000-8,600 output tokens per profile (~$0.03)
// instead of ~600. Pure extraction/classification doesn't need it. (Sonnet 5.5 and Opus 5.5 don't allow
// switching it off; use AGENT_EFFORT for them.)
export const THINKING_OFF: ModelKey[] = ["haiku"];
