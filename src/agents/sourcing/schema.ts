// Sourcing agent output (docs/specs/02-sourcing-agent.md "Output"), plus `broadened` and `note` for the edge cases,
// and `highlights`: 0-3 short headlines for the Jobs page (missing = none, so an older-style answer still passes).
import { z } from "zod";

export const sourcingOutputSchema = z.object({
  queries: z.array(z.string()).min(1),
  candidates: z.array(z.object({ candidate_id: z.string(), matched_on: z.array(z.string()) })),
  duplicates_skipped: z.number().int().min(0),
  broadened: z.boolean(),
  note: z.string().nullable(),
  highlights: z.array(z.object({ title: z.string(), text: z.string() })).max(3).default([]),
});
export type SourcingOutput = z.infer<typeof sourcingOutputSchema>;
