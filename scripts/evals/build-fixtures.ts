// Builds src/evals/fixtures/profiles.json: the enriched profiles that screening and outreach eval items use,
// so those items don't depend on what happens to be in the app's database. Run once by hand (dev time),
// and again only if the enrichment output format changes. Copies saved profiles from the database; for
// candidates without one, runs the enrichment agent (~$0.004 each) without saving to the app.
// Run with: npm run eval:fixtures
import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";

// Screening: cand-001 perfect fit, cand-003 dealbreaker, cand-008 thin, cand-040 frontend, cand-011 embedded Rust.
// Outreach: cand-001, cand-002, cand-004 (Ukrainian profile), cand-021.
const IDS = ["cand-001", "cand-002", "cand-003", "cand-004", "cand-008", "cand-011", "cand-021", "cand-040"];

async function main() {
  const { db } = await import("@/lib/db");
  const { runEnrichmentAgent } = await import("@/agents/enrichment/agent");
  const out: Record<string, unknown> = {};
  for (const id of IDS) {
    const saved = await db.candidateProfile.findUnique({ where: { candidateId: id } });
    if (saved) {
      out[id] = saved.data;
      console.log(`${id}: copied from database`);
      continue;
    }
    const r = await runEnrichmentAgent({ candidateId: id, extraTags: ["eval-fixture"] });
    if (!r.data) throw new Error(`Enrichment failed for ${id}: ${r.error}`);
    out[id] = r.data;
    console.log(`${id}: enriched now ($${r.runs.reduce((n, x) => n + x.costUsd, 0).toFixed(4)})`);
  }
  writeFileSync("src/evals/fixtures/profiles.json", JSON.stringify(out, null, 2) + "\n");
  console.log("Wrote src/evals/fixtures/profiles.json");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
