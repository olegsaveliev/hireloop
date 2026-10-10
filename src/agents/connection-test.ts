// Phase 0: one tiny Haiku call that proves Claude, Langfuse tracing, and agent_runs logging all work.
import { runAgent } from "./run-agent";
import { loadPrompt } from "./prompts";

export async function runConnectionTest() {
  const missing = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`${missing.join(", ")} not set in .env.local`);
  return runAgent({
    agent: "connection-test",
    systemPrompt: await loadPrompt("connection-test"),
    prompt: "Are you online?",
    tags: ["phase-0", "connection-test"],
  });
}
