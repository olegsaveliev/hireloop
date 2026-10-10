"use client";

import { useEffect, useRef, useState } from "react";
import { ActionButton } from "./action-button";
import { icons } from "./icons";
import { RailTip, railIdle, railItem } from "./nav-links";
import { disconnectGmailAction } from "./inbound-actions";
import { openKeysMenu } from "./keys-menu";

type Status = { connected: boolean; email: string | null; missingCalendar: boolean; googleReady: boolean };

// Left rail, bottom: Gmail connection (docs/specs/11-gmail-inbound.md). Mail icon with a green dot when connected; click for details.
export function GmailMenu({ s }: { s: Status }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  // No Google keys yet (bring your own key): the mail icon opens the Keys menu instead of a sign-in that can't work.
  if (!s.connected && !s.email && !s.googleReady)
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation(); // else the Keys menu's "click outside" closes it straight away
          openKeysMenu();
        }}
        aria-label="Connect Gmail: add your Google keys first"
        className={`${railItem} ${railIdle}`}
      >
        {icons.mail}
        <span className="absolute top-2.5 right-2.5 h-2.5 w-2.5 rounded-full bg-white/40 ring-2 ring-rail" />
        <RailTip>Connect Gmail · add your Google keys first</RailTip>
      </button>
    );

  // A plain link: the sign-in is a full-page redirect to Google and back.
  if (!s.connected && !s.email)
    return (
      <a href="/api/google/connect" aria-label="Connect Gmail" className={`${railItem} ${railIdle}`}>
        {icons.mail}
        <span className="absolute top-2.5 right-2.5 h-2.5 w-2.5 rounded-full bg-white/40 ring-2 ring-rail" />
        <RailTip>Connect Gmail</RailTip>
      </a>
    );

  const dot = s.connected ? "bg-green-400" : "bg-amber-500";
  const label = s.connected ? "Gmail connected" : "Gmail login expired";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={label} className={`${railItem} ${railIdle}`}>
        {icons.mail}
        <span className={`absolute top-2.5 right-2.5 h-2.5 w-2.5 rounded-full ring-2 ring-rail ${dot}`} />
        {!open && <RailTip>{label}</RailTip>}
      </button>
      {open && (
        <div className="absolute top-14 right-0 z-30 md:top-auto md:right-auto md:bottom-0 md:left-full md:ml-3 flex w-72 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm shadow-xl">
          {s.connected ? (
            <>
              <div className="flex items-center gap-2 font-medium">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Connected
              </div>
              <div className="break-all text-zinc-600">{s.email}</div>
              <div className="text-zinc-500">Reads your Gmail label “Briefs” and calendar free/busy.</div>
              {s.missingCalendar && (
                <a href="/api/google/connect" className="text-amber-800 underline" title="Lets the app read when you're busy (free/busy only), so it doesn't propose interview times when you can't join">
                  Connect again to allow the calendar check
                </a>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 font-medium">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Login expired
              </div>
              <div className="text-zinc-500">Google ends test-app logins for {s.email} after 7 days.</div>
              <a href="/api/google/connect" className="self-start rounded bg-zinc-900 px-3 py-1.5 text-white">
                Connect again
              </a>
            </>
          )}
          <div className="self-start">
            <ActionButton action={disconnectGmailAction} label="Disconnect" variant="secondary" />
          </div>
        </div>
      )}
    </div>
  );
}
