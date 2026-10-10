"use server";

import { approveDrafts, rejectDraft, type DraftDecision } from "@/agents/outreach/workflow";
import { asState, type ActionState } from "../action-state";

// Step 5 send approval: approve = send via mock_inbox; reject = the agent redrafts with the comment.
export async function approveDraftsAction(decisions: DraftDecision[]): Promise<ActionState> {
  return asState(() => approveDrafts(decisions));
}

export async function rejectDraftAction(messageId: string, comment: string): Promise<ActionState> {
  return asState(() => rejectDraft(messageId, comment));
}
