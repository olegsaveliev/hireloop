"use server";

import {
  changeBriefClient,
  changeBriefToNewClient,
  checkInbox,
  clearNotBriefs,
  createClientForSender,
  deleteClient,
  dismissInboundItem,
  linkSender,
  markAsBrief,
  markNotClient,
  regenerateWithUpdate,
  setClientEmail,
} from "@/agents/inbound/workflow";
import { disconnectGoogle, GoogleNotConnectedError } from "@/agents/tools/google-auth";
import { continueJobInBackground } from "./pipeline-background";
import { deleteBrief } from "@/agents/job-spec/workflow";
import { asState, type ActionState } from "./action-state";

// Gmail inbound (docs/specs/11-gmail-inbound.md).

export async function checkInboxAction(): Promise<ActionState> {
  return asState(async () => {
    try {
      const r = await checkInbox();
      // Candidate replies can unlock the next step (e.g. pre-screen "proceed" -> Step 7): those jobs continue.
      for (const jobId of r.jobIds) await continueJobInBackground({ ok: true, message: "", jobId });
      return { ok: r.ok, message: r.message };
    } catch (e) {
      if (e instanceof GoogleNotConnectedError) return { ok: false, message: e.message };
      throw e;
    }
  });
}

export async function disconnectGmailAction(): Promise<ActionState> {
  return asState(async () => {
    await disconnectGoogle();
    return { ok: true, message: "Gmail disconnected." };
  });
}

export async function markAsBriefAction(inboundId: string): Promise<ActionState> {
  return asState(() => markAsBrief(inboundId));
}

export async function linkSenderAction(inboundId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return asState(() => linkSender(inboundId, String(formData.get("clientId") ?? "")));
}

export async function newClientAction(inboundId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  return asState(() => createClientForSender(inboundId, { name: text("name"), country: text("country"), timezone: text("timezone") }));
}

export async function notClientAction(inboundId: string): Promise<ActionState> {
  return asState(() => markNotClient(inboundId));
}

export async function regenerateWithUpdateAction(itemId: string): Promise<ActionState> {
  return asState(() => regenerateWithUpdate(itemId));
}

export async function dismissInboundAction(itemId: string): Promise<ActionState> {
  return asState(() => dismissInboundItem(itemId));
}

// "+ New client…" (clientId "new") adds the client from the name / country / time zone fields first.
export async function changeClientAction(briefId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  if (text("clientId") === "new")
    return asState(() => changeBriefToNewClient(briefId, { name: text("clientName"), country: text("clientCountry"), timezone: text("clientTimezone") }));
  return asState(() => changeBriefClient(briefId, text("clientId")));
}

export async function deleteBriefAction(briefId: string): Promise<ActionState> {
  return asState(() => deleteBrief(briefId));
}

export async function clearNotBriefAction(inboundId: string): Promise<ActionState> {
  return asState(() => clearNotBriefs(inboundId));
}

export async function clearAllNotBriefsAction(): Promise<ActionState> {
  return asState(() => clearNotBriefs());
}

export async function deleteClientAction(clientId: string): Promise<ActionState> {
  return asState(() => deleteClient(clientId));
}

// Clients page: add or change a client's email (where submissions go).
export async function setClientEmailAction(clientId: string, input: { email: string; name: string }): Promise<ActionState> {
  return asState(() => setClientEmail(clientId, input));
}
