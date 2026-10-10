import Link from "next/link";
import type { ReactNode } from "react";

// One header for every page except Briefs (2026-10-09, same look as Agent runs): small mono label, big title, grey
// description, line underneath. On inner pages the label is the way back ("← Approval queue").
// meta = status tags under the title; right = buttons on the right.
export function PageHeader({
  title,
  subtitle,
  back,
  meta,
  right,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  meta?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  const label = "font-mono text-sm tracking-[0.2em] uppercase text-stone-500";
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-stone-300 pb-6 text-ink ${className}`}>
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className={`${label} hover:text-ink`}>
            ← {back.label}
          </Link>
        ) : (
          <div className={label}>Hireloop</div>
        )}
        <h1 className="mt-3 text-5xl leading-[0.95] font-bold tracking-[-0.045em] break-words sm:text-6xl">{title}</h1>
        {meta && <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-base text-stone-500">{meta}</div>}
        {subtitle && <p className="mt-3 max-w-3xl text-base leading-relaxed text-stone-500">{subtitle}</p>}
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-3">{right}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
      {children}
    </div>
  );
}
