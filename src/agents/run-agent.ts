// Shared runner for every agent: one run = one Langfuse trace + one agent_runs row,
// with the cost-vs-budget rules from CLAUDE.md applied after each run.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { startActiveObservation, propagateAttributes } from "@langfuse/tracing";
import type { McpServerConfig, SDKResultMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AGENT_BUDGETS, RUNAWAY_MULTIPLIER, type AgentName } from "@/config/budgets";
import { AGENT_EFFORT, MODELS, THINKING_OFF } from "@/config/models";
import { db } from "@/lib/db";
import { applyStoredSettings } from "@/lib/settings";
import { getTelemetry, flushTelemetry } from "./telemetry";

// Short fingerprint of the system prompt (the prompt file after its {{...}} placeholders are filled).
// Same prompt text -> same version, so runs and evals can be grouped by prompt version.
export const promptVersion = (systemPrompt: string) => createHash("sha256").update(systemPrompt).digest("hex").slice(0, 8);

// Inside `npm run eval`, Langfuse's experiment runner opens one trace per dataset item and the agent run must
// stay inside it (that's how the run is linked to the item). Everywhere else a run starts its own trace.
const insideEval = new AsyncLocalStorage<true>();
export const runInsideEval = <T>(fn: () => Promise<T>) => insideEval.run(true, fn);

// The SDK takes content blocks (here: a PDF document, then the text) as a one-message stream.
async function* withPdf(prompt: string, pdfBase64: string): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: prompt },
      ],
    },
  };
}

export type RunStatus = "succeeded" | "failed" | "stopped_over_budget";

export type RunAgentInput = {
  agent: AgentName;
  systemPrompt: string;
  prompt: string;
  // A PDF sent to the model together with the prompt (CV upload, docs/specs/15-cv-upload.md). Base64.
  pdfBase64?: string;
  tags?: string[]; // e.g. ["step-1", "client:client-brightline"]
  metadata?: Record<string, string>;
  jobId?: string; // also the Langfuse session id, so all traces of one job are grouped (Langfuse > Sessions)
  // Mock tools for this agent (in-process MCP servers) and the tool names it may call without asking.
  mcpServers?: Record<string, McpServerConfig>;
  allowedTools?: string[];
  // For budgets "per unit" where one run can produce several units (e.g. one brief -> two specs):
  // how many units the run's output contains. Budget = budgetUsd x units. Default 1.
  countUnits?: (output: string) => number;
  // Metadata only known once the output exists (e.g. ids of the specs this run produced).
  metadataFromOutput?: (output: string) => Record<string, string>;
};

