// Creates the "Hireloop agents" dashboard in Langfuse (docs/specs/10-langfuse-polish.md, part 5). No AI calls, $0.
// Uses Langfuse's dashboard API, which Langfuse marks "unstable" (it may change). Re-runnable: it deletes the
// dashboard and the widgets it made before (widget names start with "NW · ") and creates them again.
// If this ever stops working, PROGRESS.md has the same widgets as click-by-click steps for the Langfuse UI.
// Run with: npm run setup:dashboards
import { config } from "dotenv";
config({ path: ".env.local" });

const DASHBOARD = "Hireloop agents";
// The name before the 2026-10-10 rename; removed too so there aren't two dashboards.
const OLD_DASHBOARD = "Northwind agents";
const PREFIX = "NW · ";
// The 6 agents built so far. Other trace names (connection-test, stray budget-check) stay out of the charts.
const AGENTS = ["job-spec-agent", "sourcing-agent", "enrichment-agent", "screening-agent", "outreach-draft", "reply-classifier"];

type Filter = { column: string; operator: string; type: string; value: unknown; key?: string };
type Widget = {
  name: string;
  description: string;
  view: "observations" | "scores-numeric";
  dimensions: { field: string }[];
  metrics: { measure: string; agg: string }[];
  filters: Filter[];
  chartType: string;
  width?: number;
};

// Real use only: runs from `npm run eval` (tag "eval") and the test:* scripts (tag "test") are left out.
const realRuns: Filter[] = [
  { column: "tags", operator: "none of", type: "arrayOptions", value: ["eval", "test"] },
  { column: "traceName", operator: "any of", type: "stringOptions", value: AGENTS },
];
const score = (name: string): Filter => ({ column: "name", operator: "=", type: "string", value: name });

const WIDGETS: Widget[] = [
  {
    name: "Cost per agent over time",
    description: "USD per day, by agent. Cost per job: Langfuse > Sessions (one session per job) or the app's Runs page.",
    view: "observations",
    dimensions: [{ field: "traceName" }],
    metrics: [{ measure: "totalCost", agg: "sum" }],
    filters: realRuns,
    chartType: "BAR_TIME_SERIES",
  },
  {
    name: "Total cost per agent",
    description: "USD in the selected time range, by agent.",
    view: "observations",
    dimensions: [{ field: "traceName" }],
    metrics: [{ measure: "totalCost", agg: "sum" }],
    filters: realRuns,
    chartType: "HORIZONTAL_BAR",
  },
  {
    name: "Over-budget runs per agent",
    description: "Runs that cost more than their budget (cost_vs_budget above 1), by agent.",
    view: "scores-numeric",
    dimensions: [{ field: "traceName" }],
    metrics: [{ measure: "count", agg: "count" }],
    filters: [...realRuns, score("cost_vs_budget"), { column: "value", operator: ">", type: "number", value: 1 }],
    chartType: "HORIZONTAL_BAR",
  },
  {
    name: "Typical cost vs budget per agent",
    description: "Median of cost_vs_budget (1.0 = exactly on budget). Median, so a few runaway tests don't skew it.",
    view: "scores-numeric",
    dimensions: [{ field: "traceName" }],
    metrics: [{ measure: "value", agg: "p50" }],
    filters: [...realRuns, score("cost_vs_budget")],
    chartType: "HORIZONTAL_BAR",
  },
  {
    name: "Approved without edits, per agent",
    description: "Share of job specs and outreach drafts the recruiter approved unchanged (1.0 = 100%).",
    view: "scores-numeric",
    dimensions: [{ field: "traceName" }],
    metrics: [{ measure: "value", agg: "avg" }],
    filters: [...realRuns, score("approved_without_edits")],
    chartType: "HORIZONTAL_BAR",
  },
  {
    name: "Screening: recruiter agreement over time",
    description: "Share of the screening agent's top 10 the recruiter kept in the shortlist (1.0 = all).",
    view: "scores-numeric",
    dimensions: [],
    metrics: [{ measure: "value", agg: "avg" }],
    filters: [...realRuns, score("recruiter_agreement")],
    chartType: "LINE_TIME_SERIES",
  },
  {
    name: "Reply classifier: correct",
    description: "Share of classifications the recruiter marked Correct (1.0 = 100%).",
    view: "scores-numeric",
    dimensions: [],
    metrics: [{ measure: "value", agg: "avg" }],
    filters: [...realRuns, score("classifier_correct")],
    chartType: "NUMBER",
  },
];

const base = () => `${process.env.LANGFUSE_BASE_URL}/api/public/unstable`;
const headers = () => ({
  Authorization: `Basic ${Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64")}`,
  "Content-Type": "application/json",
});
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : {}) as T;
}
type Page<T> = { data: T[]; meta: { totalPages?: number } };
async function listAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const r = await api<Page<T>>("GET", `${path}?page=${page}&limit=50`);
    out.push(...r.data);
    if (!r.data.length || page >= (r.meta.totalPages ?? 1)) return out;
  }
}

async function main() {
  // 1. Remove what an earlier run of this script made.
  for (const d of await listAll<{ id: string; name: string }>("/dashboards")) {
    if (d.name === DASHBOARD || d.name === OLD_DASHBOARD) await api("DELETE", `/dashboards/${d.id}`);
  }
  for (const w of await listAll<{ id: string; name: string }>("/dashboard-widgets")) {
    if (w.name.startsWith(PREFIX)) await api("DELETE", `/dashboard-widgets/${w.id}`);
  }

  // 2. Create the dashboard and its widgets (two per row, 6x6 tiles on the 12-column grid).
  const dashboard = await api<{ id: string }>("POST", "/dashboards", {
    name: DASHBOARD,
    description: "Hireloop agents: cost, budget and quality scores from the app (docs/specs/10-langfuse-polish.md). Excludes eval and test runs.",
  });
  for (const [i, w] of WIDGETS.entries()) {
    const widget = await api<{ id: string }>("POST", "/dashboard-widgets", {
      name: `${PREFIX}${w.name}`,
      description: w.description,
      view: w.view,
      dimensions: w.dimensions,
      metrics: w.metrics,
      filters: w.filters,
      chartType: w.chartType,
    });
    await api("POST", `/dashboards/${dashboard.id}/placements`, { type: "widget", widgetId: widget.id, x: (i % 2) * 6, y: Math.floor(i / 2) * 6, width: 6, height: 6 });
    console.log(`  added: ${w.name}`);
  }

  // The project id is part of any trace URL; reuse the Langfuse client to build the dashboard link.
  const { getTelemetry, flushTelemetry } = await import("@/agents/telemetry");
  const { db } = await import("@/lib/db");
  const anyRun = await db.agentRun.findFirst({ where: { traceUrl: { not: null } } });
  const projectUrl = anyRun?.traceUrl?.split("/traces/")[0];
  console.log(`\nDashboard "${DASHBOARD}" created with ${WIDGETS.length} widgets.${projectUrl ? `\n${projectUrl}/dashboards/${dashboard.id}` : ""}`);
  getTelemetry();
  await flushTelemetry();
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
