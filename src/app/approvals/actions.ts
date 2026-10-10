"use server";

import { revalidatePath } from "next/cache";
import { applyAnswers, approveSpec, dismissProblem, rejectSpec, retryProblem, type ApplyAnswersResult } from "@/agents/job-spec/workflow";
import type { OpenQuestionAnswer } from "@/agents/job-spec/schema";
import { retryJobProblem } from "@/agents/pipeline/workflow";
import { retryInbound } from "@/agents/inbound/workflow";
import { retryGmailSend } from "@/agents/tools/mock-inbox";
import { createGoogleEventNow } from "@/agents/scheduling/workflow";
import { db } from "@/lib/db";
import { asState, type ActionState } from "../action-state";
import { startPipelineInBackground } from "../pipeline-background";

// Approving a spec creates a job and starts Steps 2-4 (sourcing, enrichment, screening) in the background.
export async function approveSpecAction(specId: string, spec: unknown, answers: OpenQuestionAnswer[]): Promise<ActionState> {
  return asState(async () => startPipelineInBackground(await approveSpec(specId, spec, answers)));
}

export async function rejectSpecAction(specId: string, comment: string): Promise<ActionState> {
  return asState(() => rejectSpec(specId, comment));
}

// "Try again": Step 1 problems re-run the job spec agent; Steps 2-4 problems resume the job's pipeline.
export async function retryProblemAction(itemId: string): Promise<ActionState> {
  return asState(async () => {
    const item = await db.approvalItem.findUniqueOrThrow({ where: { id: itemId } });
    if (item.inboundEmailId) return retryInbound(itemId); // Gmail inbound classifier (docs/specs/11-gmail-inbound.md)
    if (item.kind === "gmail_send_failed") return retryGmailSend(itemId); // docs/specs/12-gmail-outreach.md
    if (item.kind === "google_event_failed" && item.jobId && item.candidateId) {
      const iv = await db.interview.findUnique({ where: { jobId_candidateId: { jobId: item.jobId, candidateId: item.candidateId } } });
      if (iv) return createGoogleEventNow(iv.id); // docs/specs/14-google-calendar.md
    }
    if (item.step >= 2 && item.jobId) return startPipelineInBackground(await retryJobProblem(itemId));
    return retryProblem(itemId);
  });
}

export async function dismissProblemAction(itemId: string): Promise<ActionState> {
  return asState(() => dismissProblem(itemId));
}

export async function applyAnswersAction(specId: string, spec: unknown, answered: { question: string; answer: string }[]): Promise<ApplyAnswersResult> {
  try {
    return await applyAnswers(specId, spec, answered);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    revalidatePath("/runs"); // new agent run row
  }
}
