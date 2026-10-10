import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent SDK + tracing packages must run as normal Node modules, not be bundled.
  // The Google and Langfuse libraries are big: bundling them made the dev server recompile megabytes
  // for every page after each code change (30s+ clicks, 1 GB+ memory). Loading them as-is is much lighter.
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@arizeai/openinference-instrumentation-claude-agent-sdk",
    "@opentelemetry/sdk-node",
    "@opentelemetry/api",
    "@langfuse/otel",
    "@langfuse/client",
    "@langfuse/tracing",
    "@langfuse/core",
    "@googleapis/gmail",
    "@googleapis/calendar",
    "google-auth-library",
  ],
  // The dev-only "N" button would cover the colour switch at the bottom of the left panel.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
