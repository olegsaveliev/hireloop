// mock_ats: stands in for Ashby. Exposed to agents as an in-process MCP server.
// Later this becomes the real Ashby MCP server; agents keep calling the same tool names.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { containsTerm, emailOf, headline, locationTerms } from "@/lib/candidates";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

const getPastJobs = tool(
  "get_past_jobs",
  "Past jobs Hireloop filled or worked on for this client: title, seniority, stack, rate range, outcome, notes.",
  { client_id: z.string().describe('Client id, e.g. "client-brightline"') },
  async ({ client_id }) => {
    const jobs = await db.pastJob.findMany({ where: { clientId: client_id }, orderBy: { closedAt: "desc" } });
    const rows = jobs.map((j) => ({
      title: j.title,
      seniority: j.seniority,
      stack: j.stack,
      rate_range: j.rateRange,
      outcome: j.outcome,
      notes: j.notes,
      closed: j.closedAt.toISOString().slice(0, 10),
    }));
    return text(rows);
  },
);

export const mockAtsServer = () => createSdkMcpServer({ name: "mock_ats", tools: [getPastJobs] });
export const MOCK_ATS_TOOLS = {
  getPastJobs: "mcp__mock_ats__get_past_jobs",
  searchCandidates: "mcp__mock_ats__search_candidates",
  getPipeline: "mcp__mock_ats__get_pipeline",
} as const;

// ---------- Step 2: candidate search ----------

const MAX_RESULTS_PER_QUERY = 25;

// What the search tool saw, for the trace metadata ("results per query").
export type SearchLog = { query: string; results: number; location_filter: string[] }[];

// Split a query into terms. All terms must appear (AND). "Quoted phrases" stay together.
function queryTerms(query: string): string[] {
  return [...query.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);
}

// The sourcing agent's tools, bound to one job: the location filter comes from that job's spec only.
export function sourcingAtsServer(ctx: { jobId: string; specLocation: string[]; log: SearchLog }) {
  const searchCandidates = tool(
    "search_candidates",
    "Keyword search over all candidate profiles in the ATS. Each query is a set of keywords that must ALL appear " +
      '(use "quotes" for multi-word phrases, e.g. "spring boot"). Pass several queries at once. ' +
      "With use_location_filter, only candidates in the places named by the job spec's location field are returned " +
      "(the tool reads the spec itself; if the spec names no country or city, no location filter is applied).",
    {
      queries: z.array(z.string()).min(1).max(8).describe('e.g. ["python aws", "python \\"amazon web services\\""]'),
      use_location_filter: z.boolean(),
    },
    async ({ queries, use_location_filter }) => {
      const candidates = await db.candidate.findMany({ orderBy: { id: "asc" } });
      const inPipeline = new Set(
        (await db.pipelineEntry.findMany({ where: { jobId: ctx.jobId }, select: { candidateId: true } })).map((p) => p.candidateId),
      );
      const places = use_location_filter ? locationTerms(ctx.specLocation) : [];
      const pool = places.length ? candidates.filter((c) => places.some((p) => containsTerm(c.rawProfile, p))) : candidates;

      const results = queries.map((query) => {
        const terms = queryTerms(query);
        const hits = pool.filter((c) => terms.every((t) => containsTerm(`${c.fullName}\n${c.rawProfile}`, t)));
        ctx.log.push({ query, results: hits.length, location_filter: places });
        return {
          query,
          total: hits.length,
          candidates: hits.slice(0, MAX_RESULTS_PER_QUERY).map((c) => ({
            candidate_id: c.id,
            name: c.fullName,
            headline: headline(c.rawProfile),
            email: emailOf(c.rawProfile),
            already_in_pipeline: inPipeline.has(c.id),
          })),
        };
      });
      const locationNote = !use_location_filter
        ? "Location filter off."
        : places.length
          ? `Location filter on: ${places.slice(0, 4).join(", ")}${places.length > 4 ? "…" : ""} (from the spec's location field).`
          : "Location filter requested, but the spec's location names no country or city, so no filter was applied.";
      return text({ location: locationNote, results });
    },
  );

  const getPipeline = tool(
    "get_pipeline",
    "Candidates already in this job's pipeline (any stage). Don't add them again.",
    { job_id: z.string() },
    async ({ job_id }) => {
      if (job_id !== ctx.jobId) return text({ error: `Only job ${ctx.jobId} is available in this run.` });
      const entries = await db.pipelineEntry.findMany({ where: { jobId: job_id } });
      const cands = await db.candidate.findMany({ where: { id: { in: entries.map((e) => e.candidateId) } } });
      return text(entries.map((e) => ({ candidate_id: e.candidateId, stage: e.stage, email: emailOf(cands.find((c) => c.id === e.candidateId)?.rawProfile ?? "") })));
    },
  );

  return createSdkMcpServer({ name: "mock_ats", tools: [searchCandidates, getPipeline] });
}
