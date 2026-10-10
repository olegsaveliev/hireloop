// Eval runner (docs/specs/10-langfuse-polish.md, part 4). Runs one agent's current prompt over its dataset: the items in
// src/evals/datasets.ts plus the recruiter's checkable corrections (Step 9, docs/specs/09-feedback-loop.md). See src/evals/run.ts.
// To compare prompt versions: run this, edit the prompt file in /prompts, run it again, then open the dataset
// in Langfuse (Datasets > <agent>), select both runs and compare them side by side.
// Run with: npm run eval -- <agent>              e.g. npm run eval -- reply-classifier
//           npm run eval -- <agent> --item <id>  one item only
//           npm run eval -- all                  every agent (~$0.50)
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { EVALS } = await import("@/evals/datasets");
  const { runEval } = await import("@/evals/run");
  const { flushTelemetry } = await import("@/agents/telemetry");

  const target = process.argv[2];
  const itemArg = process.argv.indexOf("--item");
  const onlyItem = itemArg > 0 ? process.argv[itemArg + 1] : undefined;
  const agents = target === "all" ? Object.keys(EVALS) : [target];
  if (!target || agents.some((a) => !EVALS[a])) {
    console.log(`Usage: npm run eval -- <agent|all> [--item <id>]\nAgents: ${Object.keys(EVALS).join(", ")}`);
    process.exit(1);
  }

  let totalFailed = 0;
  for (const agent of agents) {
    console.log(`\n=== ${agent} ===`);
    const r = await runEval(agent, { onlyItem });
    for (const it of r.items) {
      if (!it.passed) totalFailed++;
      console.log(`${it.passed ? "PASS" : "FAIL"}  ${it.id}  $${it.costUsd.toFixed(4)}\n      ${it.detail}`);
      // On a failure, show what the agent returned, so you can tell a bad output from a bad check.
      if (!it.passed && it.output) console.log(`      output: ${JSON.stringify(it.output).slice(0, 1200)}`);
    }
    console.log(`--- ${agent}: ${r.passed}/${r.total} passed, $${r.costUsd.toFixed(4)}, prompt_version ${r.promptVersion}, run "${r.runName}"`);
    if (r.url) console.log(`    ${r.url}`);
  }

  await flushTelemetry();
  process.exit(totalFailed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
