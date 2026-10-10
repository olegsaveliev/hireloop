// OpenTelemetry -> Langfuse setup, following Langfuse's guide
// "Trace Claude Agent SDK JS/TS with Langfuse" (langfuse.com/integrations/frameworks/claude-agent-sdk-js).
// Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL from the environment (Keys menu or .env.local).
// Langfuse is optional: without keys, agents still run and are logged in agent_runs, just not traced.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor, isDefaultExportSpan } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import { ClaudeAgentSDKInstrumentation } from "@arizeai/openinference-instrumentation-claude-agent-sdk";
import * as ClaudeAgentSDKModule from "@anthropic-ai/claude-agent-sdk";

// OpenTelemetry can only be started once per process, but keys can change in the Keys menu. So the SDK gets this
// processor once, and the Langfuse processor inside it is swapped when the keys change (none without keys).
class SwitchableProcessor {
  inner: LangfuseSpanProcessor | null = null;
  onStart(...a: Parameters<LangfuseSpanProcessor["onStart"]>) {
    this.inner?.onStart(...a);
  }
  onEnd(...a: Parameters<LangfuseSpanProcessor["onEnd"]>) {
    this.inner?.onEnd(...a);
  }
  async forceFlush() {
    await this.inner?.forceFlush();
  }
  async shutdown() {
    await this.inner?.shutdown();
  }
}

type Telemetry = {
  query: typeof ClaudeAgentSDKModule.query;
  spanProcessor: SwitchableProcessor;
  langfuse: LangfuseClient;
  keys: string; // the Langfuse keys the processor and client were made with
};

// Started once per process (Next.js dev reloads modules, so keep it on globalThis).
const globalForTelemetry = globalThis as unknown as { hireloopTelemetry?: Telemetry };

const langfuseKeys = () => [process.env.LANGFUSE_PUBLIC_KEY, process.env.LANGFUSE_SECRET_KEY, process.env.LANGFUSE_BASE_URL].join("|");
const hasLangfuse = () => !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);

// Without keys: scores are dropped quietly; anything that needs Langfuse (datasets, evals) says so.
function offlineLangfuse(): LangfuseClient {
  const fail = () => {
    throw new Error("Langfuse keys are not set. Add them in the Keys menu (key icon, left rail).");
  };
  const deep: object = new Proxy(fail, { get: () => deep, apply: fail });
  return new Proxy({} as LangfuseClient, {
    get: (_, p) => (p === "score" ? { create: () => {} } : p === "flush" ? async () => {} : deep),
  });
}

function connect(t: Pick<Telemetry, "spanProcessor"> & Partial<Telemetry>) {
  const on = hasLangfuse();
  t.spanProcessor.inner = on
    ? new LangfuseSpanProcessor({
        shouldExportSpan: ({ otelSpan }) =>
          isDefaultExportSpan(otelSpan) ||
          otelSpan.instrumentationScope.name === "@arizeai/openinference-instrumentation-claude-agent-sdk",
      })
    : null;
  t.langfuse = on ? new LangfuseClient() : offlineLangfuse();
  t.keys = langfuseKeys();
}

function start(): Telemetry {
  const ClaudeAgentSDK = { ...ClaudeAgentSDKModule };
  const instrumentation = new ClaudeAgentSDKInstrumentation();
  instrumentation.manuallyInstrument(ClaudeAgentSDK);

  const spanProcessor = new SwitchableProcessor();
  const sdk = new NodeSDK({ spanProcessors: [spanProcessor], instrumentations: [instrumentation] });
  sdk.start();

  const t = { query: ClaudeAgentSDK.query, spanProcessor } as Telemetry;
  connect(t);
  return t;
}

export function getTelemetry(): Telemetry {
  const t = (globalForTelemetry.hireloopTelemetry ??= start());
  if (t.keys !== langfuseKeys()) {
    void t.spanProcessor.inner?.shutdown().catch(() => undefined);
    connect(t);
  }
  return t;
}

export const langfuseEnabled = hasLangfuse;

// Send everything buffered to Langfuse. Call after each run (server keeps running, so no shutdown).
export async function flushTelemetry() {
  const t = getTelemetry();
  await Promise.all([t.spanProcessor.forceFlush(), t.langfuse.flush()]);
}
