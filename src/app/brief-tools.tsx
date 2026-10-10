"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import type { ActionState } from "./action-state";
import { Dropdown, timeZoneOptions } from "./dropdown";
import { changeClientAction } from "./inbound-actions";
import { TIME_ZONES } from "./new-sender-form";

const input = "rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-ink";
const button = "rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm text-ink hover:bg-stone-100 disabled:opacity-40";

// In the email side panel, under the text (until the brief has a spec): the Client list moves the brief as soon as you
// pick another client; Change client opens name / country / time zone to add a new client and move the brief to it.
// Deleting is the bin on the brief's row; Manage clients opens the Clients page (delete clients there).
export function BriefTools({
  briefId,
  clientId,
  clients,
  hasSpec,
}: {
  briefId: string;
  clientId: string;
  clients: { id: string; name: string }[];
  hasSpec: boolean;
}) {
  const [state, change, changing] = useActionState<ActionState, FormData>(changeClientAction.bind(null, briefId), null);
  const [picked, setPicked] = useState(clientId); // shown in the list while a pick is saving
  const [adding, setAdding] = useState(false);
  // Once the brief's client changes, close the new-client fields (React's "adjust state when a prop changes").
  const [shownFor, setShownFor] = useState(clientId);
  if (shownFor !== clientId) {
    setShownFor(clientId);
    setPicked(clientId);
    setAdding(false);
  }

  const send = (data: FormData) => startTransition(() => change(data));
  const pick = (id: string) => {
    setPicked(id);
    const data = new FormData();
    data.set("clientId", id);
    send(data);
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`client-${briefId}`} className="text-stone-500">Client</label>
        <Dropdown
          id={`client-${briefId}`}
          value={changing ? picked : clientId}
          onChange={pick}
          disabled={hasSpec || changing}
          title={hasSpec ? "This brief already has a spec, so its client can't change." : undefined}
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
          buttonClassName={input}
        />
        {!hasSpec && !adding && (
          <button type="button" onClick={() => setAdding(true)} className={button}>
            Change client
          </button>
        )}
        <Link href="/clients" className="px-1 text-stone-500 hover:text-ink hover:underline">
          Manage clients
        </Link>
        {state && !adding && <span className={state.ok ? "text-green-700" : "text-red-700"}>{state.message}</span>}
      </div>

      {adding && (
        // Sent with onSubmit, not action=, so React doesn't empty the fields when something is missing.
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            data.set("clientId", "new");
            send(data);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input name="clientName" aria-label="Client name" required autoFocus placeholder="Client name *" className={`${input} min-w-0 flex-[1_1_180px]`} />
          <input name="clientCountry" aria-label="Country" required placeholder="Country *, e.g. Germany" className={`${input} min-w-0 flex-[1_1_160px]`} />
          <Dropdown
            name="clientTimezone"
            label="Time zone"
            defaultValue="Europe/Warsaw"
            options={timeZoneOptions(TIME_ZONES)}
            className="min-w-0 flex-[1_1_160px]"
            buttonClassName={input}
          />
          <div className="flex basis-full flex-wrap items-center gap-2">
            <button disabled={changing} className={button}>
              {changing ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-2.5 py-1.5 text-stone-500 hover:bg-stone-100 hover:text-ink">
              Cancel
            </button>
            {state && !state.ok && <span className="text-red-700">{state.message}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
