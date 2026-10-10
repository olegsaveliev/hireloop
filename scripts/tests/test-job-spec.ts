// Step 1 tests (docs/specs/01-job-spec-agent.md "Test cases" + "Acceptance criteria"). Real Sonnet runs, ~$0.10 total.
//   1. Clear brief (brief-001)            -> full spec, 0-1 open questions
//   2. Vague brief (brief-003)            -> mostly open questions (at least 2)
//   3. Contradictory seniority (brief-002) -> contradiction listed in open_questions, seniority not picked
//   4. Two roles (brief-002)              -> two specs
// Plus the approval flow: approve (with one edit) creates a job; reject with a comment regenerates.
// The 4 test cases are also kept in sync as the Langfuse dataset "job-spec-agent", and every test run
// is linked to its dataset item (Langfuse > Datasets > job-spec-agent > Runs).
// Run with: npm run test:job-spec
import { config } from "dotenv";
config({ path: ".env.local" });

const DATASET = "job-spec-agent";

const CASES = [
  {
    id: "job-spec-tc1-clear-brief",
    briefId: "brief-001",
    name: "Clear brief (Senior Python, AWS, remote PL/UA, rate given)",
    expected: "One full spec: senior, Python + AWS must-haves, no-AWS dealbreaker, rate $55-65/hr, 0-1 open questions.",
  },
  {
    id: "job-spec-tc2-vague-brief",
    briefId: "brief-003",
    name: "Vague brief ('need a strong backend dev asap')",
    expected: "Minimal spec, mostly open questions (at least 2, and more open questions than must-haves). Rate flagged.",
  },
  {
    id: "job-spec-tc3-contradiction",
    briefId: "brief-002",
    name: "Contradictory seniority ('junior' + '8+ years')",
    expected: "Frontend spec: seniority not picked (null); contradiction listed in open_questions.",
  },
  {
    id: "job-spec-tc4-two-roles",
    briefId: "brief-002",
    name: "Brief with two roles",
    expected: "Two specs (embedded Rust, frontend React), and a note saying so.",
  },
] as const;

