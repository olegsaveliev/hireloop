// More decimals for small amounts, so a $0.025 budget doesn't show as "$0.03".
export const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);

export const pct = (n: number) => `${Math.round(n * 100)}%`;

export const dateTime = (d: Date) =>
  d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Screening reasons as sentences: the first is the summary, the rest open under it (Job page, Review outreach).
export const sentences = (t: string | null) =>
  (t ?? "")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((x) => x.trim())
    .filter(Boolean);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
