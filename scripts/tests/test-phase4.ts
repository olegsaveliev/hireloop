// Phase 4 tests (docs/specs/10-langfuse-polish.md "Test cases" + "Acceptance criteria"). Real Haiku runs, ~$0.02.
//   1. Score audit on current data -> every agent found, no problems
//   2. One enrichment run -> trace has prompt_version = hash of its prompt; runs inside an outer span get
//      their own top-level trace (the Next.js request bug fixed in Phase 4)
//   3. npm run eval -- reply-classifier -> dataset run created, eval_passed on each trace, no app data changed
//   4. Changing a prompt changes prompt_version (no AI)
//   5. Runs page quality numbers equal the averages of the matching Langfuse scores
// Plus: every dataset has 5+ items, the "Hireloop agents" dashboard exists with its widgets.
// Run with: npm run test:phase4
import { config } from "dotenv";
config({ path: ".env.local" });
import { execSync } from "node:child_process";

async function main() {
  const { db } = await import("@/lib/db");
  const { promptVersion } = await import("@/agents/run-agent");
  const { runAgent } = await import("@/agents/run-agent");
  const { loadPrompt } = await import("@/agents/prompts");
  const { runEnrichmentAgent } = await import("@/agents/enrichment/agent");
  const { fetchScores, fetchTraceContext } = await import("@/agents/langfuse-read");
  const { qualityPerAgent } = await import("@/lib/quality");
  const { EVALS } = await import("@/evals/datasets");
  const { getTelemetry, flushTelemetry } = await import("@/agents/telemetry");
  const { startActiveObservation } = await import("@langfuse/tracing");
  const { langfuse } = getTelemetry();
  const startedAt = new Date(Date.now() - 60_000);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
    if (!ok) failures++;
    return ok;
  };
  const sh = (cmd: string) => {
    try {
      return { ok: true, out: execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      return { ok: false, out: String((e as { stdout?: string }).stdout ?? e) };
    }
  };

  // ---------- 4. prompt version (no AI) ----------
  console.log("\n--- Prompt version (no AI) ---");
  const enrichmentPrompt = await loadPrompt("enrichment-agent");
  check("TC4 same prompt -> same version", promptVersion(enrichmentPrompt) === promptVersion(`${enrichmentPrompt}`), promptVersion(enrichmentPrompt));
  check("TC4 one character changed -> new version", promptVersion(enrichmentPrompt) !== promptVersion(`${enrichmentPrompt} `), `${promptVersion(enrichmentPrompt)} vs ${promptVersion(`${enrichmentPrompt} `)}`);

  // ---------- 2. prompt_version on a real trace + own top-level trace ----------
  console.log("\n--- Prompt version on a real run, own trace (Haiku) ---");
  const e = await runEnrichmentAgent({ candidateId: "cand-001", extraTags: ["test"] });
  const eRun = e.runs.at(-1)!;
  const row = await db.agentRun.findUniqueOrThrow({ where: { id: eRun.runId } });
  check("TC2 agent_runs.prompt_version = hash of prompt file", row.promptVersion === promptVersion(enrichmentPrompt), `${row.promptVersion}`);
  // Like a click in the app: Next.js has a request span open while the agent runs.
  const sp = await loadPrompt("connection-test");
  const ids = await startActiveObservation("outer-request", async (outer) => {
    const a = await runAgent({ agent: "connection-test", systemPrompt: sp, prompt: "ping", tags: ["test", "phase-4"] });
    const b = await runAgent({ agent: "connection-test", systemPrompt: sp, prompt: "ping", tags: ["test", "phase-4"] });
    return { outer: outer.traceId, a: a.traceId, b: b.traceId };
  });
  check("Runs inside an outer span get their own traces", new Set([ids.outer, ids.a, ids.b]).size === 3, `${ids.a.slice(0, 8)}, ${ids.b.slice(0, 8)} (outer ${ids.outer.slice(0, 8)})`);
  await flushTelemetry();
  let ctx = { tags: [] as string[], metadata: {} as Record<string, unknown> };
  for (let i = 0; i < 6 && !ctx.metadata.prompt_version; i++) {
    await sleep(5000); // Langfuse ingestion lag
    ctx = await fetchTraceContext(eRun.traceId, startedAt);
  }
  check("TC2 Langfuse trace metadata has prompt_version", ctx.metadata.prompt_version === row.promptVersion, `${ctx.metadata.prompt_version}`);

  // ---------- 3. eval runner ----------
  console.log("\n--- npm run eval -- reply-classifier (Haiku, ~$0.015) ---");
  const before = { messages: await db.message.count(), queue: await db.approvalItem.count(), jobs: await db.job.count() };
  const evalStart = new Date();
  const ev = sh("npm run eval -- reply-classifier");
  const runName = ev.out.match(/, run "([^"]+)"/)?.[1];
  check("TC3 eval command finished, all items passed", ev.ok, ev.out.match(/--- reply-classifier: .*/)?.[0] ?? ev.out.slice(-300));
  const after = { messages: await db.message.count(), queue: await db.approvalItem.count(), jobs: await db.job.count() };
  check("TC3 nothing new in messages, approval queue or jobs", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  const evalRuns = await db.agentRun.findMany({ where: { createdAt: { gte: evalStart }, agent: "reply-classifier" } });
  check("TC3 eval runs logged with isEval, no job", evalRuns.length >= EVALS["reply-classifier"].items.length && evalRuns.every((r) => r.isEval && !r.jobId), `${evalRuns.length} runs`);
  // Langfuse lists eval runs as "experiments" (its replacement for dataset runs); allow for ingestion lag.
  const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
  const get = async (path: string) => (await fetch(`${process.env.LANGFUSE_BASE_URL}${path}`, { headers: { Authorization: `Basic ${auth}` } })).json();
  let experiment: { name: string; itemCount: number } | undefined;
  for (let i = 0; i < 12; i++) {
    const list = (await get(`/api/public/experiments?fromStartTime=${encodeURIComponent(evalStart.toISOString())}`)) as { data?: { name: string; itemCount: number }[] };
    experiment = list.data?.find((x) => x.name === runName);
    if (experiment && experiment.itemCount === EVALS["reply-classifier"].items.length) break;
    await sleep(5000);
  }
  check("TC3 experiment in Langfuse with every item", experiment?.itemCount === EVALS["reply-classifier"].items.length, `"${runName}": ${experiment?.itemCount ?? "not found"} items`);
  // The scores API can lag a few minutes behind (Langfuse says so), so wait up to 3 minutes.
  let withScore = 0;
  for (let i = 0; i < 18; i++) {
    const found = await Promise.all(evalRuns.map(async (r) => (await fetchScores({ traceId: r.traceId! })).some((s) => s.name === "eval_passed")));
    withScore = found.filter(Boolean).length;
    if (withScore === evalRuns.length) break;
    await sleep(10_000);
  }
  check("TC3 eval_passed on each eval trace", withScore === evalRuns.length, `${withScore} of ${evalRuns.length}`);

  // ---------- 1. score audit ----------
  console.log("\n--- Score audit ---");
  const audit = sh("npm run check:langfuse");
  const agentsFound = Object.keys(EVALS).filter((a) => new RegExp(`^${a}: \\d+ runs`, "m").test(audit.out));
  check("TC1 audit: every agent found", agentsFound.length === 6, agentsFound.join(", "));
  check("TC1 audit: no problems (cost_vs_budget on every run, no unknown scores, own traces)", audit.ok && /No problems found/.test(audit.out), audit.out.match(/\d+ problem\(s\) found|No problems found/)?.[0] ?? "");

  // ---------- 5. quality table = Langfuse scores ----------
  console.log("\n--- Runs page quality vs Langfuse scores ---");
  const quality = Object.fromEntries((await qualityPerAgent()).map((q) => [q.agent, q]));
  const scoreOf = async (traceId: string | null, name: string) => (traceId ? (await fetchScores({ traceId })).filter((s) => s.name === name).map((s) => s.value) : []);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const same = (a: number | null, b: number | null) => (a === null ? b === null : b !== null && Math.abs(a - b) < 0.001);
  {
    const specs = await db.jobSpec.findMany({ where: { status: { in: ["approved", "rejected"] } } });
    const lf = (await Promise.all(specs.map((s) => scoreOf(s.traceId, "approved_without_edits")))).map((v) => v.at(-1)).filter((v) => v !== undefined);
    const q = quality["job-spec-agent"];
    check("TC5 job-spec approved without edits", same(q.value, avg(lf)) && q.n === lf.length, `app ${q.value} (n=${q.n}), Langfuse ${avg(lf)} (n=${lf.length})`);
  }
  {
    const drafts = await db.message.findMany({ where: { direction: "outbound", status: { in: ["sent", "rejected"] } } });
    const lf = (await Promise.all(drafts.filter((d) => d.agentDraft).map((d) => scoreOf(d.traceId, "approved_without_edits")))).flat();
    const q = quality["outreach-draft"];
    check("TC5 outreach approved without edits", same(q.value, avg(lf)) && q.n === lf.length, `app ${q.value} (n=${q.n}), Langfuse ${avg(lf)} (n=${lf.length})`);
  }
  {
    const replies = await db.message.findMany({ where: { direction: "inbound", classifierCorrect: { not: null } } });
    const lf = (await Promise.all(replies.map((r) => scoreOf(r.traceId, "classifier_correct")))).map((v) => v.at(-1)).filter((v) => v !== undefined);
    const q = quality["reply-classifier"];
    check("TC5 classifier correct", same(q.value, avg(lf)) && q.n === lf.length, `app ${q.value} (n=${q.n}), Langfuse ${avg(lf)} (n=${lf.length})`);
  }
  {
    const jobs = await db.job.findMany({ where: { recruiterAgreement: { not: null } } });
    const lf: number[] = [];
    for (const j of jobs) {
      const r = await db.screeningResult.findFirst({ where: { jobId: j.id, traceId: { not: null } } });
      const v = (await scoreOf(r?.traceId ?? null, "recruiter_agreement")).at(-1);
      if (v !== undefined) lf.push(v);
    }
    const q = quality["screening-agent"];
    check("TC5 screening recruiter agreement", same(q.value, avg(lf)) && q.n === lf.length, `app ${q.value} (n=${q.n}), Langfuse ${avg(lf)} (n=${lf.length})`);
  }

  // ---------- datasets and dashboard ----------
  console.log("\n--- Datasets and dashboard ---");
  for (const agent of Object.keys(EVALS)) {
    const items = await langfuse.api.datasetItems.list({ datasetName: agent, limit: 100 });
    check(`Dataset ${agent}: 5+ items`, items.data.length >= 5, `${items.data.length} items (${EVALS[agent].items.length} runnable by eval)`);
  }
  const dashboards = (await get("/api/public/unstable/dashboards?limit=50")) as { data: { id: string; name: string }[] };
  const dash = dashboards.data.find((d) => d.name === "Hireloop agents");
  const widgets = (await get("/api/public/unstable/dashboard-widgets?limit=50")) as { data: { name: string }[] };
  const nw = widgets.data.filter((w) => w.name.startsWith("NW · "));
  check('Dashboard "Hireloop agents" with its 7 widgets', !!dash && nw.length === 7, `${dash ? "found" : "missing"}, ${nw.length} widgets`);

  await flushTelemetry();
  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