async function main() {
  const { db } = await import("@/lib/db");
  const { generateJobSpecs } = await import("@/agents/job-spec/agent");
  const { approveSpec, rejectSpec } = await import("@/agents/job-spec/workflow");
  const { getTelemetry, flushTelemetry } = await import("@/agents/telemetry");
  const { langfuse } = getTelemetry();

  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
    if (!ok) failures++;
    return ok;
  };

  // ---------- Langfuse dataset: items are defined in src/evals/datasets.ts (same ids as CASES) ----------
  const { syncDataset } = await import("@/evals/datasets");
  await syncDataset(langfuse, DATASET);
  const runName = `test-job-spec ${new Date().toISOString().slice(0, 16)}`;

  // ---------- one agent run per brief (brief-002 covers test cases 3 and 4) ----------
  const results = new Map<string, Awaited<ReturnType<typeof generateJobSpecs>>>();
  for (const briefId of ["brief-001", "brief-002", "brief-003"]) {
    const r = await generateJobSpecs(briefId, { extraTags: ["test"] });
    results.set(briefId, r);
    const cost = r.runs.reduce((n, x) => n + x.costUsd, 0);
    check(`AC1 ${briefId}: valid JSON`, r.data !== null, `${r.error ?? "ok"}, ${r.runs.length} run(s), $${cost.toFixed(4)}`);
  }

  const outcomes: Record<string, boolean> = {};
  const lower = (xs: string[]) => xs.join(" | ").toLowerCase();

  // Test case 1
  {
    const d = results.get("brief-001")!.data;
    const s = d?.specs[0];
    outcomes[CASES[0].id] = [
      check("TC1 one spec", d?.specs.length === 1, `${d?.specs.length} spec(s)`),
      check("TC1 senior", s?.seniority === "senior", `${s?.seniority}`),
      check("TC1 Python + AWS must-haves", !!s && /python/.test(lower(s.must_have)) && /aws/.test(lower(s.must_have)), s?.must_have.join(", ") ?? ""),
      check("TC1 no-AWS dealbreaker", !!s && /aws/.test(lower(s.dealbreakers)), s?.dealbreakers.join(", ") ?? ""),
      check("TC1 rate from brief", !!s?.rate_range && /55/.test(s.rate_range) && /65/.test(s.rate_range), `${s?.rate_range}`),
      check("TC1 0-1 open questions", !!s && s.open_questions.length <= 1, JSON.stringify(s?.open_questions)),
    ].every(Boolean);
  }
  // Test case 2 (also AC2: vague brief -> at least 2 open questions)
  {
    const d = results.get("brief-003")!.data;
    const s = d?.specs[0];
    outcomes[CASES[1].id] = [
      check("TC2 at least 2 open questions (AC2)", !!s && s.open_questions.length >= 2, `${s?.open_questions.length} questions`),
      check(
        "TC2 mostly open questions",
        !!s && s.open_questions.length > s.must_have.length,
        `${s?.open_questions.length} questions vs ${s?.must_have.length} must-haves: ${s?.must_have.join(", ")}`,
      ),
      check("TC2 rate not guessed silently", !!s && (s.rate_range === null || /rate/.test(lower(s.open_questions))), `${s?.rate_range}`),
    ].every(Boolean);
  }
  // Test cases 3 and 4
  {
    const d = results.get("brief-002")!.data;
    const frontend = d?.specs.find((s) => /front|react/i.test(s.title));
    const rust = d?.specs.find((s) => /rust|embedded|firmware/i.test(s.title));
    outcomes[CASES[2].id] = [
      check("TC3 frontend seniority not picked", frontend?.seniority === null, `${frontend?.seniority}`),
      check(
        "TC3 contradiction in open questions",
        !!frontend && frontend.open_questions.some((q) => /junior/i.test(q) && /8/.test(q)),
        JSON.stringify(frontend?.open_questions),
      ),
    ].every(Boolean);
    outcomes[CASES[3].id] = [
      check("TC4 two specs", d?.specs.length === 2 && !!frontend && !!rust, d?.specs.map((s) => s.title).join(" / ") ?? ""),
      check("TC4 says so in note", !!d?.note && /two|2/i.test(d.note), `${d?.note}`),
    ].every(Boolean);
  }

  // Link each run to its dataset item, with a pass/fail score on the trace.
  for (const c of CASES) {
    const runs = results.get(c.briefId)!.runs;
    const traceId = runs[runs.length - 1].traceId;
    await langfuse.api.datasetRunItems.create({ runName, datasetItemId: c.id, traceId });
    langfuse.score.create({ traceId, name: "test_passed", value: outcomes[c.id] ? 1 : 0, comment: c.id });
  }

  // ---------- AC3: approval flow (approve creates a job; reject regenerates) ----------
  const created: { specIds: string[]; jobIds: string[] } = { specIds: [], jobIds: [] };
  const r1 = results.get("brief-001")!;
  if (r1.data) {
    const insert = async () => {
      const spec = r1.data!.specs[0];
      const row = await db.jobSpec.create({
        data: {
          briefId: "brief-001",
          clientId: "client-brightline",
          status: "awaiting_approval",
          agentDraft: spec,
          spec,
          answers: [],
          agentRunIds: r1.runs.map((r) => r.runId),
          traceId: r1.runs[r1.runs.length - 1].traceId,
        },
      });
      await db.approvalItem.create({
        data: { kind: "job_spec", step: 1, status: "awaiting_approval", title: `TEST ${spec.title}`, jobSpecId: row.id },
      });
      created.specIds.push(row.id);
      return { row, spec };
    };

    const a = await insert();
    const approved = await approveSpec(a.row.id, { ...a.spec, rate_range: "$60-65/hr" }, []);
    const job = await db.job.findUnique({ where: { jobSpecId: a.row.id } });
    if (job) created.jobIds.push(job.id);
    const aRow = await db.jobSpec.findUniqueOrThrow({ where: { id: a.row.id } });
    check("AC3 approve: job created", approved.ok && job?.status === "ready_for_sourcing", approved.message);
    check("AC3 approve: 1 field edited counted", aRow.fieldsEdited === 1, `fieldsEdited=${aRow.fieldsEdited}`);
    const aItem = await db.approvalItem.findFirst({ where: { jobSpecId: a.row.id } });
    check("AC3 approve: left the queue", aItem?.status === "approved", `${aItem?.status}`);

    const b = await insert();
    const rejected = await rejectSpec(b.row.id, "Client confirmed English must be C1. Add it as a must-have.");
    const bRow = await db.jobSpec.findUniqueOrThrow({ where: { id: b.row.id } });
    const regenerated = rejected.specId ? await db.jobSpec.findUnique({ where: { id: rejected.specId } }) : null;
    if (regenerated) created.specIds.push(regenerated.id);
    check("AC3 reject: old spec rejected with comment", bRow.status === "rejected" && !!bRow.rejectComment, `${bRow.status}`);
    check(
      "AC3 reject: new draft waiting, uses comment",
      regenerated?.status === "awaiting_approval" &&
        regenerated.previousSpecId === b.row.id &&
        /c1/i.test(JSON.stringify((regenerated.spec as { must_have: string[] }).must_have)),
      rejected.message,
    );
  }

  // ---------- Apply answers: typed answers must end up in the spec fields ----------
  const r3 = results.get("brief-003")!;
  if (r3.data) {
    const { applyAnswers } = await import("@/agents/job-spec/workflow");
    const draft = r3.data.specs[0];
    const row = await db.jobSpec.create({
      data: {
        briefId: "brief-003",
        clientId: "client-kestrel",
        status: "awaiting_approval",
        agentDraft: draft,
        spec: draft,
        answers: [],
        agentRunIds: r3.runs.map((r) => r.runId),
        traceId: r3.runs[r3.runs.length - 1].traceId,
      },
    });
    created.specIds.push(row.id);
    const find = (re: RegExp) => draft.open_questions.find((q) => re.test(q));
    const qSeniority = find(/seniority|level|senior/i);
    const qLocation = find(/remote|on-site|location|work from/i);
    const qStack = find(/stack|technolog|language/i);
    const answered = [
      qSeniority && { question: qSeniority, answer: "Senior" },
      qLocation && { question: qLocation, answer: "Fully remote, CET working hours" },
      qStack && { question: qStack, answer: "Required: Kotlin, Spring Boot, PostgreSQL" },
    ].filter((x): x is { question: string; answer: string } => !!x);
    check("Apply: test has questions to answer", answered.length >= 2, `${answered.length} answerable question(s) found`);

    const applyResult = await applyAnswers(row.id, draft, answered);
    const u = applyResult.spec;
    check("Apply: run succeeded", applyResult.ok && !!u, applyResult.message);
    if (u) {
      if (qSeniority) check("Apply: seniority set to senior", u.seniority === "senior", `${u.seniority}`);
      if (qLocation) check("Apply: location says remote", /remote/i.test(u.location.join(" ")), JSON.stringify(u.location));
      if (qStack) check("Apply: stack in must-haves", /kotlin/i.test(u.must_have.join(" ")), JSON.stringify(u.must_have));
      check(
        "Apply: answered questions removed",
        answered.every((a) => !u.open_questions.includes(a.question)),
        `${draft.open_questions.length} -> ${u.open_questions.length} open`,
      );
      check("Apply: unrelated fields unchanged", u.title === draft.title, `${u.title}`);
    }
    const afterRow = await db.jobSpec.findUniqueOrThrow({ where: { id: row.id } });
    check("Apply: run cost recorded on the spec", (afterRow.agentRunIds as string[]).length > r3.runs.length, `${(afterRow.agentRunIds as string[]).length} run id(s)`);
  }

  // ---------- Runaway: above 3x budget -> nothing saved, "Stopped: over budget" in the queue ----------
  {
    const { AGENT_BUDGETS } = await import("@/config/budgets");
    const budget = AGENT_BUDGETS["job-spec-agent"];
    const original = budget.budgetUsd;
    budget.budgetUsd = 0.0005; // in memory only: any real run is far above 3x this
    try {
      const before = await db.jobSpec.count();
      const { createSpecsFromBrief } = await import("@/agents/job-spec/workflow");
      const r = await createSpecsFromBrief("brief-003", { allowExisting: true });
      const item = await db.approvalItem.findFirst({ where: { kind: "stopped_run", briefId: "brief-003" }, orderBy: { createdAt: "desc" } });
      check("Runaway: nothing saved", !r.ok && /over budget/i.test(r.message) && (await db.jobSpec.count()) === before, r.message);
      check("Runaway: 'Stopped: over budget' in approval queue", item?.title === "Stopped: over budget" && item.status === "awaiting_approval", `${item?.title}`);
      if (item) await db.approvalItem.delete({ where: { id: item.id } });
    } finally {
      budget.budgetUsd = original;
    }
  }

  await flushTelemetry();
  // Remove the test rows so the app's queue and jobs stay clean (agent_runs keep their real cost).
  await db.approvalItem.deleteMany({ where: { jobSpecId: { in: created.specIds } } });
  await db.job.deleteMany({ where: { id: { in: created.jobIds } } });
  await db.agentRun.updateMany({ where: { jobId: { in: created.jobIds } }, data: { jobId: null } });
  await db.jobSpec.deleteMany({ where: { id: { in: created.specIds } } });

  const total = await db.agentRun.aggregate({
    where: { createdAt: { gte: new Date(Date.now() - 30 * 60_000) }, agent: "job-spec-agent" },
    _sum: { costUsd: true },
  });
  console.log(`\nLangfuse dataset "${DATASET}", run "${runName}"`);
  console.log(`Job spec agent cost in the last 30 min: $${(total._sum.costUsd ?? 0).toFixed(4)}`);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
