"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { icons } from "./icons";

export type NavCounts = { briefs: number; approvals: number; jobs: number };

// Left rail menu: icons only, the name shows on hover. Badges: Briefs to do, approvals waiting, active jobs (not stopped,
// nobody hired yet). A badge is lime, and white on the page you're on (so it stands out on the lime icon).
// A short line above Runs splits the daily work (briefs, approvals, jobs, people) from how the agents are doing.
const LINKS = [
  { href: "/", label: "Briefs", icon: icons.briefs, badge: "briefs", badgeTitle: "to do" },
  { href: "/approvals", label: "Approval queue", icon: icons.approvals, badge: "approvals", badgeTitle: "waiting for you" },
  { href: "/jobs", label: "Jobs", icon: icons.jobs, badge: "jobs", badgeTitle: "active" },
  { href: "/candidates", label: "Candidates", icon: icons.candidates },
  { href: "/clients", label: "Clients", icon: icons.clients },
  { href: "/runs", label: "Runs", icon: icons.runs, divider: true },
  { href: "/feedback", label: "Feedback", icon: icons.feedback },
] as const;

export const railItem = "group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl md:h-14 md:w-14 md:rounded-2xl";
export const railIdle = "text-white/55 hover:bg-white/10 hover:text-white";

// Name label to the right of a rail icon, on hover (wide screens; on a phone the rail is a top strip).
export function RailTip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute left-full z-30 ml-3 hidden whitespace-nowrap rounded-md bg-ink px-2.5 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 md:block">
      {children}
    </span>
  );
}

// Rail bottom, under the Gmail icon: Help (what Hireloop is, how it works; 2026-10-10, replaced the guide map).
export function HelpLink() {
  const on = usePathname().startsWith("/help");
  return (
    <Link href="/help" aria-label="Help" aria-current={on ? "page" : undefined} className={`${railItem} ${on ? "bg-brand text-ink" : railIdle}`}>
      {icons.help}
      <RailTip>Help</RailTip>
    </Link>
  );
}

export function NavLinks({ counts }: { counts: NavCounts }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/briefs") : pathname.startsWith(href));

  return (
    <nav aria-label="Main" className="flex gap-1 md:flex-col md:gap-4">
      {LINKS.map((l) => {
        const on = isActive(l.href);
        const n = "badge" in l ? counts[l.badge] : 0;
        const tip = "badge" in l && n > 0 ? `${l.label} · ${n} ${l.badgeTitle}` : l.label;
        return (
          <Fragment key={l.href}>
            {"divider" in l && <span aria-hidden className="mx-1 h-6 w-px shrink-0 self-center bg-white/20 md:mx-0 md:my-1 md:h-px md:w-8" />}
            <Link
              href={l.href}
              aria-label={tip}
              aria-current={on ? "page" : undefined}
              className={`${railItem} ${on ? "bg-brand text-ink" : railIdle}`}
            >
              {l.icon}
              {"badge" in l && n > 0 && (
                <span className={`absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full ${on ? "bg-white" : "bg-brand"} px-1 text-[0.6875rem] font-semibold text-ink ring-2 ring-rail`}>
                  {n}
                </span>
              )}
              <RailTip>{tip}</RailTip>
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
