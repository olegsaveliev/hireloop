import { connection } from "next/server";
import { gmailStatus } from "@/agents/inbound/workflow";
import { googleReady } from "@/lib/settings";
import { keyFields } from "./keys-chip";
import { GmailMenu } from "./gmail-menu";

// Left rail: Gmail connection status and the Google keys (client ID and secret, test inbox, allow-list).
export async function GmailChip() {
  await connection();
  const s = await gmailStatus();
  return (
    <GmailMenu
      s={{ connected: s.connected, email: s.email, missingCalendar: s.missingCalendar, googleReady: googleReady() }}
      fields={await keyFields(["google"])}
      redirectUri={process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/google/callback"}
    />
  );
}
