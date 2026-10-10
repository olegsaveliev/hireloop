"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "./action-state";
import { Dropdown, timeZoneOptions } from "./dropdown";
import { linkSenderAction, newClientAction, notClientAction } from "./inbound-actions";

const input = "rounded border border-zinc-300 bg-white px-2 py-1 text-sm";
export const TIME_ZONES = ["Europe/Kyiv", "Europe/Warsaw", "Europe/Berlin", "Europe/Amsterdam", "Europe/London", "America/New_York", "America/Chicago", "America/Los_Angeles"];

// "Which client is this?" on an email from an unknown sender (docs/specs/11-gmail-inbound.md, Briefs page): link to a
// client, create a new client, or not a client.
export function NewSenderForm({ inboundId, clients }: { inboundId: string; clients: { id: string; name: string }[] }) {
  const [mode, setMode] = useState<"link" | "new">("link");
  const [linkState, link, linking] = useActionState<ActionState, FormData>(linkSenderAction.bind(null, inboundId), null);
  const [newState, create, creating] = useActionState<ActionState, FormData>(newClientAction.bind(null, inboundId), null);
  const [notState, notClient, marking] = useActionState<ActionState>(notClientAction.bind(null, inboundId), null);
  const state = linkState ?? newState ?? notState;

  return (
    <div className="flex flex-col items-end gap-2" onClick={(e) => e.stopPropagation()}>
      {mode === "link" ? (
        <form action={link} className="flex items-center gap-2">
          <Dropdown
            name="clientId"
            required
            label="Client"
            placeholder="Link to client…"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            buttonClassName={input}
          />
          <button disabled={linking} className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            {linking ? "Linking…" : "Link"}
          </button>
        </form>
      ) : (
        <form action={create} className="flex flex-wrap items-center justify-end gap-2">
          <input name="name" required placeholder="Client name" className={`${input} w-36`} />
          <input name="country" required placeholder="Country" className={`${input} w-28`} />
          <Dropdown name="timezone" label="Time zone" defaultValue="Europe/Warsaw" options={timeZoneOptions(TIME_ZONES)} buttonClassName={input} />
          <button disabled={creating} className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            {creating ? "Creating…" : "Create client"}
          </button>
        </form>
      )}
      <div className="flex items-center gap-3 text-xs">
        <button type="button" onClick={() => setMode(mode === "link" ? "new" : "link")} className="text-zinc-600 hover:underline">
          {mode === "link" ? "New client instead" : "Existing client instead"}
        </button>
        <form action={notClient}>
          <button disabled={marking} className="text-zinc-500 hover:underline disabled:opacity-40">
            Not a client
          </button>
        </form>
      </div>
      {state && <span className={`max-w-md text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
    </div>
  );
}
