import Link from "next/link";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { usd } from "@/lib/format";

// Left rail, bottom: total Claude API spend across every agent run in this database (app use, tests and evals), plus today's.
export async function CostBadge() {
  await connection();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [all, today, evals, first] = await Promise.all([
    db.agentRun.aggregate({ _sum: { costUsd: true }, _count: true }),
    db.agentRun.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: startOfToday } } }),
    db.agentRun.aggregate({ _sum: { costUsd: true }, where: { isEval: true } }),
    db.agentRun.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const total = all._sum.costUsd ?? 0;
  const since = first ? first.createdAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "–";
  const title =
    `Claude API spend, all agent runs since ${since} (${all._count} runs)\n` +
    `Today: ${usd(today._sum.costUsd ?? 0)}\n` +
    `Of which evals (npm run eval): ${usd(evals._sum.costUsd ?? 0)}\n` +
    `Click for every run on the Runs page.`;
  return (
    <Link href="/runs" title={title} className="flex flex-col items-center rounded-xl px-2 py-1.5 text-white/55 hover:bg-white/10 hover:text-white">
      <span className="text-[0.5625rem] font-semibold tracking-widest uppercase">Spent</span>
      <span className="text-xs font-semibold text-white tabular-nums">{usd(total)}</span>
    </Link>
  );
}
