import { OUTCOMES, type OutcomeKind } from "@/config/feedback";
import type { FollowUpStatus } from "@/agents/outreach/workflow";

// The "Next" line on a shortlisted candidate's card on the Job page: what is waiting, and who has to act.
// Read-only: the buttons that act stay in the card (pre-screen, interview, outcome) or on the approval screens.
export type NextStep = { text: string; who: "you" | "waiting" | "agent" | "done"; href?: string; label?: string };

const DRAFT_TEXT: Record<string, string> = {
  first: "Approve the first message",
  follow_up: "Approve the follow-up",
  reply: "Approve the reply to the candidate",
  prescreen: "Approve the pre-screen questions",
};

export function nextStep(x: {
  jobId: string;
  stage: string;
  hasEmail: boolean;
  outreachNote: string | null;
  draftKind: string | null; // an outbound message waiting for approval (Review outreach screen)
  followUp: FollowUpStatus | undefined;
  prescreen: { data: unknown; decision: string | null; recommendation: string | null } | undefined;
  submission: { id: string; status: string } | undefined; // the latest one
  rateNeeded: boolean;
  interview: { id: string; status: string } | undefined;
  clientReplied: boolean; // a real client reply with the AI's hint, waiting for the "Client …" buttons
  outcome: OutcomeKind | null;
}): NextStep {
  const review = (text: string, href: string, label: string): NextStep => ({ text, who: "you", href, label });
  if (x.outcome) return { text: `Done: ${OUTCOMES[x.outcome].label.toLowerCase()}`, who: "done" };
  if (x.draftKind) return review(DRAFT_TEXT[x.draftKind] ?? "Approve the draft", `/approvals/outreach/${x.jobId}`, "Review draft");
  if (x.submission?.status === "awaiting_approval") return review("Account manager approves the submission", `/approvals/submission/${x.submission.id}`, "Review submission");
  if (x.rateNeeded) return review("Add the candidate's rate so the submission can be written", "/approvals", "Approval queue");
  if (x.clientReplied) return { text: "The client replied: record their answer below", who: "you" };

  const iv = x.interview;
  if (iv) {
    if (iv.status === "times_draft") return review("Approve the interview times", `/approvals/interview/${iv.id}`, "Review times");
    if (iv.status === "escalated") return review("Scheduling needs you", "/approvals", "Approval queue");
    if (iv.status === "finding") return { text: "Finding interview times…", who: "agent" };
    if (iv.status === "proposed" || iv.status === "rescheduled") return { text: "Waiting for the candidate to pick an interview time", who: "waiting" };
    if (iv.status === "awaiting_client") return { text: "Waiting for the client to confirm the interview time", who: "waiting" };
    if (iv.status === "confirmed") return { text: "Interview booked: record the outcome after it", who: "waiting" };
    if (iv.status === "no_show") return { text: "The candidate missed the interview: record the outcome", who: "you" };
  }
  if (x.submission?.status === "sent") {
    if (x.stage === "client_rejected") return { text: "The client passed: record the outcome", who: "you" };
    return { text: "Submitted: waiting for the client's answer", who: "waiting" };
  }

  const pre = x.prescreen;
  if (pre) {
    if (!pre.data) return { text: "Waiting for the pre-screen answers", who: "waiting" };
    if (pre.decision === "dont_submit") return { text: "You chose not to submit: record the outcome", who: "you" };
    if (pre.decision === "submit" || (!pre.decision && pre.recommendation === "proceed")) return { text: "The agent is writing the submission…", who: "agent" };
    return { text: "Read the pre-screen summary and decide below", who: "you" };
  }

  if (x.stage === "shortlisted") {
    if (!x.hasEmail) return { text: x.outreachNote ?? "No email: contact them another way", who: "you" };
    return { text: "The agent is writing the first message…", who: "agent" };
  }
  if (x.stage === "contacted") {
    if (x.followUp?.due) return { text: "No reply yet: a follow-up is due (Run follow-ups now)", who: "you" };
    return { text: `Waiting for their reply${x.followUp ? ` · ${x.followUp.reason}` : ""}`, who: "waiting" };
  }
  if (x.stage === "replied") return { text: "They replied: see the conversation", who: "you" };
  if (x.stage === "declined") return { text: "Declined", who: "done" };
  return { text: x.stage.replaceAll("_", " "), who: "waiting" };
}
