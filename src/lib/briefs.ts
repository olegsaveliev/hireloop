// Briefs page sections (docs/specs/11-gmail-inbound.md, "Briefs page layout"). Shared with the left panel's Briefs count.

type SpecLite = { roleIndex: number; status: string; createdAt: Date };

// Latest version of each role's spec (older versions were rejected and regenerated).
export function latestByRole<T extends SpecLite>(specs: T[]): T[] {
  const sorted = [...specs].sort((a, b) => a.roleIndex - b.roleIndex || b.createdAt.getTime() - a.createdAt.getTime());
  return sorted.filter((s, i) => sorted.findIndex((x) => x.roleIndex === s.roleIndex) === i);
}

// "To do": no spec yet, or a role whose spec isn't approved (waiting for review, or rejected without a new draft).
export function needsAction(specs: SpecLite[]) {
  const latest = latestByRole(specs);
  return latest.length === 0 || latest.some((s) => s.status !== "approved");
}

// "Done": every role's job has a hire, or was stopped or closed.
export function jobFinished(job: { status: string }, hires: number) {
  return job.status === "stopped" || job.status === "closed" || hires > 0;
}

// One short line on where a job stands, from its status and how far its candidates got.
export function jobStage(status: string, reached: Record<string, number>) {
  const fixed: Record<string, string> = {
    ready_for_sourcing: "ready for sourcing",
    sourcing: "agents are sourcing",
    enriching: "agents are reading profiles",
    screening: "agents are scoring candidates",
    awaiting_shortlist: "waiting for shortlist",
    shortlisted: "shortlist approved",
    paused_over_budget: "paused: job budget reached",
    no_candidates: "no candidates found",
    failed: "an agent failed",
    stopped: "stopped",
    needs_candidates: "needs candidates",
    closed: "closed",
  };
  if (fixed[status]) return fixed[status];
  if (reached.hired) return `${reached.hired} hire${reached.hired > 1 ? "s" : ""}`;
  if (reached.interview) return "interviews";
  if (reached.submitted) return "sent to client";
  if (reached.prescreened) return "pre-screening";
  if (reached.replied) return "replies coming in";
  if (reached.contacted) return "candidates contacted";
  return "drafting outreach";
}
