// CV reader output (docs/specs/15-cv-upload.md "Output").
import { z } from "zod";

export const cvReaderOutputSchema = z.object({
  readable: z.boolean(),
  full_name: z.string().nullable(),
  language: z.enum(["en", "uk", "pl", "other"]),
  profile_text: z.string(),
  problem: z.string().nullable(),
});

export type CvReaderOutput = z.infer<typeof cvReaderOutputSchema>;
