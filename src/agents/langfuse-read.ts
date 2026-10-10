// Read-back from Langfuse, for checks and evals (the app itself only writes).
// Our Langfuse org only has the newer read APIs: v3 scores and v2 observations (the old /traces is refused).
// Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL from the environment.

export type LangfuseScore = { id: string; name: string; value: number; traceId: string | null; timestamp: string };

function authHeader() {
  const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
  return { Authorization: `Basic ${auth}` };
}

async function get<T>(path: string, params: URLSearchParams): Promise<T> {
  const res = await fetch(`${process.env.LANGFUSE_BASE_URL}${path}?${params}`, { headers: authHeader() });
  if (!res.ok) throw new Error(`Langfuse ${path} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

type ScoresPage = {
  data: { id: string; name: string; value: number; timestamp: string; subject?: { kind: string; id: string } }[];
  meta: { cursor?: string };
};

// All scores since a date, or all scores of one trace. Pages through the results.
export async function fetchScores(filter: { since?: Date; traceId?: string }): Promise<LangfuseScore[]> {
  const out: LangfuseScore[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "100", fields: "core,subject" });
    if (filter.since) params.set("fromTimestamp", filter.since.toISOString());
    if (filter.traceId) params.set("traceId", filter.traceId);
    if (cursor) params.set("cursor", cursor);
    const page = await get<ScoresPage>("/api/public/v3/scores", params);
    for (const s of page.data) {
      out.push({ id: s.id, name: s.name, value: s.value, timestamp: s.timestamp, traceId: s.subject?.kind === "trace" ? s.subject.id : null });
    }
    cursor = page.data.length ? page.meta.cursor : undefined;
  } while (cursor);
  return out;
}

type ObservationsPage = { data: { tags?: string[]; metadata?: Record<string, unknown>; traceMetadata?: Record<string, unknown> }[] };

// Tags and metadata of one trace, merged from its observations.
export async function fetchTraceContext(traceId: string, since: Date): Promise<{ tags: string[]; metadata: Record<string, unknown> }> {
  const params = new URLSearchParams({
    traceId,
    fromStartTime: since.toISOString(),
    toStartTime: new Date().toISOString(),
    fields: "core,basic,trace_context,metadata",
  });
  const page = await get<ObservationsPage>("/api/public/v2/observations", params);
  const tags = [...new Set(page.data.flatMap((o) => o.tags ?? []))];
  const metadata = Object.assign({}, ...page.data.map((o) => ({ ...(o.traceMetadata ?? {}), ...(o.metadata ?? {}) })));
  return { tags, metadata };
}
