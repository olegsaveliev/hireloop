// Score audit (docs/specs/10-langfuse-polish.md, part 1). No AI calls, $0.
// For every agent run in agent_runs, reads that trace's scores back from Langfuse and compares them with
// src/config/langfuse-scores.ts. Prints, per agent: runs, and for each expected score how many traces have it.
// Also prints score names nobody expects (typos, strays).
// Run with: npm run check:langfuse            (all runs)
//           npm run check:langfuse -- --days 1 (only runs from the last day)
import { config } from "dotenv";
config({ path: ".env.local" });

const WHEN_LABEL = { "every-run": "every run", pipeline: "successful pipeline runs", human: "after a human action" } as const;

async function main() {
  const { db } = await import("@/lib/db");
  const { fetchScores } = await import("@/agents/langfuse-read");
  const { EXPECTED_SCORES, SHARED_SCORES, LEGACY_SCORE_PREFIXES } = await import("@/config/langfuse-scores");

  const daysArg = process.argv.indexOf("--days");
  const since = daysArg > 0 ? new Date(Date.now() - Number(process.argv[daysArg + 1]) * 86_400_000) : undefined;

  const runs = await db.agentRun.findMany({
    where: { traceId: { not: null }, agent: { not: "connection-test" }, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (runs.length === 0) {
    console.log("No agent runs to check.");
    return;
  }
  const first = runs[0].createdAt;
  // Scores are timestamped when written, which is at or after the run started.
  const scores = await fetchScores({ since: new Date(first.getTime() - 60_000) });
  const byTrace = new Map<string, Set<string>>();
  for (const s of scores) {
    if (!s.traceId) continue;
    if (!byTrace.has(s.traceId)) byTrace.set(s.traceId, new Set());
    byTrace.get(s.traceId)!.add(s.name);
  }

  // Every run must have its own trace. Before Phase 4, runs started from a click in the app could share the
  // web request's trace (fixed in src/agents/run-agent.ts). Shared traces from before the fix are reported as known.
  // Eval runs are left out of this: each sits inside its dataset item's trace, with a schema retry if needed.
  const runsPerTrace = new Map<string, typeof runs>();
  for (const r of runs.filter((x) => !x.isEval)) runsPerTrace.set(r.traceId!, [...(runsPerTrace.get(r.traceId!) ?? []), r]);
  const shared = [...runsPerTrace.entries()].filter(([, rs]) => rs.length > 1);
  const isShared = (traceId: string) => (runsPerTrace.get(traceId)?.length ?? 0) > 1;
  const isLegacy = (name: string) => LEGACY_SCORE_PREFIXES.some((p) => name.startsWith(p));

  console.log(`Checked ${runs.length} runs since ${first.toISOString().slice(0, 16)} against ${scores.length} Langfuse scores.\n`);
  let errors = 0;
  const unexpected = new Map<string, number>();
  let legacyScores = 0;

  for (const [agent, expected] of Object.entries(EXPECTED_SCORES)) {
    const agentRuns = runs.filter((r) => r.agent === agent);
    console.log(`${agent}: ${agentRuns.length} runs`);
    if (agentRuns.length === 0) {
      console.log("  (no runs yet)\n");
      continue;
    }
    for (const [name, when] of Object.entries(expected)) {
      const have = agentRuns.filter((r) => byTrace.get(r.traceId!)?.has(name)).length;
      const gap = when === "every-run" && have < agentRuns.length;
      if (gap) errors++;
      console.log(`  ${gap ? "MISSING" : "ok     "}  ${name.padEnd(24)} ${String(have).padStart(3)} of ${agentRuns.length}  (${WHEN_LABEL[when]})`);
    }
    const allowed = new Set([...Object.keys(expected), ...SHARED_SCORES]);
    for (const r of agentRuns) {
      // On a shared trace, other agents' scores show up too; that's reported once below, not per score.
      if (isShared(r.traceId!)) continue;
      for (const name of byTrace.get(r.traceId!) ?? []) {
        if (isLegacy(name)) {
          legacyScores++;
          continue;
        }
        if (!allowed.has(name)) unexpected.set(`${agent} / ${name}`, (unexpected.get(`${agent} / ${name}`) ?? 0) + 1);
      }
    }
    console.log();
  }

  const legacyShared = shared.filter(([, rs]) => rs.every((r) => r.promptVersion === null));
  const newShared = shared.filter(([, rs]) => rs.some((r) => r.promptVersion !== null));
  for (const [traceId, rs] of newShared) {
    console.log(`MISSING  own trace: ${rs.length} runs share trace ${traceId} (${[...new Set(rs.map((r) => r.agent))].join(", ")})`);
    errors++;
  }
  if (legacyShared.length) {
    console.log(`Known, from before Phase 4: ${legacyShared.length} trace(s) shared by several runs (${legacyShared.map(([, rs]) => rs.length).join(" + ")} runs).`);
  }
  if (legacyScores) console.log(`Known, from before Phase 4: ${legacyScores} old per-test score names (test_passed:<id>).`);

  if (unexpected.size) {
    console.log("Scores not listed in src/config/langfuse-scores.ts:");
    for (const [k, n] of unexpected) console.log(`  ${k}  (${n} traces)`);
    errors += unexpected.size;
  } else {
    console.log("No unexpected score names.");
  }

  console.log(errors ? `\n${errors} problem(s) found.` : "\nNo problems found.");
  process.exitCode = errors ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
