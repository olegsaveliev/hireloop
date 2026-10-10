"use client";

import { openKeysMenu } from "./keys-menu";

export function OpenKeysButton({ label = "Add keys" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // else the Keys menu's "click outside" closes it straight away
        openKeysMenu();
      }}
      className="rounded-xl border border-ink bg-ink px-5 py-2.5 font-semibold text-white hover:bg-black"
    >
      {label}
    </button>
  );
}
