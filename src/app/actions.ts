"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSpecsFromBrief } from "@/agents/job-spec/workflow";
import { checkClientEmail, checkNewClient, createClient, EMAIL } from "@/agents/inbound/workflow";
import { db } from "@/lib/db";
import { exampleBriefs } from "@/lib/example-briefs";
import { toTestInbox } from "@/lib/test-inbox";
import { asState, type ActionState } from "./action-state";

// Briefs inbox: "Create spec".
export async function createSpecAction(briefId: string): Promise<ActionState> {
  return asState(() => createSpecsFromBrief(briefId));
}

// New brief page (/briefs/new): paste a client email, for an existing client or a new one ("+ New client…").
// On success, back to Briefs with a note.
export async function createBriefAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  let clientId = text("clientId");
  const subject = text("subject");
  const body = text("body");
  const newClient = { name: text("clientName"), country: text("clientCountry"), timezone: text("clientTimezone") };
  // Example briefs use placeholder addresses; they become your test inbox, if one is set (src/lib/test-inbox.ts).
  const clientEmail = toTestInbox(text("clientEmail").toLowerCase());
  const fromEmail = toTestInbox(text("fromEmail").toLowerCase());
  if (clientId === "new") {
    const problem = checkNewClient(newClient) ?? (await checkClientEmail(clientEmail));
    if (problem) return { ok: false, message: problem };
  } else if (!clientId || !(await db.client.findUnique({ where: { id: clientId } }))) return { ok: false, message: "Choose a client." };
  if (!subject) return { ok: false, message: "Add a subject." };
  if (body.length < 10) return { ok: false, message: "The email text is too short." };
  if (body.length > 20_000) return { ok: false, message: "The email text is too long (max 20,000 characters)." };
  // The new client is saved only once the brief itself is fine, so a failed form leaves no half-made client behind.
  if (clientId === "new") {
    clientId = await createClient(newClient);
    await db.clientContact.create({ data: { email: clientEmail, clientId, name: text("fromName") || null } });
  }
  // A sender email that isn't known yet becomes one of the client's contacts (a client with no email gets it as its email).
  if (fromEmail && EMAIL.test(fromEmail) && !(await db.clientContact.findUnique({ where: { email: fromEmail } }))) {
    await db.clientContact.create({ data: { email: fromEmail, clientId, name: text("fromName") || null } });
  }

  await db.clientBrief.create({
    data: {
      id: `brief-${randomUUID().slice(0, 8)}`,
      clientId,
      fromName: text("fromName") || "Unknown sender",
      fromEmail,
      subject,
      body,
      receivedAt: new Date(),
      source: "manual",
    },
  });
  revalidatePath("/", "layout");
  redirect("/?added=1");
}

// New brief page: "Try an example" adds the example's made-up client if it isn't there yet, so the Client list can pick it.
export async function exampleClientAction(index: number): Promise<{ id: string; name: string } | null> {
  const ex = exampleBriefs[index];
  if (!ex) return null;
  const found = await db.client.findFirst({ where: { OR: [{ id: ex.clientId }, { name: ex.client.name }] }, select: { id: true, name: true } });
  if (found) return found;
  const created = await db.client.create({ data: { id: ex.clientId, ...ex.client }, select: { id: true, name: true } });
  revalidatePath("/", "layout");
  return created;
}
