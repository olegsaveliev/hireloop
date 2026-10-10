// Runs one agent's current prompt over its dataset (docs/specs/10-langfuse-polish.md part 4; Step 9 adds the recruiter's
// corrections). Used by `npm run eval` (scripts/evals/eval.ts) and by the weekly job's "also run the datasets" option.
// Real model calls; nothing is saved to jobs, candidates, messages or the queue.
//   1. Syncs the dataset items in src/evals/datasets.ts and the agent's corrections (src/agents/feedback/corrections.ts) to Langfuse.
//   2. Runs them as a Langfuse experiment named "<prompt_version> <date time>". Each item gets one trace with the
//      agent run inside it.
//   3. Each item's check records eval_passed (0/1) on its trace. Reference-only corrections are not run.
import { EVALS, syncDataset, type Check } from "./datasets";
import { getTelemetry } from "@/agents/telemetry";
import { promptVersion, runInsideEval } from "@/agents/run-agent";
import { correctionEvalItems, syncCorrections } from "@/agents/feedback/corrections";

export type EvalItemResult = { id: string; passed: boolean; costUsd: number; detail: string; output: unknown };
export type EvalResult = { agent: string; promptVersion: string; runName: string; passed: number; total: number; costUsd: number; url: string | null; items: EvalItemResult[] };

export async function runEval(agent: string, opts: { onlyItem?: string } = {}): Promise<EvalResult> {
  const e = EVALS[agent];
  if (!e) throw new Error(`No eval for ${agent}`);
  const { langfuse } = getTelemetry();
  await syncDataset(langfuse, agent);
  await syncCorrections(agent);
  const defs = [...e.items, ...(await correctionEvalItems(agent))];
  const dataset = await langfuse.dataset.get(agent);
  // Only items with a check (state-dependent test items and reference-only corrections in the same dataset are skipped).
  const items = dataset.items.filter((i) => defs.some((d) => d.id === i.id) && (!opts.onlyItem || i.id === opts.onlyItem));
  if (!items.length) throw new Error(`No runnable items${opts.onlyItem ? ` with id ${opts.onlyItem}` : ""} in ${agent}`);

  const version = promptVersion(await e.systemPrompt());
  const runName = `${version} ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
  // Per item: what the run cost and why it returned nothing, for the printout.
  const costs = new Map<string, number>();
  const errors = new Map<string, string>();
  const result = await langfuse.experiment.run({
    name: `${agent} eval`,
    runName,
    description: `npm run eval -- ${agent} (prompt_version ${version})`,
    metadata: { prompt_version: version },
    data: items,
    maxConcurrency: 3,
    task: async (item) => {
      const id = (item as { id: string }).id;
      const r = await runInsideEval(() => e.run(item.input, ["eval"]));
      costs.set(id, r.runs.reduce((n, x) => n + x.costUsd, 0));
      if (r.data === null) errors.set(id, `agent returned nothing: ${r.error}`);
      return r.data;
    },
    evaluators: [
      async ({ output, metadata }) => {
        const def = defs.find((d) => d.id === (metadata as { item_id?: string } | undefined)?.item_id);
        if (!def) return { name: "eval_passed", value: 0, comment: "no check found for this item" };
        if (output === null || output === undefined) return { name: "eval_passed", value: 0, comment: "agent returned nothing" };
        try {
          const c: Check = def.check(output);
          return { name: "eval_passed", value: c.passed ? 1 : 0, comment: `${def.id}: ${c.detail}`.slice(0, 1000) };
        } catch (err) {
          return { name: "eval_passed", value: 0, comment: `check failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    ],
  });

  const out: EvalItemResult[] = result.itemResults.map((r) => {
    const id = (r.item as { id: string }).id;
    const ev = r.evaluations.find((x) => x.name === "eval_passed");
    return { id, passed: ev?.value === 1, costUsd: costs.get(id) ?? 0, detail: errors.get(id) ?? ev?.comment?.replace(`${id}: `, "") ?? "not evaluated", output: r.output };
  });
  return {
    agent,
    promptVersion: version,
    runName,
    passed: out.filter((x) => x.passed).length,
    total: out.length,
    costUsd: out.reduce((n, x) => n + x.costUsd, 0),
    url: result.datasetRunUrl ?? null,
    items: out,
  };
}
