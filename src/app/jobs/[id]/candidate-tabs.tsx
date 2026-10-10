"use client";

import { useState, type ReactNode } from "react";
import { markSeenAction } from "../actions";

// unseen = new emails in this tab, received or sent ("New" tag); clicking the tab marks them seen.
export type CandidateTab = { key: string; label: string; dot?: boolean; unseen?: string[]; content: ReactNode };

// Small tabs under a shortlisted candidate on the Job page (2026-10-10): only the parts they have (Pre-screen,
// Submission, Interview, Outcome, Why shortlisted, Candidate, Client). The current step opens first; an amber dot = needs
// you; a lime "New" tag = emails not opened yet.
export function CandidateTabs({ tabs, initial }: { tabs: CandidateTab[]; initial: string }) {
  const [active, setActive] = useState(tabs.some((t) => t.key === initial) ? initial : tabs[0]?.key);
  const [opened, setOpened] = useState<string[]>([]); // tabs clicked here: their "New" tag goes
  const shown = tabs.find((t) => t.key === active);
  return (
    <div className="mt-5 max-w-4xl">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-stone-300">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                setActive(t.key);
                setOpened((o) => [...o, t.key]);
                // Clicked = read (also when it was already open): saved, so the tag stays gone.
                if (t.unseen?.length && !opened.includes(t.key)) void markSeenAction(t.unseen);
              }}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-base whitespace-nowrap ${on ? "border-ink text-ink" : "border-transparent text-stone-500 hover:text-ink"}`}
            >
              {t.label}
              {!!t.unseen?.length && !opened.includes(t.key) && (
                <span className="rounded bg-brand px-1.5 py-0.5 text-xs font-semibold text-ink">{t.unseen.length === 1 ? "New" : `${t.unseen.length} new`}</span>
              )}
              {t.dot && <span aria-label="needs you" className="size-2 rounded-full bg-amber-500" />}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="pt-1">
        {shown?.content}
      </div>
    </div>
  );
}
