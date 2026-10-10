"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { exampleBriefs } from "@/lib/example-briefs";
import { createBriefAction, exampleClientAction } from "./actions";
import type { ActionState } from "./action-state";
import { Dropdown, timeZoneOptions } from "./dropdown";
import { icons } from "./icons";
import { TIME_ZONES } from "./new-sender-form";

// New brief page mockup (2026-10-09): two columns ("01 The request", "02 The context"), lime Create brief.
const ink = "text-ink";
const muted = "text-stone-500";
const field = `w-full rounded-xl border border-stone-300 bg-white px-5 py-4 text-lg ${ink} placeholder:text-stone-400 focus:border-ink focus:outline-none`;
const label = "mb-3 block text-lg font-semibold";
const empty = { clientId: "", clientName: "", clientCountry: "", clientTimezone: "Europe/Warsaw", clientEmail: "", fromName: "", fromEmail: "", subject: "", body: "" };

// The form on /briefs/new: paste a client email (fictional text only) to add it under To do.
// "+ New client…" in the Client list adds the client together with the brief (picked already when there are no clients).
export function NewBriefForm({ clients: initialClients }: { clients: { id: string; name: string }[] }) {
  const [clients, setClients] = useState(initialClients);
  const [v, setV] = useState({ ...empty, clientId: initialClients.length ? "" : "new" });
  const [loadingExample, startExample] = useTransition();
  const [sender, setSender] = useState(false);
  const [example, setExample] = useState(-1);
  // On success the action sends you back to Briefs; on a problem it returns the message shown by the button.
  const [state, action, pending] = useActionState<ActionState, FormData>(createBriefAction, null);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  // A different made-up brief on each click. Its client is added to the Client list (if new) and picked;
  // the brief itself is saved only by Create brief.
  const tryExample = () =>
    startExample(async () => {
      const i = (example + 1) % exampleBriefs.length;
      const ex = exampleBriefs[i];
      const client = await exampleClientAction(i);
      setExample(i);
      if (client && !clients.some((c) => c.id === client.id))
        setClients([...clients, client].sort((a, b) => a.name.localeCompare(b.name)));
      setV({ ...empty, ...ex, clientId: client?.id ?? "" });
      setSender(true);
    });

  return (
    <form action={action} className={`flex flex-col gap-10 ${ink}`}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className={`font-mono text-sm tracking-[0.2em] uppercase ${muted}`}>
            <Link href="/" className="hover:text-ink">Briefs</Link> / New brief
          </div>
          <h1 className="mt-5 text-5xl leading-[0.95] font-bold tracking-[-0.045em] sm:text-7xl lg:text-[5.5rem]">Start with the ask.</h1>
          <p className={`mt-5 text-lg ${muted}`}>Paste the request. Give it context. Take it from there.</p>
        </div>
        <button
          type="button"
          onClick={tryExample}
          disabled={loadingExample}
          className="inline-flex items-center gap-3 rounded-xl border border-stone-300 px-6 py-3.5 text-lg hover:bg-white"
        >
          {icons.flask} {loadingExample ? "Filling…" : "Try an example"}
        </button>
      </div>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-0">
        {/* 01 The request */}
        <section className="space-y-8 lg:pr-12">
          <SectionTitle n="01">The request</SectionTitle>
          <div>
            <label htmlFor="subject" className={label}>Subject *</label>
            <input id="subject" name="subject" required value={v.subject} onChange={set("subject")} className={field} placeholder="e.g. Senior Go developer for a growing team" />
          </div>
          <div>
            <label htmlFor="body" className={label}>Client’s message *</label>
            <div className="overflow-hidden rounded-xl border border-stone-300 bg-white focus-within:border-ink">
              <textarea
                id="body"
                name="body"
                required
                rows={10}
                value={v.body}
                onChange={set("body")}
                className="block w-full resize-y bg-transparent px-6 py-5 font-sans text-lg placeholder:text-stone-400 focus:outline-none"
                placeholder={"Paste the client's email here.\n\nThe original wording is perfect — no need to tidy it up."}
              />
              <div className={`flex justify-between border-t border-stone-200 px-6 py-3.5 ${muted}`}>
                <span>Original email or notes</span>
                <span>{v.body.length.toLocaleString("en-US")} characters</span>
              </div>
            </div>
            <p className={`mt-3 ${muted}`}>Role, location, budget, timing — include whatever the client shared.</p>
          </div>
        </section>

        {/* 02 The context */}
        <section className="space-y-8 lg:border-l lg:border-stone-300 lg:pl-12">
          <SectionTitle n="02">The context</SectionTitle>
          <div>
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor="clientId" className={label}>Client *</label>
              {/* New tab, so what's typed here stays. */}
              <Link href="/clients" target="_blank" className={`${muted} hover:text-ink hover:underline`}>
                Manage clients ↗
              </Link>
            </div>
            <Dropdown
              id="clientId"
              name="clientId"
              required
              size="lg"
              placeholder="Choose a client"
              value={v.clientId}
              onChange={(clientId) => setV({ ...v, clientId })}
              options={[...clients.map((c) => ({ value: c.id, label: c.name })), { value: "new", label: "+ New client…" }]}
              buttonClassName={field}
            />
            {v.clientId === "new" && (
              <div className="mt-4 space-y-4">
                <input name="clientName" aria-label="Client name" required value={v.clientName} onChange={set("clientName")} className={field} placeholder="Client name *" />
                <input name="clientCountry" aria-label="Country" required value={v.clientCountry} onChange={set("clientCountry")} className={field} placeholder="Country *, e.g. Germany" />
                <input
                  name="clientEmail"
                  aria-label="Client email"
                  type="email"
                  required
                  value={v.clientEmail}
                  onChange={set("clientEmail")}
                  className={field}
                  placeholder="Client email *, where submissions go"
                />
                <Dropdown
                  name="clientTimezone"
                  label="Time zone"
                  size="lg"
                  value={v.clientTimezone}
                  onChange={(clientTimezone) => setV({ ...v, clientTimezone })}
                  options={timeZoneOptions(TIME_ZONES)}
                  buttonClassName={field}
                />
              </div>
            )}
          </div>

          <div className="border-b border-stone-300 pb-6">
            <button type="button" onClick={() => setSender((s) => !s)} aria-expanded={sender} className="flex w-full items-center gap-4 text-left text-lg">
              <span className="flex-1">Sender details</span>
              <span className={muted}>Optional</span>
              <span className={`transition-transform ${sender ? "rotate-45" : ""}`}>{icons.plus}</span>
            </button>
            {/* Hidden, not removed, so typed values are still sent when the section is closed. */}
            <div className={`${sender ? "" : "hidden"} mt-5 space-y-4`}>
              <input name="fromName" aria-label="Sender name" value={v.fromName} onChange={set("fromName")} className={field} placeholder="Name, e.g. Anna Kowalska" />
              <input name="fromEmail" aria-label="Sender email" type="email" value={v.fromEmail} onChange={set("fromEmail")} className={field} placeholder="Email" />
            </div>
          </div>

          <div>
            <div className={`font-mono text-sm tracking-[0.2em] uppercase ${muted}`}>What happens next</div>
            <p className="mt-4 text-2xl leading-tight font-bold tracking-tight">
              A brief today.
              <br />A clearer role tomorrow.
            </p>
            <ol className={`mt-6 space-y-5 text-lg ${muted}`}>
              {[
                "Your request joins To do on the Briefs page.",
                "You click Create spec, and an agent turns the brief into a job spec.",
                "You review the spec before anything moves forward.",
              ].map((t, i) => (
                <li key={t} className="flex gap-4">
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-full border border-stone-300 text-sm ${ink}`}>{i + 1}</span>
                  <span className="pt-0.5">{t}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-6 border-t border-stone-300 pt-8">
        <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-3">
          {state && !state.ok && <span className="text-red-700">{state.message}</span>}
          <Link href="/" className="text-xl hover:underline">Cancel</Link>
          <button
            disabled={pending}
            className="inline-flex items-center gap-6 rounded-xl bg-brand px-10 py-5 text-xl font-semibold hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed disabled:text-ink/40"
          >
            {pending ? "Adding…" : "Create brief"} {icons.arrowUpRight}
          </button>
        </div>
      </div>
    </form>
  );
}

function SectionTitle({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-4 text-xl font-semibold">
      <span className="flex size-12 items-center justify-center rounded-md bg-brand font-mono text-lg font-bold">{n}</span>
      {children}
    </h2>
  );
}
