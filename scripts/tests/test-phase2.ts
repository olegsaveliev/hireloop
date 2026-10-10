// Steps 2-4 tests (specs/02, 03, 04 "Test cases" + "Acceptance criteria"). Real Sonnet/Haiku/Opus runs, ~$0.50 total.
//   Sourcing:   1. Python/AWS spec -> mostly Python profiles   2. Niche Rust + embedded -> few results, broadening
//               3. Re-run on the same job -> 0 new duplicates   (+ same person under two ids is added once)
//   Enrichment: 1. Complete English profile -> 0 missing fields  2. Ukrainian profile -> English output
//               3. No contacts -> contacts null, in missing_fields  (+ Polish profile, overlapping dates, protected attributes)
//   Screening:  1. Perfect fit -> 85+   2. Dealbreaker -> 20 or less   3. Thin profile -> low confidence
// Plus: end-to-end pipeline + shortlist approval, the job budget hard stop, grouped "Stopped" items, the pre-filter.
// Test cases are kept in sync as Langfuse datasets "sourcing-agent", "enrichment-agent", "screening-agent",
// and every test run is linked to its dataset item.
// Run with: npm run test:phase2
import { config } from "dotenv";
config({ path: ".env.local" });

import type { JobSpecData } from "@/agents/job-spec/schema";
import { toTestInbox } from "@/lib/test-inbox";

// Test specs, written as a recruiter would approve them from the 3 seed briefs.
const SPECS: Record<string, { briefId: string; clientId: string; spec: JobSpecData }> = {
  python: {
    briefId: "brief-001",
    clientId: "client-brightline",
    spec: {
      title: "Senior Python Engineer (Payments Reconciliation)",
      seniority: "senior",
      must_have: ["Python", "FastAPI or Django", "AWS (Lambda, SQS, RDS Postgres)", "Production on-call experience", "B2B contract"],
      nice_to_have: ["Terraform", "Fintech/payments background", "Kafka", "PCI DSS"],
      dealbreakers: ["No commercial AWS experience"],
      location: ["Remote from Poland or Ukraine", "~4h overlap with New York (until ~7pm CET)"],
      rate_range: "$55-65/hr",
      selling_points: ["12 months with extension", "Payments domain"],
      open_questions: [],
    },
  },
  rust: {
    briefId: "brief-002",
    clientId: "client-haldor",
    spec: {
      title: "Embedded Rust Firmware Engineer (Telematics)",
      seniority: null,
      must_have: ["Embedded Rust (no_std, Embassy or RTIC)", "CAN bus", "B2B contract"],
      nice_to_have: ["STM32", "Yocto"],
      dealbreakers: [],
      location: ["Remote, EU time zone", "On-site in Munich one week per quarter"],
      rate_range: null,
      selling_points: ["Rewrite from C to Rust"],
      open_questions: [],
    },
  },
  kotlin: {
    briefId: "brief-003",
    clientId: "client-kestrel",
    spec: {
      title: "Senior Backend Developer (Kotlin)",
      seniority: "senior",
      must_have: ["Kotlin", "Spring Boot", "PostgreSQL"],
      nice_to_have: ["Kafka"],
      dealbreakers: [],
      location: ["Fully remote", "CET time zone"],
      rate_range: null,
      selling_points: [],
      open_questions: [],
    },
  },
};

const DATASETS = {
  sourcing: { name: "sourcing-agent", description: "Step 2 sourcing agent: test cases from docs/specs/02-sourcing-agent.md" },
  enrichment: { name: "enrichment-agent", description: "Step 3 enrichment agent: test cases from docs/specs/03-enrichment-agent.md" },
  screening: { name: "screening-agent", description: "Step 4 screening agent: test cases from docs/specs/04-screening-agent.md" },
} as const;

