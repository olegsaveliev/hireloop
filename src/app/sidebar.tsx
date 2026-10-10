import Link from "next/link";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { needsAction } from "@/lib/briefs";
import { CostBadge } from "./cost-badge";
import { GmailChip } from "./gmail-chip";
import { KeysChip } from "./keys-chip";
import { Logo } from "./logo";
import { HelpLink, NavLinks } from "./nav-links";

// Dark left rail (Briefs mockup, 2026-10-09): logo, menu icons with counts, then Keys, Gmail and spend at the
// bottom (no "Prototype" label, by request). Stays put on scroll. On a narrow window it becomes a strip across the top.
export async function Sidebar() {
  await connection();
  const [briefs, waitingSenders, approvals, jobs] = await Promise.all([
    db.clientBrief.findMany({ select: { jobSpecs: { select: { roleIndex: true, status: true, createdAt: true } } } }),
    db.inboundEmail.groupBy({ by: ["gmailThreadId"], where: { status: "waiting_sender" } }),
    db.approvalItem.count({ where: { status: "awaiting_approval" } }),
    // Active jobs = not finished (same rule as Briefs "Done" and src/lib/briefs.ts jobFinished: stopped, closed, or hired).
    db.job.count({ where: { status: { notIn: ["stopped", "closed"] }, outcomes: { none: { outcome: "hired" } } } }),
  ]);

  return (
    <aside className="sticky top-0 z-20 flex shrink-0 items-center gap-1 bg-rail px-3 py-2 md:h-screen md:w-[5.5rem] md:flex-col md:gap-10 md:px-0 md:py-6 print:hidden">
      <Link href="/" aria-label="Hireloop · Briefs" className="mr-1 shrink-0 md:mr-0 [&>svg]:size-9 md:[&>svg]:size-11">
        <Logo size={44} />
      </Link>
      {/* Briefs: the "To do" count on the Briefs page (unknown senders + briefs that need a spec or a review). */}
      <NavLinks counts={{ briefs: briefs.filter((b) => needsAction(b.jobSpecs)).length + waitingSenders.length, approvals, jobs }} />
      <div className="ml-auto flex shrink-0 items-center gap-1 md:mt-auto md:ml-0 md:flex-col md:gap-3">
        <KeysChip />
        <GmailChip />
        <HelpLink />
        <div className="hidden md:block">
          <CostBadge />
        </div>
      </div>
    </aside>
  );
}
