// Client reply hint (docs/specs/13-gmail-client-emails.md): Haiku reads the client's reply and suggests a button.
// No tools, saves nothing; the account manager still clicks.
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { clientReplyHintSchema, type ClientSituation } from "./schema";

const AGENT = "client-reply-hint" as const;

export const clientReplyHintSystemPrompt = () => loadPrompt(AGENT);

export async function runClientReplyHint(args: {
  situation: ClientSituation;
  reply: string;
  jobTitle: string;
  candidateRef: string; // name, or the anonymized reference for anonymized clients
  pickedTime?: string | null;
  jobId?: string;
  clientId?: string;
  extraTags?: string[];
}) {
  const prompt = [
    `Situation: ${args.situation}`,
    `Role: ${args.jobTitle}\nCandidate: ${args.candidateRef}`,
    args.pickedTime ? `Time we asked the client to confirm: ${args.pickedTime}` : null,
    `<client_reply>\n${args.reply.slice(0, 4000)}\n</client_reply>`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await clientReplyHintSystemPrompt(),
      prompt,
      tags: ["step-7", ...(args.jobId ? [`job:${args.jobId}`] : []), ...(args.clientId ? [`client:${args.clientId}`] : []), ...(args.extraTags ?? [])],
      metadata: { situation: args.situation },
      jobId: args.jobId,
    },
    clientReplyHintSchema(args.situation),
  );
}