async function main() {
  const { db } = await import("@/lib/db");
  const { personKey, locationTerms } = await import("@/lib/candidates");
  const { runPipeline, approveShortlist, continueOverBudget, editSpecAndResource } = await import("@/agents/pipeline/workflow");
  const { runEnrichmentAgent, yearsFromHistory } = await import("@/agents/enrichment/agent");
  const { runScreeningAgent } = await import("@/agents/screening/agent");
  const { prefilter } = await import("@/agents/screening/prefilter");
  const { AGENT_BUDGETS, JOB_BUDGET_USD } = await import("@/config/budgets");
  const { getTelemetry, flushTelemetry } = await import("@/agents/telemetry");
  const { langfuse } = getTelemetry();
  const startedAt = new Date();

  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
    if (!ok) failures++;
    return ok;
  };
  const runName = `test-phase2 ${new Date().toISOString().slice(0, 16)}`;
  // Dataset items and the trace each test run produced: [dataset, item id, name, input, expected, traceId, passed].
  const datasetRuns: { dataset: string; id: string; name: string; input: unknown; expected: string; traceId?: string; passed: boolean }[] = [];

  // ---------- unit checks (no AI, free) ----------
  console.log("\n--- Unit checks (no AI) ---");
  check("Years: overlap counted once", yearsFromHistory(
    [
      { title: "a", company: "x", start: "2021-01", end: "2022-12", part_time: false },
      { title: "b", company: "y", start: "2020-06", end: "2022-12", part_time: true },
    ],
    new Date("2026-10-06"),
  ) === 2.6, "Jun 2020-Dec 2022 = 2.6 years, not 4.6");
  const c14 = await db.candidate.findUniqueOrThrow({ where: { id: "cand-014" } });
  const c15 = await db.candidate.findUniqueOrThrow({ where: { id: "cand-015" } });
  check("Dedupe: cand-014 and cand-015 are the same person", personKey(c14) === personKey(c15), personKey(c14));
  check("Location filter from 'Remote from Poland or Ukraine'", locationTerms(SPECS.python.spec.location).length > 2, locationTerms(SPECS.python.spec.location).slice(0, 4).join(", "));
  check("No location filter from 'Remote, EU time zone'", locationTerms(SPECS.rust.spec.location).length === 0, "[]");

  // ---------- test jobs ----------
  const jobIds: Record<string, string> = {};
  const specIds: string[] = [];
  for (const [key, f] of Object.entries(SPECS)) {
    const spec = await db.jobSpec.create({
      data: { briefId: f.briefId, clientId: f.clientId, status: "approved", agentDraft: f.spec, spec: f.spec, agentRunIds: [], decidedAt: new Date() },
    });
    specIds.push(spec.id);
    const job = await db.job.create({ data: { jobSpecId: spec.id, clientId: f.clientId, title: `[test] ${f.spec.title}`, status: "ready_for_sourcing" } });
    jobIds[key] = job.id;
  }
  const allJobIds = Object.values(jobIds);
  const pipelineOf = async (jobId: string) => {
    const entries = await db.pipelineEntry.findMany({ where: { jobId } });
    const cands = await db.candidate.findMany({ where: { id: { in: entries.map((e) => e.candidateId) } } });
    return { entries, cands };
  };
  const lastRun = (jobId: string, agent: string) => db.agentRun.findFirst({ where: { jobId, agent }, orderBy: { createdAt: "desc" } });

  try {
    // ---------- Step 2: sourcing ----------
    console.log("\n--- Step 2: sourcing (Sonnet) ---");
    for (const key of ["python", "rust", "kotlin"]) {
      const r = await runPipeline(jobIds[key], { stopAfter: "sourcing", extraTags: ["test"] });
      const job = await db.job.findUniqueOrThrow({ where: { id: jobIds[key] } });
      const { cands } = await pipelineOf(jobIds[key]);
      const run = await lastRun(jobIds[key], "sourcing-agent");
      const keys = new Set(cands.map(personKey));
      console.log(`      ${key}: ${cands.length} candidate(s), $${run?.costUsd.toFixed(4)}, note: ${job.pipelineNote}`);
      if (key === "rust") {
        check("AC1 rust (niche): at least 1 candidate", cands.length >= 1, `${cands.length}${r.ok ? "" : ` ${r.message}`}`);
      } else {
        check(`AC1 ${key}: 5-20 candidates`, cands.length >= 5 && cands.length <= 20, `${cands.length}`);
      }
      check(`AC2 ${key}: no duplicate people`, keys.size === cands.length, `${keys.size} people / ${cands.length} rows`);
      if (key === "python") {
        const py = cands.filter((c) => /python/i.test(c.rawProfile)).length;
        const ok = check("TC1 Python/AWS spec -> mostly Python profiles", py / Math.max(1, cands.length) >= 0.7, `${py} of ${cands.length} mention Python`);
        datasetRuns.push({ dataset: DATASETS.sourcing.name, id: "sourcing-tc1-python-aws", name: "Python/AWS spec", input: SPECS.python.spec, expected: "5-20 candidates, mostly Python profiles, no duplicates", traceId: run?.traceId ?? undefined, passed: ok });
      }
      if (key === "rust") {
        const ids = cands.map((c) => c.id);
        const ok = [
          check("TC2 niche spec -> broadening triggered", /broadened/i.test(job.pipelineNote ?? ""), `${job.pipelineNote}`),
          check("TC2 niche spec -> the embedded Rust engineer (cand-011) found", ids.includes("cand-011"), ids.join(", ")),
          check("TC2 niche spec -> few results", cands.length <= 10, `${cands.length}`),
        ].every(Boolean);
        datasetRuns.push({ dataset: DATASETS.sourcing.name, id: "sourcing-tc2-niche-rust", name: "Niche spec (embedded Rust)", input: SPECS.rust.spec, expected: "Few results, broadening triggered, cand-011 found", traceId: run?.traceId ?? undefined, passed: ok });
      }
      if (key === "kotlin") {
        const ids = cands.map((c) => c.id);
        check("Kotlin spec: same person under two ids added once", !(ids.includes("cand-014") && ids.includes("cand-015")), ids.filter((i) => i === "cand-014" || i === "cand-015").join(", ") || "neither");
      }
    }
    // TC3: re-run sourcing on the same job.
    {
      const before = await pipelineOf(jobIds.python);
      await db.job.update({ where: { id: jobIds.python }, data: { status: "ready_for_sourcing" } });
      await runPipeline(jobIds.python, { stopAfter: "sourcing", extraTags: ["test", "rerun"] });
      const after = await pipelineOf(jobIds.python);
      const keys = new Set(after.cands.map(personKey));
      const run = await lastRun(jobIds.python, "sourcing-agent");
      const ok = check("TC3 re-run on same job -> 0 new duplicates", keys.size === after.cands.length && after.entries.length >= before.entries.length, `${before.entries.length} -> ${after.entries.length} rows, ${keys.size} people`);
      datasetRuns.push({ dataset: DATASETS.sourcing.name, id: "sourcing-tc3-rerun", name: "Re-run on same job", input: { job: "python", rerun: true }, expected: "0 new duplicates", traceId: run?.traceId ?? undefined, passed: ok });
    }

    // ---------- Step 3: enrichment (direct runs, not saved) ----------
    console.log("\n--- Step 3: enrichment (Haiku) ---");
    const profiles: Record<string, NonNullable<Awaited<ReturnType<typeof runEnrichmentAgent>>["data"]>> = {};
    const enrichTrace: Record<string, string | undefined> = {};
    for (const id of ["cand-001", "cand-004", "cand-009", "cand-010", "cand-013", "cand-005", "cand-003", "cand-008"]) {
      const r = await runEnrichmentAgent({ candidateId: id, extraTags: ["test"] });
      enrichTrace[id] = r.runs.at(-1)?.traceId;
      const cost = r.runs.reduce((n, x) => n + x.costUsd, 0);
      check(`${id}: valid profile`, !!r.data, `${r.error ?? "ok"}, $${cost.toFixed(4)}`);
      if (r.data) profiles[id] = r.data;
    }
    const p = profiles;
    const cyrillic = /[Ѐ-ӿ]/;
    const valuesOf = (x: unknown): string => JSON.stringify(x);
    {
      const ok = check("TC1 complete English profile -> 0 missing fields", p["cand-001"]?.missing_fields.length === 0, `missing: ${p["cand-001"]?.missing_fields.join(", ")}`);
      datasetRuns.push({ dataset: DATASETS.enrichment.name, id: "enrichment-tc1-complete", name: "Complete English profile (cand-001)", input: { candidate_id: "cand-001" }, expected: "0 missing fields", traceId: enrichTrace["cand-001"], passed: ok });
    }
    {
      const u = p["cand-004"];
      // Everything except the name-bearing fields (names stay as written).
      const rest = u ? { ...u, candidate_id: "", contacts: null, job_history: u.job_history.map((j) => ({ ...j, company: "" })) } : null;
      const ok = [
        check("TC2 Ukrainian profile -> English output (no Cyrillic outside the name)", !!u && !cyrillic.test(valuesOf(rest)), `${u?.current_title} / ${u?.location}`),
        check("TC2 Ukrainian profile -> skills extracted", !!u && u.skills.some((s) => /python/i.test(s)), u?.skills.join(", ") ?? ""),
      ].every(Boolean);
      datasetRuns.push({ dataset: DATASETS.enrichment.name, id: "enrichment-tc2-ukrainian", name: "Ukrainian-language profile (cand-004)", input: { candidate_id: "cand-004" }, expected: "English output", traceId: enrichTrace["cand-004"], passed: ok });
    }
    {
      const n = p["cand-009"];
      // The no-contacts case (TC3) is in the eval dataset with cand-009's email line removed (src/evals/datasets.ts).
      check("Email in the header line extracted, no LinkedIn -> listed in missing_fields", !!n && n.contacts.email === toTestInbox("test.inbox+9@example.com") && n.contacts.linkedin === null && n.missing_fields.includes("contacts.linkedin"), `${JSON.stringify(n?.contacts)}, missing: ${n?.missing_fields.join(", ")}`);
    }
    {
      const y = p["cand-010"]?.years_experience ?? 0;
      check("Overlapping dates counted once (cand-010: Jun 2019-now, ~7.3y, not ~9.8y)", y >= 6.8 && y <= 7.8, `${y}`);
      const pl = p["cand-005"];
      check("Polish profile -> English output", !!pl && !/programista|Doświadczenie|obecnie/i.test(valuesOf({ ...pl, candidate_id: "" })), `${pl?.current_title} / ${pl?.location}`);
      const y13 = valuesOf(p["cand-013"]).toLowerCase();
      check("Protected attributes not stored (cand-013: age, married, kids)", !!p["cand-013"] && !/\b34\b|married|kids|children|years old/.test(y13), p["cand-013"]?.key_facts.join(" | ") ?? "");
      check("English level not guessed (cand-008 thin profile)", p["cand-008"]?.english_level === null, `${p["cand-008"]?.english_level}`);
    }

    // ---------- pre-filter (no AI) ----------
    console.log("\n--- Pre-filter (no AI) ---");
    if (p["cand-001"]) {
      const pf = prefilter(SPECS.rust.spec.must_have, p["cand-001"]);
      check("Pre-filter: Python dev vs embedded Rust spec -> filtered out", !pf.pass, pf.pass ? "passed" : pf.reason);
      check("Pre-filter: Python dev vs Python spec -> passes", prefilter(SPECS.python.spec.must_have, p["cand-001"]).pass, "");
    }
    if (p["cand-008"]) check("Pre-filter: thin profile mentioning Python passes (lenient)", prefilter(SPECS.python.spec.must_have, p["cand-008"]).pass, p["cand-008"].skills.join(", "));

    // ---------- Step 4: screening (direct runs, not saved) ----------
    console.log("\n--- Step 4: screening (Opus, effort low) ---");
    const screen = async (id: string) => {
      if (!p[id]) return null;
      const r = await runScreeningAgent({ jobId: jobIds.python, clientId: SPECS.python.clientId, spec: SPECS.python.spec, profile: p[id], extraTags: ["test"] });
      const cost = r.runs.reduce((n, x) => n + x.costUsd, 0);
      console.log(`      ${id}: score ${r.data?.score}, ${r.data?.confidence}, dealbreaker ${r.data?.dealbreaker_hit}, $${cost.toFixed(4)}\n        ${r.data?.reasons}`);
      return { ...r, traceId: r.runs.at(-1)?.traceId };
    };
    {
      const r = await screen("cand-001");
      const ok = check("TC1 perfect fit -> 85+", (r?.data?.score ?? 0) >= 85, `${r?.data?.score}`);
      datasetRuns.push({ dataset: DATASETS.screening.name, id: "screening-tc1-perfect-fit", name: "Perfect fit (cand-001 vs Python/AWS spec)", input: { candidate_id: "cand-001", spec: SPECS.python.spec }, expected: "score 85+", traceId: r?.traceId, passed: ok });
    }
    {
      const r = await screen("cand-003");
      const ok = check("TC2 dealbreaker -> 20 or less", !!r?.data && r.data.score <= 20 && !!r.data.dealbreaker_hit, `${r?.data?.score}, ${r?.data?.dealbreaker_hit}`);
      datasetRuns.push({ dataset: DATASETS.screening.name, id: "screening-tc2-dealbreaker", name: "Dealbreaker: GCP only, no commercial AWS (cand-003)", input: { candidate_id: "cand-003", spec: SPECS.python.spec }, expected: "score 20 or less, dealbreaker_hit set", traceId: r?.traceId, passed: ok });
    }
    {
      const r = await screen("cand-008");
      const ok = check("TC3 thin profile -> low confidence", r?.data?.confidence === "low", `${r?.data?.confidence}, score ${r?.data?.score}`);
      datasetRuns.push({ dataset: DATASETS.screening.name, id: "screening-tc3-thin-profile", name: "Thin profile (cand-008)", input: { candidate_id: "cand-008", spec: SPECS.python.spec }, expected: "low confidence", traceId: r?.traceId, passed: ok });
    }

    // ---------- end to end on the (small) Rust job: enrichment + screening + shortlist approval ----------
    console.log("\n--- End to end: rust job (enrichment, pre-filter, screening, shortlist) ---");
    {
      const jobId = jobIds.rust;
      const r = await runPipeline(jobId, { extraTags: ["test"] });
      const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
      const { entries } = await pipelineOf(jobId);
      const profilesSaved = await db.candidateProfile.count({ where: { candidateId: { in: entries.map((e) => e.candidateId) } } });
      const results = await db.screeningResult.findMany({ where: { jobId, current: true } });
      const scored = results.filter((x) => !x.filteredOut);
      const item = await db.approvalItem.findFirst({ where: { jobId, kind: "shortlist", status: "awaiting_approval" } });
      check("Pipeline reaches the shortlist", job.status === "awaiting_shortlist" && !!item, `${job.status}: ${r.message}`);
      check("AC (step 3) all sourced candidates get a profile", profilesSaved === entries.length, `${profilesSaved} of ${entries.length}`);
      check("AC (step 4) every candidate gets score + reasons (or a pre-filter reason)", results.length === entries.length && scored.every((x) => x.score !== null && !!(x.data as { reasons?: string })?.reasons) && results.filter((x) => x.filteredOut).every((x) => !!x.filterReason), `${scored.length} scored, ${results.length - scored.length} filtered`);
      const cost = (await db.agentRun.aggregate({ where: { jobId }, _sum: { costUsd: true } }))._sum.costUsd ?? 0;
      console.log(`      job cost so far: $${cost.toFixed(4)}`);

      if (scored.length) {
        const ranked = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const keep = ranked.slice(0, Math.min(2, ranked.length)).map((x) => x.candidateId);
        const decisions = results.map((x) => ({
          candidateId: x.candidateId,
          selected: keep.includes(x.candidateId),
          overrideScore: x.candidateId === keep[0] ? 99 : null,
          overrideNote: x.candidateId === keep[0] ? "test override" : "",
        }));
        const a = await approveShortlist(jobId, decisions);
        const after = await pipelineOf(jobId);
        const shortlisted = after.entries.filter((e) => e.stage === "shortlisted").map((e) => e.candidateId).sort();
        const closed = await db.approvalItem.findUnique({ where: { id: item!.id } });
        const overridden = await db.screeningResult.findFirst({ where: { jobId, current: true, candidateId: keep[0] } });
        check("AC (step 4) shortlist approval moves the stage", a.ok && JSON.stringify(shortlisted) === JSON.stringify([...keep].sort()), `${a.message} -> ${shortlisted.join(", ")}`);
        check("Shortlist: approval item closed, job shortlisted", closed?.status === "approved" && ["shortlisted", "drafting_outreach"].includes((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status), `${closed?.status}`);
        check("Shortlist: score override saved with its note", overridden?.overrideScore === 99 && overridden.overrideNote === "test override", `${overridden?.overrideScore}`);
      }
    }

    // ---------- reject shortlist = edit spec -> re-source (state only; the re-run itself is not started here) ----------
    {
      const jobId = jobIds.python;
      await db.job.update({ where: { id: jobId }, data: { status: "awaiting_shortlist" } });
      await db.screeningResult.create({ data: { jobId, candidateId: "cand-001", score: 90, confidence: "high", data: {} } });
      const edited = { ...SPECS.python.spec, must_have: [...SPECS.python.spec.must_have, "Kafka"] };
      const r = await editSpecAndResource(jobId, edited, "Client now requires Kafka");
      const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { jobSpec: true } });
      const stillCurrent = await db.screeningResult.count({ where: { jobId, current: true } });
      check("Edit spec + re-source: spec saved, old scores kept as history, sourcing queued", r.ok && job.status === "ready_for_sourcing" && (job.jobSpec.spec as JobSpecData).must_have.includes("Kafka") && stillCurrent === 0, r.message);
    }

    // ---------- runaway on one candidate's run -> one grouped "Stopped" item per job, nothing saved ----------
    console.log("\n--- Budget rules ---");
    {
      const jobId = jobIds.kotlin;
      const { entries } = await pipelineOf(jobId);
      const withProfile = new Set((await db.candidateProfile.findMany({ where: { candidateId: { in: entries.map((e) => e.candidateId) } } })).map((x) => x.candidateId));
      const todo = entries.filter((e) => !withProfile.has(e.candidateId)).slice(0, 2);
      // Keep only 2 un-enriched candidates in this job, so the test costs 2 tiny Haiku runs.
      await db.pipelineEntry.deleteMany({ where: { jobId, candidateId: { notIn: todo.map((t) => t.candidateId) } } });
      const budget = AGENT_BUDGETS["enrichment-agent"];
      const original = budget.budgetUsd;
      budget.budgetUsd = 0.000001; // in memory only: any real run is far above 3x this
      try {
        await db.job.update({ where: { id: jobId }, data: { status: "enriching" } });
        await runPipeline(jobId, { stopAfter: "enrichment", extraTags: ["test"] });
      } finally {
        budget.budgetUsd = original;
      }
      const items = await db.approvalItem.findMany({ where: { jobId, kind: "stopped_run" } });
      const saved = await db.candidateProfile.count({ where: { candidateId: { in: todo.map((t) => t.candidateId) } } });
      check("Runaway: one grouped 'Stopped: over budget' item for the job", items.length === 1 && items[0].title === "Stopped: over budget", `${items.length} item(s): ${items[0]?.detail}`);
      check("Runaway: nothing saved", saved === 0, `${saved} profile(s) saved`);

      // Job budget hard stop: lower this job's budget to $0 -> the pipeline pauses before the next run.
      await db.job.update({ where: { id: jobId }, data: { status: "enriching", extraBudgetUsd: -JOB_BUDGET_USD } });
      const r = await runPipeline(jobId, { stopAfter: "enrichment", extraTags: ["test"] });
      const paused = await db.job.findUniqueOrThrow({ where: { id: jobId } });
      const item = await db.approvalItem.findFirst({ where: { jobId, kind: "job_budget", status: "awaiting_approval" } });
      check("Job budget: pipeline paused, 'continue?' item in the queue", paused.status === "paused_over_budget" && !!item, `${paused.status}: ${r.message}`);
      if (item) {
        const c = await continueOverBudget(item.id);
        const resumed = await db.job.findUniqueOrThrow({ where: { id: jobId } });
        check("Job budget: Continue raises the budget and resumes at the paused step", c.ok && resumed.status === "enriching" && resumed.extraBudgetUsd === 0, `${resumed.status}, extra ${resumed.extraBudgetUsd}`);
      }
    }
  } finally {
    // ---------- Langfuse datasets ----------
    // Items that the eval runner also uses are defined once in src/evals/datasets.ts (synced here); only the
    // state-dependent test cases are written from this script, marked eval: false (the eval runner skips them).
    const { EVALS, syncDataset } = await import("@/evals/datasets");
    for (const d of Object.values(DATASETS)) await syncDataset(langfuse, d.name);
    for (const r of datasetRuns) {
      if (!EVALS[r.dataset]?.items.some((i) => i.id === r.id)) {
        await langfuse.api.datasetItems.create({ datasetName: r.dataset, id: r.id, input: r.input, expectedOutput: r.expected, metadata: { test_case: r.name, eval: false } });
      }
      if (r.traceId) {
        await langfuse.api.datasetRunItems.create({ runName, datasetItemId: r.id, traceId: r.traceId });
        langfuse.score.create({ traceId: r.traceId, name: "test_passed", value: r.passed ? 1 : 0, comment: r.id });
      }
    }
    await flushTelemetry();

    // Remove the test rows so the app stays clean (agent_runs keep their real cost; profiles are kept as a cache).
    await db.approvalItem.deleteMany({ where: { jobId: { in: allJobIds } } });
    await db.agentRun.updateMany({ where: { jobId: { in: allJobIds } }, data: { jobId: null } });
    await db.job.deleteMany({ where: { id: { in: allJobIds } } });
    await db.jobSpec.deleteMany({ where: { id: { in: specIds } } });
  }

  const spent = await db.agentRun.groupBy({ by: ["agent"], where: { createdAt: { gte: startedAt } }, _sum: { costUsd: true }, _count: true });
  console.log("\nCost of this test run:");
  for (const s of spent) console.log(`  ${s.agent}: ${s._count} run(s), $${(s._sum.costUsd ?? 0).toFixed(4)}`);
  console.log(`  total: $${spent.reduce((n, s) => n + (s._sum.costUsd ?? 0), 0).toFixed(4)}`);
  console.log(`Langfuse datasets: ${Object.values(DATASETS).map((d) => d.name).join(", ")}; run "${runName}"`);
  console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
