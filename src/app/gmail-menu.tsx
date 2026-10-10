"use client";

import { useEffect, useRef, useState } from "react";
import { ActionButton } from "./action-button";
import { icons } from "./icons";
import { RailTip, railIdle, railItem } from "./nav-links";
import { disconnectGmailAction } from "./inbound-actions";
import { GOOGLE_GROUP, KeyGroupForm, type KeyField } from "./keys-menu";

type Status = { connected: boolean; email: string | null; missingCalendar: boolean; googleReady: boolean };

const connectButton = "self-start rounded-lg border border-brand bg-brand px-4 py-2 text-sm font-semibold text-ink hover:border-brand-hover hover:bg-brand-hover";

// Left rail, bottom: everything Google (docs/specs/11-gmail-inbound.md, 16-bring-your-own-key.md). Mail icon with a
// dot: green = connected, amber = login expired, grey = not connected. Click for the connection and the Google keys.
export function GmailMenu({ s, fields, redirectUri }: { s: Status; fields: KeyField[]; redirectUri: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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

  const signedIn = s.connected || !!s.email; // connected, or connected before and the login expired
  const dot = s.connected ? "bg-green-400" : s.email ? "bg-amber-500" : "bg-white/40";
  const label = s.connected ? "Gmail connected" : s.email ? "Gmail login expired" : "Connect Gmail";
  const keysForm = <KeyGroupForm {...GOOGLE_GROUP} fields={fields} redirectUri={redirectUri} />;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={label} className={`${railItem} ${open ? "bg-brand text-ink" : railIdle}`}>
        {icons.mail}
        <span className={`absolute top-2.5 right-2.5 h-2.5 w-2.5 rounded-full ring-2 ring-rail ${dot}`} />
        {!open && <RailTip>{label}</RailTip>}
      </button>
      {open && (
        <div className="absolute top-14 right-0 z-30 flex max-h-[85vh] w-[min(25rem,calc(100vw-1.5rem))] flex-col gap-4 overflow-y-auto rounded-2xl border border-stone-200 bg-white p-5 text-sm shadow-xl md:top-auto md:right-auto md:bottom-0 md:left-full md:ml-3">
          <div className="text-lg font-semibold">Gmail and Calendar</div>
          {s.connected ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 font-medium">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Connected
              </div>
              <div className="break-all text-stone-600">{s.email}</div>
              <div className="text-stone-500">Reads your Gmail label “Briefs” and calendar free/busy.</div>
              {s.missingCalendar && (
                <a href="/api/google/connect" className="text-amber-800 underline" title="Lets the app read when you're busy (free/busy only), so it doesn't propose interview times when you can't join">
                  Connect again to allow the calendar check
                </a>
              )}
            </div>
          ) : s.email ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 font-medium">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Login expired
              </div>
              <div className="text-stone-500">Google ends test-app logins for {s.email} after 7 days.</div>
              {/* A plain link: the sign-in is a full-page redirect to Google and back. */}
              <a href="/api/google/connect" className={connectButton}>
                Connect again
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-stone-500">
                Sends approved emails, reads replies and briefs, and books interviews in your calendar.
                {!s.googleReady && " First add your Google OAuth client below, then connect."}
              </p>
              {s.googleReady ? (
                <a href="/api/google/connect" className={connectButton}>
                  Connect Gmail
                </a>
              ) : (
                <span className="self-start rounded-lg border border-stone-200 bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-400">Connect Gmail</span>
              )}
            </div>
          )}
          {signedIn && (
            <div className="self-start">
              <ActionButton action={disconnectGmailAction} label="Disconnect" variant="outlineSm" />
            </div>
          )}
          {s.googleReady ? (
            <details className="border-t border-stone-200 pt-4 [&_section]:border-t-0 [&_section]:pt-3">
              <summary className="cursor-pointer font-semibold">Google settings</summary>
              {keysForm}
            </details>
          ) : (
            keysForm
          )}
        </div>
      )}
    </div>
  );
}
