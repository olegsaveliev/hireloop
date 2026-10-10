// CV upload (docs/specs/15-cv-upload.md): Haiku reads one uploaded PDF and writes it out as plain text. Saves nothing;
// workflow.ts saves the candidate.
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { cvReaderOutputSchema } from "./schema";

const AGENT = "cv-reader" as const;

export async function runCvReader(args: { pdfBase64: string; fileName: string; extraTags?: string[] }) {
  return runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await loadPrompt(AGENT),
      prompt: `File name: ${args.fileName}\n\nWrite out the attached CV as described. JSON only.`,
      pdfBase64: args.pdfBase64,
      tags: ["cv-upload", ...(args.extraTags ?? [])],
      metadata: { file_name: args.fileName },
    },
    cvReaderOutputSchema,
  );
}
