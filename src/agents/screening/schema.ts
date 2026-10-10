// Screening agent output (docs/specs/04-screening-agent.md "Output"). Score is 0-100.
import { z } from "zod";

export const CONFIDENCES = ["high", "medium", "low"] as const;

export const screeningOutputSchema = z.object({
  candidate_id: z.string(),
  score: z.number().int().min(0).max(100),
  must_have_met: z.array(z.string()),
  must_have_missing: z.array(z.string()),
  dealbreaker_hit: z.string().nullable(),
  reasons: z.string().min(1),
  confidence: z.enum(CONFIDENCES),
});
export type ScreeningData = z.infer<typeof screeningOutputSchema>;
