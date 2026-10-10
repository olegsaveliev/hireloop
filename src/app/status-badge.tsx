const STYLES: Record<string, string> = {
  awaiting_approval: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  dismissed: "bg-zinc-100 text-zinc-600",
  ready_for_sourcing: "bg-blue-100 text-blue-800",
  sourcing: "bg-blue-100 text-blue-800",
  enriching: "bg-blue-100 text-blue-800",
  screening: "bg-blue-100 text-blue-800",
  awaiting_shortlist: "bg-amber-100 text-amber-800",
  shortlisted: "bg-green-100 text-green-800",
  sourced: "bg-zinc-100 text-zinc-700",
  paused_over_budget: "bg-red-100 text-red-800",
  no_candidates: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
  stopped: "bg-zinc-200 text-zinc-700",
  stuck: "bg-red-100 text-red-800",
  // Step 5
  drafting_outreach: "bg-blue-100 text-blue-800",
  outreach: "bg-green-100 text-green-800",
  contacted: "bg-blue-100 text-blue-800",
  replied: "bg-green-100 text-green-800",
  declined: "bg-zinc-200 text-zinc-700",
  sent: "bg-green-100 text-green-800",
  received: "bg-blue-100 text-blue-800",
  cancelled: "bg-zinc-100 text-zinc-600",
  interested: "bg-green-100 text-green-800",
  question: "bg-blue-100 text-blue-800",
  later: "bg-amber-100 text-amber-800",
  not_interested: "bg-zinc-200 text-zinc-700",
  out_of_office: "bg-amber-100 text-amber-800",
  // Step 6
  prescreened: "bg-violet-100 text-violet-800",
  questions_draft: "bg-amber-100 text-amber-800",
  questions_sent: "bg-blue-100 text-blue-800",
  proceed: "bg-green-100 text-green-800",
  discuss: "bg-amber-100 text-amber-800",
  stop: "bg-red-100 text-red-800",
  // Step 7
  submitted: "bg-green-100 text-green-800",
  withdrawn: "bg-zinc-200 text-zinc-700",
  // Step 8
  interview: "bg-emerald-100 text-emerald-800",
  client_rejected: "bg-zinc-200 text-zinc-700",
  finding: "bg-blue-100 text-blue-800",
  proposed: "bg-blue-100 text-blue-800",
  rescheduled: "bg-amber-100 text-amber-800",
  awaiting_client: "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  escalated: "bg-red-100 text-red-800",
  no_show: "bg-red-100 text-red-800",
  // Step 9
  hired: "bg-emerald-600 text-white",
  withdrew: "bg-zinc-200 text-zinc-700",
  rejected_by_client: "bg-zinc-200 text-zinc-700",
  running: "bg-blue-100 text-blue-800",
  done: "bg-green-100 text-green-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${STYLES[status] ?? "bg-zinc-100 text-zinc-700"}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
