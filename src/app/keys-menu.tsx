"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { KeyGroup } from "@/lib/settings";
import { ActionButton } from "./action-button";
import { icons } from "./icons";
import { RailTip, railIdle, railItem } from "./nav-links";
import { removeKeysAction, saveKeysAction } from "./keys-actions";

export type KeyField = {
  name: string;
  group: KeyGroup;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder: string;
  set: boolean;
  source: "app" | "env" | null;
  shown: string; // masked for secrets
};

// Other parts of the app (Connect Gmail without Google keys, the "add your key" banner) open this menu with this event.
export const OPEN_KEYS_EVENT = "hireloop:open-keys";
export const openKeysMenu = () => window.dispatchEvent(new Event(OPEN_KEYS_EVENT));

const GROUPS: { group: KeyGroup; title: string; tag: string; about: string; where: { label: string; href: string } }[] = [
  {
    group: "anthropic",
    title: "Anthropic",
    tag: "Required",
    about: "Runs the agents (Claude Haiku, Sonnet, Opus). You pay Anthropic directly; a full job costs well under $1.50.",
    where: { label: "console.anthropic.com → API keys", href: "https://console.anthropic.com/settings/keys" },
  },
  {
    group: "langfuse",
    title: "Langfuse",
    tag: "Optional",
    about: "A trace, cost and scores for every agent run (free tier is enough). Without it the agents still run.",
    where: { label: "cloud.langfuse.com → project → Settings → API keys", href: "https://cloud.langfuse.com" },
  },
  {
    group: "google",
    title: "Google (Gmail + Calendar)",
    tag: "From step 5",
    about: "Needed to send outreach and read replies: approved emails go to your test inbox, briefs can arrive by email, interviews are booked in your calendar. Step-by-step guide: docs/google-setup.md.",
    where: { label: "console.cloud.google.com → APIs & Services → Credentials", href: "https://console.cloud.google.com/apis/credentials" },
  },
];

const input = "w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-xs placeholder:text-stone-400 focus:border-ink focus:outline-none";

// Left rail, bottom: bring your own key. Same pattern as the Gmail menu: an icon with a dot, click for the panel.
// Dot: amber = no Anthropic key yet (agents can't run), green = everything set, none = optional parts missing.
export function KeysMenu({ fields, redirectUri }: { fields: KeyField[]; redirectUri: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_KEYS_EVENT, show);
    return () => window.removeEventListener(OPEN_KEYS_EVENT, show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const anthropic = fields.find((f) => f.name === "ANTHROPIC_API_KEY")?.set;
  const all = fields.filter((f) => f.name !== "GOOGLE_SEND_ALLOWLIST").every((f) => f.set);
  const dot = !anthropic ? "bg-amber-500" : all ? "bg-green-400" : null;
  const label = !anthropic ? "Keys · add your Anthropic key" : "Keys";

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={label} className={`${railItem} ${open ? "bg-brand text-ink" : railIdle}`}>
        {icons.key}
        {dot && <span className={`absolute top-2.5 right-2.5 h-2.5 w-2.5 rounded-full ring-2 ring-rail ${dot}`} />}
        {!open && <RailTip>{label}</RailTip>}
      </button>
      {open && (
        <div className="absolute top-14 right-0 z-30 flex max-h-[85vh] w-[min(25rem,calc(100vw-1.5rem))] flex-col gap-5 overflow-y-auto rounded-2xl border border-stone-200 bg-white p-5 text-sm shadow-xl md:top-auto md:right-auto md:bottom-0 md:left-full md:ml-3">
          <div>
            <div className="text-lg font-semibold">Your keys</div>
            <p className="mt-1 text-stone-500">
              Saved only in this laptop&apos;s database, never in git. Values from <span className="font-mono">.env.local</span> work too; a key saved here wins.
            </p>
          </div>
          {GROUPS.map((g) => (
            <KeyGroupForm key={g.group} {...g} fields={fields.filter((f) => f.group === g.group)} redirectUri={g.group === "google" ? redirectUri : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

function KeyGroupForm({
  group,
  title,
  tag,
  about,
  where,
  fields,
  redirectUri,
}: (typeof GROUPS)[number] & { fields: KeyField[]; redirectUri?: string }) {
  const [state, save, saving] = useActionState(saveKeysAction.bind(null, group), null);
  const savedInApp = fields.some((f) => f.source === "app");
  const ready = fields.filter((f) => f.name !== "GOOGLE_SEND_ALLOWLIST" && f.name !== "LANGFUSE_BASE_URL").every((f) => f.set);
  return (
    <section className="flex flex-col gap-3 border-t border-stone-200 pt-4">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${ready ? "bg-green-500" : tag === "Required" ? "bg-amber-500" : "bg-stone-300"}`} />
        <span className="font-semibold">{title}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tag === "Required" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-500"}`}>{tag}</span>
      </div>
      <p className="text-stone-500">{about}</p>
      <a href={where.href} target="_blank" rel="noreferrer" className="self-start text-xs text-olive underline underline-offset-2">
        {where.label}
      </a>
      {redirectUri && (
        <div className="rounded-lg bg-soft px-3 py-2 text-xs text-stone-600">
          Redirect URI to paste in Google Cloud: <span className="font-mono break-all text-ink">{redirectUri}</span>
        </div>
      )}
      <form action={save} className="flex flex-col gap-3">
        {fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-600">
              {f.label} <span className="font-mono font-normal text-stone-400">{f.name}</span>
            </span>
            <input
              name={f.name}
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              defaultValue={f.secret ? "" : f.shown}
              placeholder={f.secret && f.set ? `${f.shown} (type to replace)` : f.placeholder}
              className={input}
            />
            <span className="text-[11px] text-stone-400">
              {f.source === "app" ? `Saved in the app${f.secret ? ` · ${f.shown}` : ""}` : f.source === "env" ? `From .env.local / environment${f.secret ? ` · ${f.shown}` : ""}` : "Not set"}
            </span>
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={saving}
            className="rounded-lg border border-brand bg-brand px-4 py-2 text-sm font-semibold text-ink hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed"
          >
            {saving ? "Checking…" : "Save and check"}
          </button>
          {state && <span className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
        </div>
      </form>
      {savedInApp && (
        <div className="self-start">
          <ActionButton
            action={removeKeysAction.bind(null, group)}
            label={`Remove ${title.split(" ")[0]} keys`}
            variant="outlineSm"
            confirm={{ title: `Remove the ${title.split(" ")[0]} keys saved in the app?`, body: "Values in .env.local, if any, apply again.", ok: "Remove" }}
          />
        </div>
      )}
    </section>
  );
}
