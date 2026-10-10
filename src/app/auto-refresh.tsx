"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-reads the page from the server every few seconds while something is running in the background.
export function AutoRefresh({ active, seconds = 4 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [active, seconds, router]);
  return active ? <span className="text-xs text-zinc-500">Updating every {seconds}s while agents run…</span> : null;
}
