// Same connection test as the "Run connection test" button on the Runs page, from the terminal.
// Run with: npm run test:langfuse
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { runConnectionTest } = await import("@/agents/connection-test");
  const r = await runConnectionTest();
  console.log(r);
  process.exit(r.status === "succeeded" ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
