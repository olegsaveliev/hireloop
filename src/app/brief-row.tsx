"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { icons } from "./icons";

type Email = { subject: string; fromName: string; fromEmail: string; when: string; body: string };

// One brief (or unknown-sender email) on the Briefs page: number, summary and buttons, then the mail icon and `remove`
// (the bin). The mail icon opens the
// email in a side panel from the right (email panel mockup, 2026-10-09); `extras` sit quietly under the text and
// `footer` is the row's next step (Create spec / Review spec / Open job), repeated at the bottom of the panel.
export function BriefRow({
  number,
  label = "Brief",
  main,
  actions,
  remove,
  email,
  footer,
  extras,
}: {
  number: number;
  label?: string;
  main: ReactNode;
  actions?: ReactNode;
  remove?: ReactNode;
  email: Email;
  footer?: ReactNode;
  extras?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const n = String(number).padStart(2, "0");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 py-6 sm:flex-nowrap">
        <span className="w-8 shrink-0 self-start pt-1.5 font-mono text-sm text-stone-500 tabular-nums sm:w-12 sm:pl-2">{n}</span>
        <div className="min-w-0 flex-[1_1_300px]">{main}</div>
        <div className="flex flex-wrap items-center justify-end gap-2 max-sm:basis-full">
          {actions}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label="Original email"
            title="Original email"
            className="rounded-xl border border-stone-300 p-3 text-ink hover:bg-white"
          >
            {icons.mail}
          </button>
          {remove}
        </div>
      </div>
      {open && (
        <EmailPanel kicker={`${label} ${n} / Source`} email={email} footer={footer} extras={extras} onClose={close} />
      )}
    </div>
  );
}

function EmailPanel({ kicker, email, footer, extras, onClose }: { kicker: string; email: Email; footer?: ReactNode; extras?: ReactNode; onClose: () => void }) {
  // Esc closes the panel; the page behind doesn't scroll while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  // Briefs added by hand without sender details are saved as "Unknown sender" (src/app/actions.ts): show "?".
  const initials =
    email.fromName === "Unknown sender"
      ? "?"
      : email.fromName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || email.fromEmail.slice(0, 2).toUpperCase();

  return createPortal(
    <div className="fixed inset-0 z-50 text-ink">
      <div className="hl-dim absolute inset-0 bg-stone-900/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Original email" className="hl-panel absolute inset-y-0 right-0 flex w-full max-w-[47.5rem] flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-6 border-b border-stone-300 px-5 py-6 sm:px-10 sm:py-8">
          <div>
            <div className="font-mono text-sm tracking-[0.2em] text-stone-500 uppercase">{kicker}</div>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Original email</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" autoFocus className="rounded-xl border border-stone-300 p-3 hover:bg-stone-100">
            {icons.x}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-8 sm:px-10 sm:py-10">
          <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">{email.subject}</h3>
          <div className="mt-6 flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-stone-100 text-sm">{initials}</span>
            <div className="min-w-0">
              <div className="font-semibold" title={email.fromEmail}>{email.fromName || email.fromEmail}</div>
              <div className="mt-0.5 text-stone-500">{email.when} · Original message</div>
            </div>
          </div>
          <div className="mt-8 text-lg leading-relaxed break-words whitespace-pre-wrap">{email.body}</div>
          {extras && <div className="mt-10 border-t border-stone-300 pt-6 text-stone-500">{extras}</div>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-300 bg-page px-5 py-5 sm:px-10 sm:py-6">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-lg text-stone-500 hover:bg-stone-300/70 hover:text-ink">
            Back to brief
          </button>
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}
