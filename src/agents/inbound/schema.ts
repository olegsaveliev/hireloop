import { z } from "zod";

// Inbound classifier output (docs/specs/11-gmail-inbound.md).
export const inboundClassificationSchema = z.object({
  kind: z.enum(["brief", "not_brief"]),
  reason: z.string().min(1).max(400),
});
export type InboundClassification = z.infer<typeof inboundClassificationSchema>;

// inbound_emails.status
export type InboundStatus = "new" | "brief" | "update" | "ignored" | "waiting_sender" | "not_client" | "failed" | "deleted" | "cleared";
