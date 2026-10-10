"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_DRAFT_WORDS } from "@/config/outreach";
import { initials, sentences } from "@/lib/format";
import type { ActionState } from "../../../action-state";
import { icons } from "../../../icons";
import { approveDraftsAction, rejectDraftAction } from "../../outreach-actions";

export type DraftCard = {
  messageId: string;
  candidateId: string;
  name: string;
  kindLabel: string;
  limited: boolean; // outreach messages: under MAX_DRAFT_WORDS. Pre-screen question emails have no word limit.
  toEmail: string;
  allowed: boolean; // on the send allow-list (else Gmail sending is refused in code, specs/12)
  subject: string;
  body: string;
  footer: string;
  hooks: string[];
  warning: string | null;
  title: string | null;
  years: number | null;
  location: string | null;
  recentStack: string[];
  score: number | null;
  reasons: string | null;
  overrideNote: string | null;
  replyTo: { body: string; intent: string | null; summary: string | null } | null;
  redraftOf: { comment: string } | null;
};

const muted = "text-stone-500";
const label = "font-mono text-xs tracking-[0.2em] uppercase text-stone-500";
const field = "w-full rounded-lg border border-stone-300 bg-field px-3.5 py-2 text-base focus:border-stone-500 focus:outline-none";
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function OutreachEditor({ cards }: { cards: DraftCard[] }) {
  const router = useRouter();
  const [edits, setEdits] = useState(() => Object.fromEntries(cards.map((c) => [c.messageId, { subject: c.subject, body: c.body }])));
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rejecting, setRejecting] = useState<Record<string, string | undefined>>({});
  const [result, setResult] = useState<ActionState>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Cards can change after a redraft (server re-render): keep edits for cards we know, add new ones.
  const editOf = (c: DraftCard) => edits[c.messageId] ?? { subject: c.subject, body: c.body };
  const setEdit = (id: string, patch: Partial<{ subject: string; body: string }>) =>
    setEdits((e) => ({ ...e, [id]: { ...(e[id] ?? cards.find((c) => c.messageId === id)!), ...patch } }));
  const chosen = cards.filter((c) => selected[c.messageId]);
  const blocked = (c: DraftCard) => !c.allowed || (c.limited && words(editOf(c).body) >= MAX_DRAFT_WORDS) || !editOf(c).subject.trim() || !editOf(c).body.trim();
  const bulkReady = chosen.length > 0 && !chosen.some(blocked);

  function approve(list: DraftCard[], key: string) {
    setResult(null);
    setBusy(key);
    startTransition(async () => {
      const r = await approveDraftsAction(list.map((c) => ({ messageId: c.messageId, ...editOf(c) })));
      setResult(r);
      setBusy(null);
      setSelected({});
      router.refresh();
    });
  }

  function reject(c: DraftCard) {
    setResult(null);
    setBusy(`reject-${c.messageId}`);
    startTransition(async () => {
      const r = await rejectDraftAction(c.messageId, rejecting[c.messageId] ?? "");
      setResult(r);
      setBusy(null);
      if (r?.ok) setRejecting((x) => ({ ...x, [c.messageId]: undefined }));
      router.refresh();
    });
  }

  return (
    <div>
      {/* Select all + bulk approve; stays on screen while scrolling through long drafts. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 border-b border-stone-300 bg-page py-3">
        <label className="flex cursor-pointer items-center gap-3 text-base">
          <input
            type="checkbox"
            className="size-4 accent-olive"
            checked={chosen.length === cards.length && cards.length > 0}
            onChange={(e) => setSelected(Object.fromEntries(cards.map((c) => [c.messageId, e.target.checked])))}
          />
          Select all
          <span className={muted}>
            ({cards.length} draft{cards.length === 1 ? "" : "s"})
          </span>
        </label>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {result && <span className={`max-w-md text-sm ${result.ok ? "text-emerald-700" : "text-rose-700"}`}>{result.message}</span>}
          <button
            type="button"
            disabled={pending || !bulkReady}
            onClick={() => approve(chosen, "bulk")}
            className={`inline-flex items-center gap-3 rounded-lg px-4 py-2 text-base ${
              bulkReady ? "bg-brand font-semibold hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover" : "border border-stone-300 text-stone-400"
            } disabled:cursor-not-allowed`}
          >
            {busy === "bulk" ? "Sending…" : `Approve and send selected (${chosen.length})`}
            {bulkReady && icons.arrowUpRight}
          </button>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {cards.map((c) => {
          const e = editOf(c);
          const n = words(e.body);
          const over = c.limited && n >= MAX_DRAFT_WORDS;
          const edited = e.subject !== c.subject || e.body !== c.body;
          const why = c.reasons ? sentences(c.reasons) : [];
          const meta = [c.years != null && `${c.years} years`, c.location].filter(Boolean).join(" · ");
          return (
            <article key={c.messageId} className={`overflow-hidden rounded-xl border bg-white ${selected[c.messageId] ? "border-olive-line" : "border-stone-300"}`}>
              <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 px-5 py-3.5 sm:px-6">
                <input
                  type="checkbox"
                  className="size-4 accent-olive"
                  checked={!!selected[c.messageId]}
                  onChange={(ev) => setSelected((s) => ({ ...s, [c.messageId]: ev.target.checked }))}
                  aria-label={`Select draft to ${c.name}`}
                />
                <span className="hidden size-10 shrink-0 place-items-center rounded-full bg-soft text-sm text-olive sm:grid">{initials(c.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-medium break-words">{c.name}</div>
                  <div className={`text-sm break-all ${muted}`}>Candidate · {c.toEmail}</div>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  {edited && <span className="text-sm text-olive">edited</span>}
                  <span className="rounded-lg border border-stone-300 px-3 py-1 text-sm">{c.kindLabel}</span>
                </div>
              </header>

              {(!c.allowed || c.redraftOf || c.replyTo) && (
                <div className="space-y-3 px-5 pt-4 sm:px-6">
                  {!c.allowed && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      <div className="font-semibold">Can&apos;t be sent from the app</div>
                      <div>{c.toEmail || "No address"} isn&apos;t on the send allow-list, so Gmail sending is refused. Reject it, or contact them yourself.</div>
                    </div>
                  )}
                  {c.redraftOf && (
                    <div className="rounded-r-lg border-l-4 border-olive-line bg-soft px-4 py-2 text-sm">
                      Rewritten after your comment: “{c.redraftOf.comment}”
                    </div>
                  )}
                  {c.replyTo && (
                    <div className="rounded-lg bg-stone-100/80 px-4 py-3">
                      <div className={label}>Their message · {c.replyTo.intent?.replaceAll("_", " ") ?? "not classified"}</div>
                      <div className="mt-1 text-sm whitespace-pre-wrap text-stone-700">{c.replyTo.body}</div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-5 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] lg:gap-0">
                <div className="min-w-0 space-y-3 lg:pr-6">
                  <label className="block">
                    <span className="mb-1 block text-sm text-stone-600">Subject</span>
                    <input value={e.subject} onChange={(ev) => setEdit(c.messageId, { subject: ev.target.value })} className={field} />
                  </label>
                  <label className="block">
                    <span className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm text-stone-600">
                      Message
                      <span className={`text-xs ${over ? "font-medium text-rose-700" : muted}`}>
                        {n} words{c.limited ? ` · under ${MAX_DRAFT_WORDS}` : ""}
                      </span>
                    </span>
                    <textarea
                      rows={Math.min(18, Math.max(6, e.body.split("\n").length + Math.ceil(e.body.length / 120)))}
                      value={e.body}
                      onChange={(ev) => setEdit(c.messageId, { body: ev.target.value })}
                      className={`${field} leading-relaxed ${over ? "border-rose-300" : ""}`}
                    />
                  </label>
                  {c.footer && (
                    <div className="rounded-lg bg-stone-100/80 px-4 py-3">
                      <div className={label}>Added automatically · excluded from word count</div>
                      <div className="mt-1 text-sm text-stone-600">{c.footer}</div>
                    </div>
                  )}
                  {c.warning && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">⚠ {c.warning}</div>}
                </div>

                <aside className="min-w-0 space-y-4 border-t border-stone-200 pt-4 text-sm lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                  <div>
                    <div className={label}>Candidate context</div>
                    {c.title && <div className="mt-2 text-base">{c.title}</div>}
                    {meta && <div className={`mt-1 ${muted}`}>{meta}</div>}
                    {c.recentStack.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.recentStack.map((t) => (
                          <span key={t} className="rounded-md bg-soft px-2 py-0.5 text-xs text-olive">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-stone-200 pt-4">
                    <div className="flex items-center gap-3">
                      <span className={label}>Why shortlisted</span>
                      {c.score != null && <span className="rounded-md bg-brand px-2 py-0.5 text-xs font-semibold tabular-nums">{c.score}</span>}
                    </div>
                    {why.length > 0 ? (
                      <>
                        <p className="mt-2 leading-relaxed text-stone-600">{why[0]}</p>
                        {why.length > 1 && (
                          <details className="group mt-2">
                            <summary className="flex cursor-pointer list-none items-center gap-2 text-olive [&::-webkit-details-marker]:hidden">
                              <span className="text-xs transition-transform group-open:rotate-90">▶</span>
                              Full screening reasons
                            </summary>
                            <ul className="mt-2 space-y-1.5">
                              {why.slice(1).map((w, i) => (
                                <li key={i} className="flex gap-3 leading-snug text-stone-600">
                                  <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-olive-mid" />
                                  {w}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    ) : (
                      <p className={`mt-3 ${muted}`}>–</p>
                    )}
                  </div>

                  {c.hooks.length > 0 && (
                    <div className="border-t border-stone-200 pt-4">
                      <div className={label}>Personalized with</div>
                      <ul className="mt-2 space-y-1 leading-relaxed text-stone-600">
                        {c.hooks.map((h) => (
                          <li key={h}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {c.overrideNote && <div className="rounded-lg bg-soft px-4 py-2.5 text-stone-700">Your note: {c.overrideNote}</div>}
                </aside>
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-200 bg-field px-5 py-3 sm:px-6">
                {rejecting[c.messageId] !== undefined ? (
                  <>
                    <input
                      autoFocus
                      value={rejecting[c.messageId]}
                      onChange={(ev) => setRejecting((x) => ({ ...x, [c.messageId]: ev.target.value }))}
                      placeholder="What should change? e.g. shorter, mention the remote setup"
                      className="min-w-0 flex-1 basis-72 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                    />
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => setRejecting((x) => ({ ...x, [c.messageId]: undefined }))} className={`px-2 text-sm ${muted} hover:text-ink`}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={pending || !rejecting[c.messageId]?.trim()}
                        onClick={() => reject(c)}
                        className="rounded-lg bg-ink px-4 py-2 text-base text-white hover:bg-black disabled:opacity-40"
                      >
                        {busy === `reject-${c.messageId}` ? "Rewriting… (~20s)" : "Reject and redraft"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className={`text-sm ${over ? "text-rose-700" : muted}`}>
                      {c.limited ? `Body must be under ${MAX_DRAFT_WORDS} words.` : "Pre-screen questions have no word limit."}
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setRejecting((x) => ({ ...x, [c.messageId]: "" }))}
                        className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-base hover:bg-stone-100 disabled:opacity-40"
                      >
                        Reject…
                      </button>
                      <button
                        type="button"
                        disabled={pending || blocked(c)}
                        onClick={() => approve([c], c.messageId)}
                        className="inline-flex items-center gap-3 rounded-lg bg-brand px-4 py-2 text-base font-semibold hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed disabled:text-ink/40"
                      >
                        {busy === c.messageId ? "Sending…" : "Approve and send"} {icons.arrowUpRight}
                      </button>
                    </div>
                  </>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
