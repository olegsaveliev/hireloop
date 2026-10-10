"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export type Confirm = { title: string; body?: string; ok: string };

// "Are you sure?" in the app's look (replaces the browser's confirm box): dimmed page like the email panel, white card,
// Cancel and a dark ink button (like Review spec). Cancel has the focus, so Enter doesn't delete by accident; Esc or a click outside cancels.
export function ConfirmDialog({ confirm, onOk, onCancel }: { confirm: Confirm; onOk: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 text-ink" onClick={(e) => e.stopPropagation()}>
      <div className="hl-dim absolute inset-0 bg-stone-900/30" onClick={onCancel} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <h2 id="confirm-title" className="text-2xl leading-tight font-bold tracking-tight break-words">{confirm.title}</h2>
        {confirm.body && <p className="mt-3 text-base text-stone-500">{confirm.body}</p>}
        <div className="mt-8 flex flex-wrap justify-end gap-3">
          <button type="button" autoFocus onClick={onCancel} className="rounded-xl border border-stone-300 px-5 py-2.5 text-base hover:bg-stone-100">
            Cancel
          </button>
          <button type="button" onClick={onOk} className="rounded-xl bg-ink px-5 py-2.5 text-base font-semibold text-white hover:bg-black">
            {confirm.ok}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
