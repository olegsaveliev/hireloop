// Every agent's output must match a JSON schema (CLAUDE.md "Rules for every agent").
// Parse the agent's final text as JSON, validate with Zod, and retry the run once if it doesn't match.
import type { z } from "zod";
import { runAgent, type RunAgentInput, type RunAgentResult } from "./run-agent";

export type StructuredRunResult<T> = {
  data: T | null; // null if the run stopped, failed, or was still invalid after the retry
  runs: RunAgentResult[]; // 1 run, or 2 if a retry was needed
  error: string | null;
};

// Accept plain JSON or JSON wrapped in a ```json fence.
export function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  return JSON.parse(start > 0 ? candidate.slice(start) : candidate);
}

function validate<T>(schema: z.ZodType<T>, text: string): { data: T } | { error: string } {
  try {
    const parsed = schema.safeParse(parseJson(text));
    if (parsed.success) return { data: parsed.data };
    return { error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  } catch (e) {
    return { error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function runAgentWithSchema<T>(input: RunAgentInput, schema: z.ZodType<T>): Promise<StructuredRunResult<T>> {
  const first = await runAgent(input);
  if (first.output === null) return { data: null, runs: [first], error: `Run ${first.status}` };
  const v1 = validate(schema, first.output);
  if ("data" in v1) return { data: v1.data, runs: [first], error: null };

  // One retry: same task, plus the invalid output and what was wrong with it.
  const retry = await runAgent({
    ...input,
    tags: [...(input.tags ?? []), "schema-retry"],
    prompt:
      `${input.prompt}\n\n---\nYour previous answer did not match the required JSON schema.\n` +
      `Problems: ${v1.error}\n\nPrevious answer:\n${first.output}\n\nReturn corrected JSON only.`,
  });
  if (retry.output === null) return { data: null, runs: [first, retry], error: `Retry ${retry.status}` };
  const v2 = validate(schema, retry.output);
  if ("data" in v2) return { data: v2.data, runs: [first, retry], error: null };
  return { data: null, runs: [first, retry], error: `Output still invalid after retry: ${v2.error}` };
}