export type RunAgentResult = {
  runId: string;
  status: RunStatus;
  output: string | null; // final text from the model (null if stopped/failed)
  costUsd: number;
  budgetUsd: number;
  traceId: string;
  traceUrl: string | null;
};

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  await applyStoredSettings(); // keys saved in the app's Keys menu (also for terminal scripts)
  if (!process.env.ANTHROPIC_API_KEY) {
    // Without this the SDK could fall back to a personal Claude login. Fail loudly instead.
    throw new Error("No Anthropic API key yet. Add it in the Keys menu (key icon, left rail) or in .env.local.");
  }

  const { query, langfuse } = getTelemetry();
  const budget = AGENT_BUDGETS[input.agent];
  const model = MODELS[budget.model];
  const tags = input.tags ?? [];
  // Hard cap for the SDK, before we know how many units the run will produce.
  const maxUnits = "maxUnitsPerRun" in budget ? budget.maxUnitsPerRun : 1;
  const effort = AGENT_EFFORT[input.agent];
  const sessionId = input.jobId ? `job:${input.jobId}` : undefined;
  const prompt_version = promptVersion(input.systemPrompt);

  // Every run is its own trace (CLAUDE.md). Start from an empty context, so a run never joins a trace that
  // happens to be active: Next.js opens a span per web request, and background work started from a click
  // (after()) would otherwise put all of that pipeline's runs into the request's trace. Evals are the exception.
  const parent = insideEval.getStore() ? context.active() : ROOT_CONTEXT;
  const { traceId, result, error, costUsd, budgetUsd, ratio, status, overBudget } = await context.with(parent, () => startActiveObservation(input.agent, async (span) =>
    propagateAttributes({ traceName: input.agent, tags, sessionId, metadata: { ...input.metadata, model, prompt_version, ...(effort ? { effort } : {}) } }, async () => {
      let result: SDKResultMessage | null = null;
      let error: string | null = null;
      try {
        for await (const message of query({
          prompt: input.pdfBase64 ? withPdf(input.prompt, input.pdfBase64) : input.prompt,
          options: {
            model,
            systemPrompt: input.systemPrompt,
            maxTurns: budget.maxTurns,
            ...(effort ? { effort } : {}),
            ...(THINKING_OFF.includes(budget.model) ? { thinking: { type: "disabled" as const } } : {}),
            // SDK refuses further turns past the runaway limit (a turn already running still finishes).
            maxBudgetUsd: budget.budgetUsd * maxUnits * RUNAWAY_MULTIPLIER,
            tools: [], // no built-in Claude Code tools (files, shell); only the mock tools below
            mcpServers: input.mcpServers ?? {},
            allowedTools: input.allowedTools ?? [],
            settingSources: [], // don't load anyone's personal Claude settings or CLAUDE.md
            persistSession: false, // no session files on disk
          },
        })) {
          if (message.type === "result") result = message;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      span.update({ input: input.prompt, output: result && "result" in result ? result.result : error });

      const costUsd = result?.total_cost_usd ?? 0;
      const outputText = result?.subtype === "success" ? result.result : null;
      const units = outputText && input.countUnits ? Math.min(Math.max(1, input.countUnits(outputText)), maxUnits) : 1;
      const budgetUsd = budget.budgetUsd * units;
      const ratio = costUsd / budgetUsd;
      const hitLimit = result?.subtype === "error_max_turns" || result?.subtype === "error_max_budget_usd";
      const status: RunStatus =
        hitLimit || ratio > RUNAWAY_MULTIPLIER
          ? "stopped_over_budget"
          : error || !result || result.subtype !== "success"
            ? "failed"
            : "succeeded";
      const overBudget = ratio > 1 || status === "stopped_over_budget";

      if (outputText && input.metadataFromOutput) {
        const extra = input.metadataFromOutput(outputText);
        await startActiveObservation("result-metadata", (m) =>
          propagateAttributes({ traceName: input.agent, tags, sessionId, metadata: { ...input.metadata, ...extra } }, () => {
            m.update({ metadata: extra });
          }),
        );
      }

      if (overBudget) {
        // Cost is only known now, so add the `over-budget` tag via a child span while the trace is
        // still open (trace tags merge across spans). Outside this callback it would start a new trace.
        await startActiveObservation("budget-check", (check) =>
          propagateAttributes({ traceName: input.agent, sessionId, tags: [...tags, "over-budget"] }, () => {
            check.update({ metadata: { costUsd, budgetUsd, ratio, status } });
          }),
        );
      }
      return { traceId: span.traceId, result, error, costUsd, budgetUsd, ratio, status, overBudget };
    }),
  ));

  const usage = Object.values(result?.modelUsage ?? {});
  const inputTokens = usage.reduce((n, u) => n + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0);
  const outputTokens = usage.reduce((n, u) => n + u.outputTokens, 0);

  // Langfuse: cost_vs_budget score on every run.
  langfuse.score.create({ traceId, name: "cost_vs_budget", value: Number(ratio.toFixed(3)) });
  await flushTelemetry();

  let traceUrl: string | null = null;
  try {
    traceUrl = await langfuse.getTraceUrl(traceId);
  } catch {
    // Link is a convenience; the run is still logged without it.
  }

  const run = await db.agentRun.create({
    data: {
      agent: input.agent,
      model,
      promptVersion: prompt_version,
      isEval: tags.includes("eval"),
      status,
      jobId: input.jobId,
      inputTokens,
      outputTokens,
      costUsd,
      budgetUsd,
      numTurns: result?.num_turns ?? 0,
      overBudget,
      traceId,
      traceUrl,
      error: error ?? (result && result.subtype !== "success" ? result.subtype : null),
    },
  });

  return {
    runId: run.id,
    status,
    // Over-budget runaways save nothing: callers get no output to store.
    output: status === "succeeded" && result?.subtype === "success" ? result.result : null,
    costUsd,
    budgetUsd,
    traceId,
    traceUrl,
  };
}
