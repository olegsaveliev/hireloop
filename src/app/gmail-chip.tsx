import { connection } from "next/server";
import { gmailStatus } from "@/agents/inbound/workflow";
import { googleReady } from "@/lib/settings";
import { GmailMenu } from "./gmail-menu";

// Header: Gmail connection status (replaces the Gmail bar that used to sit on the Briefs page).
export async function GmailChip() {
  await connection();
  const s = await gmailStatus();
  return <GmailMenu s={{ connected: s.connected, email: s.email, missingCalendar: s.missingCalendar, googleReady: googleReady() }} />;
}
