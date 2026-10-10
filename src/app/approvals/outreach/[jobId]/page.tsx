import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { NO_EMAIL_NOTE } from "@/agents/outreach/workflow";
import type { ReplyClassification } from "@/agents/outreach/schema";
import type { CandidateProfileData } from "@/agents/enrichment/schema";
import type { ScreeningData } from "@/agents/screening/schema";
import { isSendAllowed } from "@/config/google";
import { STATUS } from "../../../jobs/status";
import { OutreachEditor, type DraftCard } from "./outreach-editor";
import { icons } from "../../../icons";

// Review outreach in the Briefs style (2026-10-10): "← Job page", big headline, status + job / client, a lime banner
// saying what's waiting, then the draft cards (select-all bar, one card per draft) and numbered "Recently decided" rows.
const muted = "text-stone-500";
const line = "border-stone-300";
const badge = "rounded px-2 py-0.5 text-xs font-normal tracking-normal";
const sectionLabel = `font-mono text-[11px] tracking-[0.15em] uppercase ${muted}`;
const DECIDED: Record<string, { label: string; style: string }> = {
  sent: { label: "Sent", style: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Sent back", style: "bg-rose-100 text-rose-800" },
  cancelled: { label: "Cancelled", style: "bg-stone-200 text-stone-600" },
};

const KIND_LABEL: Record<string, string> = { first: "First message", follow_up: "Follow-up", reply: "Reply to the candidate", prescreen: "Pre-screen questions" };

// Step 5 approval: every outreach draft for one job. Nothing is sent until the recruiter approves it.
export default async function OutreachApprovalPage({ params }: PageProps<"/approvals/outreach/[jobId]">) {
  await connection();
  const { jobId } = await params;
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) notFound();
  const [client, drafts, recent, noEmail] = await Promise.all([
    db.client.findUnique({ where: { id: job.clientId } }),
    db.message.findMany({ where: { jobId, status: "awaiting_approval", kind: { not: "scheduling" } }, orderBy: { createdAt: "asc" } }),
    db.message.findMany({ where: { jobId, direction: "outbound", status: { in: ["sent", "rejected", "cancelled"] } }, orderBy: { decidedAt: "desc" }, take: 20 }),
    db.pipelineEntry.findMany({ where: { jobId, stage: "shortlisted", outreachNote: NO_EMAIL_NOTE } }),
  ]);
  const ids = [...new Set([...drafts, ...recent].map((d) => d.candidateId).concat(noEmail.map((e) => e.candidateId)))];
  const [candidates, profiles, screening, inbound, rejectedBefore] = await Promise.all([
    db.candidate.findMany({ where: { id: { in: ids } } }),
    db.candidateProfile.findMany({ where: { candidateId: { in: ids } } }),
    db.screeningResult.findMany({ where: { jobId, current: true, candidateId: { in: ids } } }),
    db.message.findMany({ where: { id: { in: drafts.map((d) => d.replyToId).filter((x): x is string => !!x) } } }),
    db.message.findMany({ where: { id: { in: drafts.map((d) => d.previousMessageId).filter((x): x is string => !!x) } } }),
  ]);
  const name = (id: string) => candidates.find((c) => c.id === id)?.fullName ?? id;
  const profileOf = (id: string) => profiles.find((p) => p.candidateId === id)?.data as CandidateProfileData | undefined;

  const cards: DraftCard[] = drafts.map((d) => {
    const p = profileOf(d.candidateId);
    const s = screening.find((r) => r.candidateId === d.candidateId);
    const replyTo = inbound.find((m) => m.id === d.replyToId);
    const prev = rejectedBefore.find((m) => m.id === d.previousMessageId);
    return {
      messageId: d.id,
      candidateId: d.candidateId,
      name: name(d.candidateId),
      limited: d.kind !== "prescreen",
      kindLabel: d.kind === "follow_up" ? `Follow-up ${(d.sequenceStep ?? 2) - 1} of 2` : KIND_LABEL[d.kind] ?? d.kind,
      toEmail: d.toEmail ?? "",
      allowed: !!d.toEmail && isSendAllowed(d.toEmail),
      subject: d.subject,
      body: d.body,
      footer: d.footer ?? "",
      hooks: d.hooks as string[],
      warning: d.warning,
      title: p?.current_title ?? null,
      years: p?.years_experience ?? null,
      location: p?.location ?? null,
      recentStack: p?.recent_stack ?? [],
      score: s?.overrideScore ?? s?.score ?? null,
      reasons: (s?.data as ScreeningData | null)?.reasons ?? s?.filterReason ?? null,
      overrideNote: s?.overrideNote ?? null,
      replyTo: replyTo
        ? { body: replyTo.body, intent: replyTo.intent, summary: (replyTo.classification as ReplyClassification | null)?.summary ?? null }
        : null,
      redraftOf: prev ? { comment: prev.rejectComment ?? "" } : null,
    };
  });

  const status = STATUS[job.status] ?? { label: job.status.replaceAll("_", " "), style: "bg-stone-200 text-stone-700" };
  const writing = job.status === "drafting_outreach";
  const next = cards.length
    ? {
        title: cards.length === 1 ? `1 draft to ${cards[0].name} is waiting.` : `${cards.length} drafts are waiting for you.`,
        text: "Edit, approve, or send back for a rewrite. Nothing is sent until you approve it.",
        href: "#drafts",
        cta: "Review drafts",
      }
    : writing
      ? { title: "The agent is still writing.", text: "Drafts show up here in a moment. Refresh to see them.", href: `/approvals/outreach/${job.id}`, cta: "Refresh" }
      : { title: "No drafts waiting.", text: "Everything for this job has been decided. New drafts appear here after a reply or a follow-up.", href: `/jobs/${job.id}`, cta: "Back to job" };

  return (
    <div className="flex flex-col gap-10 pt-2 text-ink sm:gap-12">
      <Link href={`/jobs/${job.id}`} className={`text-lg font-semibold tracking-tight uppercase hover:text-ink sm:text-xl ${muted}`}>
        ← Job page
      </Link>

      <div>
        <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] break-words sm:text-7xl lg:text-[5.5rem]">
          Review
          <br />
          outreach.
        </h1>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={`${badge} ${status.style}`}>{status.label}</span>
          <span className={`text-sm tracking-wide break-words uppercase ${muted}`}>
            {job.title} / {client?.name}
          </span>
        </div>
      </div>

      <section aria-label="The next useful thing" className="flex flex-wrap items-center gap-x-8 gap-y-6 rounded-md bg-brand px-6 py-8 text-ink sm:px-12 sm:py-12">
        <div className="min-w-0 flex-[1_1_360px]">
          <div className="text-xs font-semibold tracking-[0.25em] uppercase sm:text-sm">The next useful thing</div>
          <p className="mt-4 text-2xl tracking-tight break-words sm:text-4xl">{next.title}</p>
          <p className="mt-4 text-base break-words">{next.text}</p>
        </div>
        <Link href={next.href} className="inline-flex items-center gap-3 rounded-xl bg-ink px-7 py-4 text-lg font-semibold whitespace-nowrap text-white hover:bg-black">
          {next.cta} {icons.arrowUpRight}
        </Link>
      </section>

      {noEmail.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className={sectionLabel}>
            No email: contact manually · {noEmail.length}
          </h2>
          <ul className={`divide-y divide-stone-300 border-y ${line}`}>
            {noEmail.map((e, i) => {
              const li = profileOf(e.candidateId)?.contacts.linkedin;
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-5">
                  <span className={`w-8 shrink-0 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1 text-xl tracking-tight break-words">{name(e.candidateId)}</span>
                  <span className={`${badge} bg-amber-100 text-amber-800`}>{li ? "LinkedIn only" : "No contact"}</span>
                  {li && <span className="text-base break-all text-stone-600">{li}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {cards.length > 0 && (
        <section id="drafts" className="scroll-mt-6">
          <OutreachEditor cards={cards} />
        </section>
      )}

      {recent.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className={sectionLabel}>Recently decided · {recent.length}</h2>
          <ul className={`divide-y divide-stone-300 border-y ${line}`}>
            {recent.map((m, i) => {
              const tag = DECIDED[m.status] ?? { label: m.status, style: "bg-stone-200 text-stone-600" };
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-5 sm:flex-nowrap">
                  <span className={`w-8 shrink-0 self-start pt-1 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-[1_1_300px]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xl tracking-tight break-words">
                      {name(m.candidateId)}
                      <span className={`${badge} ${tag.style}`}>{tag.label}</span>
                    </div>
                    <div className="mt-1 text-base break-words text-stone-700">{m.subject}</div>
                    {m.rejectComment && <div className={`mt-1 text-sm break-words ${muted}`}>Your comment: “{m.rejectComment}”</div>}
                  </div>
                  <span className={`shrink-0 self-start pt-1.5 font-mono text-[13px] text-stone-700 max-sm:basis-full max-sm:pl-14`}>{m.decidedAt && dateTime(m.decidedAt)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
