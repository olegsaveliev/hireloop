import type { ReactNode } from "react";
import { panelLabel, panelMeta, TONE, type Tone } from "./card-styles";

// Building blocks for the tab contents under a candidate on the Job page (see card-styles.ts).

export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`rounded px-2 py-0.5 text-xs whitespace-nowrap ${TONE[tone]}`}>{children}</span>;
}

// First line of a tab: tag + one plain sentence, a date (or other meta) on the right.
export function TabHead({ tag, text, meta }: { tag?: ReactNode; text: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {tag}
      <span className="min-w-0 flex-[1_1_240px] text-lg tracking-tight break-words">{text}</span>
      {meta && <span className={panelMeta}>{meta}</span>}
    </div>
  );
}

// Key facts as label / value pairs, two columns on wide screens.
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className={panelLabel}>{k}</dt>
          <dd className="mt-1 text-base break-words text-stone-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// "Not stated" etc. inside a fact or sentence.
export const Missing = ({ children = "Not stated" }: { children?: ReactNode }) => <span className="text-amber-700">{children}</span>;

// Bottom of a tab: a note on the left, buttons on the right.
export function Actions({ note, children }: { note?: ReactNode; children?: ReactNode }) {
  if (!note && !children) return null;
  return (
    <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 pt-4">
      {note && <span className="mr-auto min-w-0 text-sm break-words text-stone-500">{note}</span>}
      {children}
    </div>
  );
}

// Numbered list in the rows style (mono 01, 02 …).
export function Numbered({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
      {items.map((it, i) => (
        <li key={i} className="flex gap-4 py-3">
          <span className="w-6 shrink-0 pt-0.5 font-mono text-[13px] text-stone-500 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
          <div className="min-w-0 flex-1 text-base leading-relaxed break-words text-stone-800">{it}</div>
        </li>
      ))}
    </ol>
  );
}
