// Hireloop logo (2026-10-09): a loop arrow with the North Star (the candidate) in the middle, dark on a lime tile.
// The loop spins once when you hover the logo; the animation is in globals.css.
const INK = "#1a1a1a";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={`${size / 16}rem`} height={`${size / 16}rem`} viewBox="0 0 120 120" aria-hidden="true" className="shrink-0">
      <rect width="120" height="120" rx="30" fill="#E2F56C" />
      <g className="hl-loop">
        <path d="M81.86 33.95 A34 34 0 1 1 38.14 33.95" fill="none" stroke={INK} strokeWidth="10" strokeLinecap="round" />
        <path d="M47.3 26.2 L28.65 28.86 L41.51 44.18 Z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      </g>
      <path d="M60 42 L65 55 L78 60 L65 65 L60 78 L55 65 L42 60 L55 55 Z" fill={INK} />
    </svg>
  );
}
