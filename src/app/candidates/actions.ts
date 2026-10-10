"use server";

import { revalidatePath } from "next/cache";
import { deleteUploadedCv } from "@/agents/cv-reader/workflow";
import type { ActionState } from "../action-state";

// Uploading goes through the route in ./upload (one file per request, so the page can show each file's progress).

export async function deleteCvAction(candidateId: string): Promise<ActionState> {
  const result = await deleteUploadedCv(candidateId);
  revalidatePath("/", "layout");
  return result;
}
