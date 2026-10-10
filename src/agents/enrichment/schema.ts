// Enrichment agent output (docs/specs/03-enrichment-agent.md "Output"), plus `job_history` (so the app computes
// years of experience, counting overlaps once) and `key_facts` (so screening never needs the raw text,
// which can contain protected attributes).
import { z } from "zod";

export const enrichmentOutputSchema = z.object({
  candidate_id: z.string(),
  current_title: z.string().nullable(),
  years_experience: z.number().min(0).max(60).nullable(),
  skills: z.array(z.string()),
  recent_stack: z.array(z.string()),
  location: z.string().nullable(),
  english_level: z.string().nullable(),
  contacts: z.object({ email: z.string().nullable(), linkedin: z.string().nullable() }),
  job_history: z.array(
    z.object({ title: z.string(), company: z.string(), start: z.string(), end: z.string(), part_time: z.boolean() }),
  ),
  key_facts: z.array(z.string()).max(8),
  missing_fields: z.array(z.string()),
});
export type CandidateProfileData = z.infer<typeof enrichmentOutputSchema>;
