// Checks the cost-budget rules from CLAUDE.md with two tiny real Haiku runs (~$0.002 total).
// It lowers the connection-test budget in memory only (src/config/budgets.ts is not changed):
//   A) budget so actual cost lands between 1x and 3x  -> succeeded, flagged over budget
//   B) budget so actual cost is above 3x              -> stopped_over_budget, no output
// Run with: npm run test:budget
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { AGENT_BUDGETS } = await import("@/config/budgets");
  const { runAgent } = await import("@/agents/run-agent");
  const { loadPrompt } = await import("@/agents/prompts");
  const budget = AGENT_BUDGETS["connection-test"];
  const original = budget.budgetUsd;
  const systemPrompt = await loadPrompt("connection-test");
  const run = () =>
    runAgent({ agent: "connection-test", systemPrompt, prompt: "Are you online?", tags: ["phase-0", "budget-rule-test"] });

  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
    if (!ok) failures++;
  };

  try {
    // A normal run costs ~$0.0009, so $0.0005 puts it at ~1.9x.
    budget.budgetUsd = 0.0005;
    const a = await run();
    const ratioA = a.costUsd / a.budgetUsd;
    check("1x-3x: run completes", a.status === "succeeded" && a.output !== null, `status=${a.status}, ${ratioA.toFixed(2)}x`);
    check("1x-3x: flagged over budget", ratioA > 1 && ratioA <= 3, `cost $${a.costUsd.toFixed(5)} vs budget $${a.budgetUsd}`);

    // $0.0001 puts it far above 3x (the SDK's own limit is 3x = $0.0003).
    budget.budgetUsd = 0.0001;
    const b = await run();
    check("above 3x: run stopped", b.status === "stopped_over_budget", `status=${b.status}, ${(b.costUsd / b.budgetUsd).toFixed(1)}x`);
    check("above 3x: nothing returned to save", b.output === null, `output=${JSON.stringify(b.output)}`);

    const { db } = await import("@/lib/db");
    const rows = await db.agentRun.findMany({ where: { id: { in: [a.runId, b.runId] } } });
    check("both runs logged in agent_runs with over-budget flag", rows.length === 2 && rows.every((r) => r.overBudget), `${rows.length} rows`);
    // Langfuse: the over-budget tag must be on the run's own trace (not a separate one).
    await new Promise((r) => setTimeout(r, 8000)); // give Langfuse a few seconds to ingest
    for (const [label, run] of [["1x-3x", a], ["above 3x", b]] as const) {
      const tags = await traceTags(run.traceId);
      check(`${label}: Langfuse trace tagged over-budget`, tags.includes("over-budget"), `tags=${tags.join(",")}`);
    }
    console.log(`Traces: ${a.traceUrl}\n        ${b.traceUrl}`);
  } finally {
    budget.budgetUsd = original;
  }
  process.exit(failures ? 1 : 0);
}

// Reads trace tags via Langfuse's v2 observations API (the legacy traces API is unavailable to our org).
async function traceTags(traceId: string): Promise<string[]> {
  const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
  const params = new URLSearchParams({
    traceId,
    fromStartTime: new Date(Date.now() - 3600_000).toISOString(),
    toStartTime: new Date().toISOString(),
    fields: "core,basic,trace_context",
  });
  const res = await fetch(`${process.env.LANGFUSE_BASE_URL}/api/public/v2/observations?${params}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const body = (await res.json()) as { data?: { tags?: string[] }[] };
  return [...new Set((body.data ?? []).flatMap((o) => o.tags ?? []))];
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
