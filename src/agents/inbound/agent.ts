// Gmail inbound classifier (docs/specs/11-gmail-inbound.md): is this email a client brief? Haiku, no tools, saves nothing.
import { CLASSIFIER_MAX_BODY_CHARS } from "@/config/google";
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { inboundClassificationSchema } from "./schema";

const AGENT = "inbound-classifier" as const;

export const inboundClassifierSystemPrompt = () => loadPrompt(AGENT);

export type ClassifierInput = { fromName: string; fromEmail: string; subject: string; body: string; attachmentNames: string[] };

export async function runInboundClassifier(email: ClassifierInput, opts: { clientId?: string | null; metadata?: Record<string, string>; extraTags?: string[] } = {}) {
  const body = email.body.length > CLASSIFIER_MAX_BODY_CHARS ? `${email.body.slice(0, CLASSIFIER_MAX_BODY_CHARS)}\n[... cut]` : email.body;
  const prompt = [
    `From: ${email.fromName} <${email.fromEmail}>`,
    `Subject: ${email.subject}`,
    `Attachments: ${email.attachmentNames.length ? email.attachmentNames.join(", ") : "none"}`,
    "",
    "<email>",
    body,
    "</email>",
  ].join("\n");
  return runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await inboundClassifierSystemPrompt(),
      prompt,
      tags: ["step-1", "inbound", ...(opts.clientId ? [`client:${opts.clientId}`] : []), ...(opts.extraTags ?? [])],
      metadata: opts.metadata,
    },
    inboundClassificationSchema,
  );
}
