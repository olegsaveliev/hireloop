// Step 9 weekly summary output ("what went wrong most often this week"). The app gathers the week's facts (each
// with an id); the agent groups them into issues and cites fact ids as evidence. Checked in code: every cited id
// exists (nothing invented), an issue's count = its evidence, most frequent first, no protected attributes.
import { z } from "zod";
import { MAX_SUMMARY_ISSUES, protectedInReason } from "@/config/feedback";

export type Fact = { id: string; kind: string; agent: string; text: string };
// The agents an issue can be about. "process" = not one agent's fault (e.g. no common calendar time, a client's call).
export const ISSUE_AGENTS = [
  "job-spec-agent", "inbound-classifier", "sourcing-agent", "enrichment-agent", "screening-agent", "outreach-draft", "reply-classifier",
  "prescreen-agent", "submission-agent", "scheduling-agent", "client-reply-hint", "process",
] as const;

export const weeklySummarySchema = (facts: Fact[]) => {
  const ids = new Set(facts.map((f) => f.id));
  const agents: readonly string[] = ISSUE_AGENTS;
  return z
    .object({
      headline: z.string().min(1).max(300),
      issues: z
        .array(
          z.object({
            agent: z.string(),
            what_went_wrong: z.string().min(1).max(400),
            evidence: z.array(z.string()).min(1),
            suggestion: z.string().min(1).max(400),
          }),
        )
        .max(MAX_SUMMARY_ISSUES),
      going_well: z.array(z.string()).max(5),
      open_questions: z.array(z.string()).max(5),
    })
    .superRefine((o, c) => {
      o.issues.forEach((issue, i) => {
        if (!agents.includes(issue.agent)) c.addIssue({ code: "custom", path: ["issues", i, "agent"], message: `must be one of: ${agents.join(", ")}` });
        const unknown = issue.evidence.filter((e) => !ids.has(e));
        if (unknown.length) c.addIssue({ code: "custom", path: ["issues", i, "evidence"], message: `unknown fact id(s) ${unknown.join(", ")}: cite only ids from <facts>` });
        if (new Set(issue.evidence).size !== issue.evidence.length) c.addIssue({ code: "custom", path: ["issues", i, "evidence"], message: "list each fact id once" });
        if (i > 0 && issue.evidence.length > o.issues[i - 1].evidence.length) {
          c.addIssue({ code: "custom", path: ["issues", i], message: "order issues by how many facts support them, most first" });
        }
      });
      const text = [o.headline, ...o.issues.flatMap((x) => [x.what_went_wrong, x.suggestion]), ...o.going_well, ...o.open_questions].join(" ");
      const hits = protectedInReason(text);
      if (hits.length) c.addIssue({ code: "custom", path: ["(root)"], message: `don't mention protected attributes (${hits.join(", ")})` });
    });
};
export type WeeklySummary = z.infer<ReturnType<typeof weeklySummarySchema>>;
