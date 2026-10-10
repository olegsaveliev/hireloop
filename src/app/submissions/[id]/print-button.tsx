"use client";

import { useEffect } from "react";
import { icons } from "../../icons";

// `autoPrint`: opened from the PDF icon on Send to client, so the print dialog (Save as PDF) opens by itself.
export function PrintButton({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => {
    if (autoPrint) window.print();
  }, [autoPrint]);
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-base font-semibold text-ink hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover print:hidden"
    >
      {icons.fileDown} Save as PDF
    </button>
  );
}
