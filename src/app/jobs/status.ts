// Job status tags, shared by the Jobs list, the Job page and the Shortlist / Outreach review screens. Same colours as
// Briefs: amber = waiting for you, green = agents working, red = a problem, grey = closed.
export const NEEDS_YOU = "bg-amber-100 text-amber-800";
export const WORKING = "bg-emerald-100 text-emerald-800";
export const PROBLEM = "bg-rose-100 text-rose-800";

export const STATUS: Record<string, { label: string; style: string }> = {
  ready_for_sourcing: { label: "Ready for sourcing", style: NEEDS_YOU },
  sourcing: { label: "Sourcing", style: WORKING },
  enriching: { label: "Enriching profiles", style: WORKING },
  screening: { label: "Screening", style: WORKING },
  awaiting_shortlist: { label: "Awaiting shortlist", style: NEEDS_YOU },
  shortlisted: { label: "Shortlisted", style: NEEDS_YOU },
  drafting_outreach: { label: "Agents working", style: WORKING },
  outreach: { label: "Outreach", style: WORKING },
  paused_over_budget: { label: "Paused · job budget", style: PROBLEM },
  no_candidates: { label: "No candidates", style: PROBLEM },
  failed: { label: "Failed", style: PROBLEM },
  stuck: { label: "Stuck", style: PROBLEM },
  needs_candidates: { label: "Needs candidates", style: NEEDS_YOU }, // everyone on the shortlist is out (derived)
  stopped: { label: "Stopped", style: "bg-stone-200 text-stone-600" },
  closed: { label: "Closed", style: "bg-stone-200 text-stone-600" }, // the recruiter closed the position

  hired: { label: "Hired", style: "bg-emerald-600 text-white" },
};

export const statusOf = (key: string) => STATUS[key] ?? { label: key.replaceAll("_", " "), style: "bg-stone-200 text-stone-600" };

// Statuses whose pipeline note says what went wrong (shown in red).
export const PROBLEM_NOTE = ["paused_over_budget", "no_candidates", "failed", "stopped"];
