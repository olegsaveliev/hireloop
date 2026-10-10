// Shared look of the tab contents under a candidate on the Job page (pre-screen, submission, interview, outcome,
// why shortlisted, conversation). 2026-10-10: open layout, no boxes (the tab is the frame): a status line, the content,
// facts as mono label / value pairs, and the buttons bottom right. Lime = starts an agent, outline = open / secondary.
export const panel = "pt-5 text-base text-ink";
export const panelLabel = "font-mono text-[11px] tracking-[0.15em] uppercase text-stone-500";
export const panelMeta = "font-mono text-[13px] text-stone-500";
export const btnLime =
  "inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-brand bg-brand px-5 py-2.5 text-base font-semibold text-ink hover:not-disabled:border-brand-hover hover:not-disabled:bg-brand-hover disabled:cursor-not-allowed disabled:text-ink/40";
export const btnOutline =
  "inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-stone-300 px-5 py-2.5 text-base text-ink hover:bg-white disabled:opacity-40";
export const field = "w-full rounded-xl border border-stone-300 bg-field px-4 py-2.5 text-base focus:border-ink focus:outline-none";
// Tag colours as on the canvas mockup (t-green, t-rose, t-grey, t-amber, t-soft).
export const TONE = {
  green: "bg-emerald-100 text-emerald-800",
  solid: "bg-emerald-600 text-white",
  rose: "bg-rose-100 text-rose-800",
  grey: "bg-stone-200 text-stone-600",
  amber: "bg-amber-100 text-amber-800",
  soft: "bg-soft text-olive",
  lime: "bg-brand text-ink",
} as const;
export type Tone = keyof typeof TONE;
