import { connection } from "next/server";
import { db } from "@/lib/db";
import { gmailStatus } from "@/agents/inbound/workflow";
import { ActionButton } from "../../action-button";
import { checkInboxAction } from "../../inbound-actions";
import { NewBriefForm } from "../../new-brief-form";

// New brief: paste a client email by hand (docs/specs/11-gmail-inbound.md, "New brief page"). Look from the 2026-10-09 mockup.
export default async function NewBriefPage() {
  await connection();
  const [clients, google] = await Promise.all([
    db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    gmailStatus(),
  ]);
  return (
    <div className="flex flex-col gap-10 pt-2 text-ink">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-300 pb-6">
        <div className="min-w-0 flex-[1_1_240px] text-lg font-semibold tracking-tight text-stone-500 uppercase sm:text-xl">Hireloop</div>
        <ActionButton
          action={checkInboxAction}
          label="Check Gmail"
          pendingLabel="Reading Gmail…"
          variant="outline"
          disabled={!google.connected}
          title={google.connected ? "Read new emails under your Gmail label “Briefs”" : "Connect Gmail first (bottom of the left panel)"}
        />
      </div>
      <NewBriefForm clients={clients} />
    </div>
  );
}
