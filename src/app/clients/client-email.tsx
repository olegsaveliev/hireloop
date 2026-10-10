"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "../action-state";
import { setClientEmailAction } from "../inbound-actions";

const field = "min-w-0 flex-[1_1_220px] rounded-xl border border-stone-300 bg-field px-4 py-2.5 text-base placeholder:text-stone-400 focus:border-ink focus:outline-none";
const outline = "whitespace-nowrap rounded-xl border border-stone-300 px-5 py-2.5 text-base text-ink hover:bg-white disabled:opacity-40";

// Clients page contact line (2026-10-10): the client's email, where submissions go, with "Edit email" / "Add email".
// No email = nothing can be sent to this client, so it says so in red.
export function ClientEmail({ clientId, contact }: { clientId: string; contact: { name: string | null; email: string } | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ email: contact?.email ?? "", name: contact?.name ?? "" });
  const [result, setResult] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await setClientEmailAction(clientId, v);
      setResult(r);
      if (r?.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (!editing) {
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-base break-words">
        {contact ? (
          <span className="text-stone-600">{[contact.name, contact.email].filter(Boolean).join(" · ")}</span>
        ) : (
          <span className="text-rose-700">No email yet: submissions can&apos;t be sent</span>
        )}
        <button type="button" onClick={() => (setResult(null), setEditing(true))} className="text-ink underline underline-offset-4 hover:no-underline">
          {contact ? "Edit email" : "Add email"}
        </button>
        {result?.ok && <span className="text-sm text-emerald-700">{result.message}</span>}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="mt-3 flex flex-wrap items-center gap-2">
      <input
        type="email"
        required
        autoFocus
        aria-label="Client email"
        value={v.email}
        onChange={(e) => setV({ ...v, email: e.target.value })}
        placeholder="Email, where submissions go"
        className={field}
      />
      <input aria-label="Contact name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Contact name (optional)" className={field} />
      <button type="submit" disabled={pending} className="rounded-xl bg-ink px-5 py-2.5 text-base font-semibold whitespace-nowrap text-white hover:bg-black disabled:opacity-40">
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className={outline}>
        Cancel
      </button>
      {result && !result.ok && <span className="basis-full text-sm text-rose-700">{result.message}</span>}
    </form>
  );
}
