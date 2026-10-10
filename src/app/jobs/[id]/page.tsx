import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { displayStatus, jobProgress, STAGES } from "@/lib/job-progress";
import { ADD_TO_SHORTLIST_STATUSES, rankResults } from "@/agents/pipeline/workflow";
import type { CandidateProfileData } from "@/agents/enrichment/schema";
import type { ScreeningData } from "@/agents/screening/schema";
import { AutoRefresh } from "../../auto-refresh";
import { StatusBadge } from "../../status-badge";
import { FollowUpsButton } from "../follow-ups-button";
import { countsLine, sourcingInfo, SourcingDetailsBody } from "../sourcing";
import { PROBLEM_NOTE, statusOf } from "../status";
import type { JobSpecData } from "@/agents/job-spec/schema";
import { JOB_BUDGET_WARNING_RATIO } from "@/config/budgets";
import { followUpStatus } from "@/agents/outreach/workflow";
import type { ReplyClassification } from "@/agents/outreach/schema";
import { ClassificationReview } from "./outreach-controls";
import { PrescreenCard, SubmissionPanel } from "./prescreen-card";
import { CandidateTabs, type CandidateTab } from "./candidate-tabs";
import { CloseJobButton } from "./close-job-button";
import { closeImpact } from "@/agents/pipeline/close-job";
import { clientEmailOf } from "@/agents/submission/workflow";
import { ActionButton } from "../../action-button";
import { addToShortlistAction, reopenJobAction, startOutreachAction, startPipelineAction, startPrescreenAction } from "../actions";
import type { SchedulingReply } from "@/agents/scheduling/schema";
import { InterviewCard } from "./interview-card";
import { RemindersButton } from "../client-answer";
import { CLOSE_REASONS, OUTCOMES, OUTCOMES_FOR_STAGE, type CloseReason } from "@/config/feedback";
import { OutcomeForm } from "./outcome-form";
import { gmailThreadUrl } from "@/agents/tools/gmail";
import { CLIENT_KINDS } from "@/agents/tools/mock-inbox";
import { checkRepliesAction } from "../actions";
import type { ClientHint } from "../client-answer";
import { HINT_LABELS } from "@/agents/client-reply/schema";
import type { Message } from "@/generated/prisma/client";
import type { OutcomeKind } from "@/config/feedback";
import { dateTime, sentences, usd } from "@/lib/format";
import { icons } from "../../icons";
import { MessageBody } from "./message-body";
import { nextStep, type NextStep } from "./next-step";
import { panel, panelLabel, panelMeta, type Tone } from "./card-styles";
import { Actions, Facts, Missing, Numbered, TabHead, Tag } from "./card-ui";

// Screen 3 (detail): one job's pipeline, candidate by candidate. Briefs style (canvas mockup approved 2026-10-10): back
// link, the job title as the headline, lime "The next useful thing" banner, the 8 stage numbers, then tabs: Shortlisted
// (numbered rows with each candidate's next step and their pre-screen / interview / outcome boxes), Not shortlisted,
// Sourcing. Buttons: dark = you look at something, lime = starts an agent, outline = open.
export default async function JobPage({ params, searchParams }: PageProps<"/jobs/[id]">) {
  await connection();
  const { id } = await params;
  const { tab } = (await searchParams) as { tab?: string };
  const job = await db.job.findUnique({ where: { id }, include: { jobSpec: true } });
  if (!job) notFound();
  const [client, entries, results, messages, followUps, prescreens, submissions, rateItems, interviews, outcomes] = await Promise.all([
    db.client.findUnique({ where: { id: job.clientId } }),
    db.pipelineEntry.findMany({ where: { jobId: id } }),
    db.screeningResult.findMany({ where: { jobId: id, current: true } }),
    db.message.findMany({ where: { jobId: id } }),
    followUpStatus(id),
    db.prescreen.findMany({ where: { jobId: id } }),
    db.submission.findMany({ where: { jobId: id }, orderBy: { createdAt: "desc" } }),
    db.approvalItem.findMany({ where: { jobId: id, kind: "submission_rate", status: "awaiting_approval" } }),
    db.interview.findMany({ where: { jobId: id } }),
    db.outcome.findMany({ where: { jobId: id } }),
  ]);
  const clientEmail = await clientEmailOf(job.clientId, job.jobSpec.briefId);
  const threadOf = (candidateId: string) =>
    messages.filter((m) => m.candidateId === candidateId).sort((a, b) => (a.sentAt ?? a.createdAt).getTime() - (b.sentAt ?? b.createdAt).getTime());
  const hasGmailThreads = messages.some((m) => m.gmailThreadId);
  // A real client reply waiting for the account manager ("Client replied" item open), with the AI's hint (specs/13).
  const openClientReplies = await db.approvalItem.findMany({ where: { jobId: id, kind: "client_replied", status: "awaiting_approval" }, select: { candidateId: true } });
  const clientHintFor = (candidateId: string): ClientHint | null => {
    if (!openClientReplies.some((x) => x.candidateId === candidateId)) return null;
    const reply = messages.filter((m) => m.candidateId === candidateId && m.kind === "client" && m.gmailMessageId).sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))[0];
    const h = reply?.classification as { suggestion?: string; reason?: string } | null;
    return { suggestion: h?.suggestion ?? null, label: h?.suggestion ? HINT_LABELS[h.suggestion] : null, reason: h?.reason ?? null };
  };
  const ids = entries.map((e) => e.candidateId);
  const [candidates, profiles] = await Promise.all([
    db.candidate.findMany({ where: { id: { in: ids } } }),
    db.candidateProfile.findMany({ where: { candidateId: { in: ids } } }),
  ]);
  const p = (await jobProgress([job])).get(job.id)!;

  const rows = rankResults(
    entries.map((e) => {
      const profile = profiles.find((x) => x.candidateId === e.candidateId)?.data as CandidateProfileData | undefined;
      const r = results.find((x) => x.candidateId === e.candidateId);
      return {
        entry: e,
        candidate: candidates.find((c) => c.id === e.candidateId),
        profile,
        result: r,
        screening: r?.data as ScreeningData | undefined,
        filteredOut: r?.filteredOut ?? false,
        score: r?.score ?? null,
        overrideScore: r?.overrideScore ?? null,
        confidence: r?.confidence ?? null,
        years: profile?.years_experience ?? null,
      };
    }),
  );

  // Shortlisted candidates first (one card each), then everyone who wasn't shortlisted, folded away.
  const shortlisted = rows.filter((r) => r.entry.stage !== "sourced");
  const pool = rows.filter((r) => r.entry.stage === "sourced");

  // Everything one shortlisted candidate's row needs, worked out once (the banner uses it too).
  const shortlistedRows = shortlisted.map((r) => {
    const { entry: e, profile } = r;
    const thread = threadOf(e.candidateId);
    const pre = prescreens.find((x) => x.candidateId === e.candidateId);
    const subs = submissions.filter((x) => x.candidateId === e.candidateId);
    const iv = interviews.find((x) => x.candidateId === e.candidateId);
    const o = outcomes.find((x) => x.candidateId === e.candidateId);
    const draft = thread.find((m) => m.direction === "outbound" && m.status === "awaiting_approval" && m.kind !== "scheduling");
    const rateNeeded = rateItems.some((x) => x.candidateId === e.candidateId);
    const hint = clientHintFor(e.candidateId);
    const linkedin = profile?.contacts.linkedin;
    const next = nextStep({
      jobId: job.id,
      stage: e.stage,
      hasEmail: !!profile?.contacts.email,
      outreachNote: e.outreachNote ? `${e.outreachNote}${linkedin ? ` (LinkedIn: ${linkedin})` : ""}` : null,
      draftKind: draft?.kind ?? null,
      followUp: followUps.find((f) => f.candidateId === e.candidateId),
      prescreen: pre,
      submission: subs[0],
      rateNeeded,
      interview: iv,
      clientReplied: !!hint,
      outcome: (o?.outcome as OutcomeKind | undefined) ?? null,
    });
    return { ...r, thread, pre, subs, sentSub: subs.find((x) => x.status === "sent"), iv, o, rateNeeded, hint, next, name: r.candidate?.fullName ?? e.candidateId };
  });

  // Header facts.
  const spec = job.jobSpec.spec as JobSpecData;
  const place = spec.location?.[0];
  const meta = [client?.name, place && place.length <= 28 ? place : null, spec.seniority ? capital(spec.seniority) : null, spec.rate_range].filter(Boolean).join(" / ");
  const hired = p.stageCounts.hired > 0;
  const status = statusOf(displayStatus(job, p));
  const warn = p.share >= JOB_BUDGET_WARNING_RATIO;
  const problemNote = PROBLEM_NOTE.includes(job.status) ? job.pipelineNote : null;
  const sourcing = await sourcingInfo(job);
  const counts = countsLine(sourcing);
  // Pipeline strip: the dark tile is the next step (the stage after the furthest one anyone reached); once someone
  // is hired, the last tile stays dark.
  const reached = STAGES.findLastIndex((s) => p.stageCounts[s] > 0);
  const current = hired ? "hired" : STAGES[reached + 1];

  // "The next useful thing" for this job: a job-level step first (shortlist, drafts, a problem, a button to press),
  // then the first candidate who needs you, then a calm line.
  const yours = shortlistedRows.filter((r) => r.next.who === "you");
  const next = ((): { title: string; text: string; cta: ReactNode } => {
    const link = (href: string, label: string) => (
      <Link href={href} className={bannerLink}>
        {label} {icons.arrowUpRight}
      </Link>
    );
    const also = yours.length ? ` Also: ${yours.length === 1 ? "1 candidate needs" : `${yours.length} candidates need`} you below.` : "";
    if (job.status === "closed")
      return {
        title: "This position is closed.",
        text: `${CLOSE_REASONS[job.closeReason as CloseReason] ?? "Closed"}${job.closeNote ? `: “${job.closeNote}”` : ""}${job.closedAt ? ` · ${dateTime(job.closedAt)}` : ""}. Nothing more runs or goes out. Reopen puts it back where it was.`,
        cta: <ActionButton action={reopenJobAction.bind(null, job.id)} label="Reopen" pendingLabel="Reopening…" variant="darkLg" />,
      };
    if (job.status === "awaiting_shortlist")
      return { title: "The shortlist is ready to pick.", text: `${p.scored ? `${p.scored} candidates scored` : `${p.stageCounts.sourced} candidates sourced`}. Pick who to contact.`, cta: link(`/approvals/shortlist/${job.id}`, "Pick shortlist") };
    if (p.pendingDrafts > 0)
      return { title: `${p.pendingDrafts === 1 ? "A draft is" : `${p.pendingDrafts} drafts are`} ready to review.`, text: `Nothing is sent until you approve it.${also}`, cta: link(`/approvals/outreach/${job.id}`, "Review drafts") };
    if (job.status === "paused_over_budget")
      return { title: "This job is paused at its budget.", text: problemNote ?? "Continue adds budget, or stop the job.", cta: link("/approvals?tab=problems", "Continue or stop") };
    if (job.status === "no_candidates")
      return { title: "Sourcing found no candidates.", text: `${problemNote ?? "Edit the spec and run sourcing again."} If the role can't be filled, close the position (top right).`, cta: link("/approvals?tab=problems", "Open approval queue") };
    if ((job.status === "failed" || p.stuck) && !hired)
      return {
        title: "An agent stopped working.",
        text: p.stuck ? `${p.progress}. No progress for a few minutes (was the app restarted?)` : (problemNote ?? "Resume continues where it stopped."),
        cta: <ActionButton action={startPipelineAction.bind(null, job.id)} label="Resume" pendingLabel="Starting…" variant="darkLg" />,
      };
    if (job.status === "ready_for_sourcing")
      return { title: "Ready to find candidates.", text: "The spec is approved. Sourcing, reading profiles and scoring take a few minutes.", cta: <ActionButton action={startPipelineAction.bind(null, job.id)} label="Start sourcing" pendingLabel="Starting…" variant="darkLg" icon={icons.arrowUpRight} /> };
    if (job.status === "shortlisted")
      return { title: "The shortlist is approved.", text: "Next, the agent writes a first message to each shortlisted candidate for you to approve.", cta: <ActionButton action={startOutreachAction.bind(null, job.id)} label="Draft outreach" pendingLabel="Starting…" variant="darkLg" icon={icons.arrowUpRight} /> };
    const [first] = yours;
    if (first)
      return {
        title: `${first.name} needs you.`,
        text: `${first.next.text}.${yours.length > 1 ? ` Also: ${yours.length - 1} more ${yours.length === 2 ? "candidate needs" : "candidates need"} you below.` : ""}`,
        cta: first.next.href ? link(first.next.href, first.next.label ?? "Open") : link(`?tab=shortlisted#cand-${first.entry.candidateId}`, "Show me"),
      };
    if (p.running && p.progress) return { title: "Agents are working.", text: `${p.progress}. This page updates itself.`, cta: link("/runs", "See runs") };
    if (hired) return { title: `${p.stageCounts.hired === 1 ? "A hire" : `${p.stageCounts.hired} hires`} on this job.`, text: "Outcomes go to the Feedback page, where they help the agents improve.", cta: link("/feedback", "Open feedback") };
    if (p.noneLeft) {
      const out = shortlistedRows.map((r) => `${r.name}: ${((r.o ? OUTCOMES[r.o.outcome as OutcomeKind]?.label : null) ?? STAGE_OUT[r.entry.stage] ?? r.entry.stage).toLowerCase()}`);
      return {
        title: shortlistedRows.length === 1 ? "The only shortlisted candidate is out." : "Everyone on the shortlist is out.",
        text: `${out.join(". ")}. Nobody is in play on this job now.${pool.length ? ` ${pool.length} more ${pool.length === 1 ? "candidate was" : "candidates were"} found: add one to the shortlist to keep going, or close the position.` : " Source again or close the position (top right)."}`,
        cta: pool.length ? link(`?tab=pool`, "Add from the others") : link("/jobs", "All jobs"),
      };
    }
    if (job.status === "stopped") return { title: "This job is stopped.", text: problemNote ?? "Nothing more will run on it.", cta: link("/jobs", "All jobs") };
    const waitingOn = shortlistedRows.filter((r) => r.next.who === "waiting").length;
    return {
      title: "Nothing needs you right now.",
      text: waitingOn ? `${waitingOn === 1 ? "1 candidate is" : `${waitingOn} candidates are`} waiting on someone else. Check replies to read new emails.` : "The agents will put anything that needs you here.",
      cta: link("/jobs", "All jobs"),
    };
  })();

  // "Close position": any job not closed, stopped or hired. The dialog lists what closing cancels.
  const canClose = !["closed", "stopped"].includes(job.status) && !hired;
  const closeEffects = canClose ? await closeImpact(job.id) : { drafts: 0, items: 0, arranging: 0, booked: 0, submissions: 0 };

  // After the shortlist is approved, more people can be added from the pool (e.g. when everyone on it dropped out).
  const canAdd = ADD_TO_SHORTLIST_STATUSES.includes(job.status) && !hired;

  const tabs = [
    { key: "shortlisted", label: "Shortlisted", count: shortlisted.length as number | null },
    { key: "pool", label: shortlisted.length ? "Not shortlisted" : "Candidates", count: pool.length as number | null },
    { key: "sourcing", label: "Sourcing", count: null },
  ];
  const active = tabs.find((t) => t.key === tab)?.key ?? (shortlisted.length ? "shortlisted" : "pool");

  return (
    <div className={`flex flex-col gap-10 pt-2 sm:gap-12 ${ink}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <Link href="/jobs" className={`min-w-0 flex-[1_1_240px] text-lg font-semibold tracking-tight uppercase hover:text-ink sm:text-xl ${muted}`}>
          ← All jobs
        </Link>
        <AutoRefresh active={p.running && !p.stuck} />
        {hasGmailThreads && <ActionButton action={checkRepliesAction.bind(null, job.id)} label="Check replies" pendingLabel="Reading Gmail…" variant="outline" />}
        {job.status === "outreach" && !hired && !p.noneLeft && <FollowUpsButton jobId={job.id} />}
        {interviews.length > 0 && <RemindersButton jobId={job.id} />}
        <Link href={`/approvals/spec/${job.jobSpecId}`} className={outlineLink}>
          Spec {icons.arrowUpRight}
        </Link>
        {canClose && <CloseJobButton jobId={job.id} title={job.title} impact={closeEffects} suggested={p.noneLeft || job.status === "no_candidates" ? "no_candidates" : undefined} />}
      </div>

      <div>
        <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] break-words sm:text-7xl lg:text-[5.5rem]">{job.title}</h1>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={`${badge} ${status.style}`}>{status.label}</span>
          {meta && <span className={`text-sm tracking-wide uppercase ${muted}`}>{meta}</span>}
          <span className={`inline-flex items-center gap-3 font-mono text-sm tabular-nums ${warn ? "font-semibold text-rose-800" : "text-stone-600"}`} title="Agent spend of this job's budget">
            {usd(p.cost)} of {usd(p.budget)}
            <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-stone-200">
              <span className={`block h-full rounded-full ${warn ? "bg-rose-600" : "bg-olive-mid"}`} style={{ width: `${Math.min(100, p.share * 100)}%` }} />
            </span>
          </span>
        </div>
        {p.progress && !p.stuck && <p className="mt-3 text-base text-emerald-800">{p.progress}</p>}
      </div>

      <section aria-label="The next useful thing" className="flex flex-wrap items-center gap-x-8 gap-y-6 rounded-md bg-brand px-6 py-8 text-ink sm:px-12 sm:py-12">
        <div className="min-w-0 flex-[1_1_360px]">
          <div className="text-xs font-semibold tracking-[0.25em] uppercase sm:text-sm">The next useful thing</div>
          <p className="mt-4 text-2xl tracking-tight sm:text-4xl">{next.title}</p>
          <p className="mt-4 text-base">{next.text}</p>
        </div>
        {next.cta}
      </section>

      {/* Pipeline strip: how many candidates reached each of the 8 stages; the dark tile is the next step. */}
      <ol aria-label="Pipeline" className={`grid grid-cols-4 gap-1 border-y py-2 ${line} xl:grid-cols-8`}>
        {STAGES.map((s) => {
          const on = s === current;
          const n = p.stageCounts[s];
          return (
            <li key={s} className={`rounded-md px-3 py-4 sm:px-4 ${on ? "bg-ink text-white" : ""}`}>
              <div className={`text-3xl leading-none font-bold tracking-[-0.04em] tabular-nums sm:text-[2.75rem] ${on ? "text-brand" : n ? "text-ink" : "text-stone-400"}`}>{n}</div>
              <div className={`mt-2.5 text-xs tracking-[0.08em] uppercase ${on ? "text-white" : n ? "text-stone-600" : "text-stone-400"}`}>{STAGE_LABEL[s]}</div>
            </li>
          );
        })}
      </ol>

      <div id="list" className="flex scroll-mt-6 flex-col gap-4">
        <nav className="flex flex-wrap gap-1 sm:gap-2" aria-label="Candidates">
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <Link
                key={t.key}
                href={`/jobs/${job.id}?tab=${t.key}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3.5 py-2.5 text-base whitespace-nowrap sm:px-5 sm:py-3 sm:text-lg ${on ? "bg-ink text-white" : `${muted} hover:text-ink`}`}
              >
                {t.label}
                {t.count !== null && ` · ${t.count}`}
              </Link>
            );
          })}
        </nav>

        {active === "shortlisted" &&
          (shortlistedRows.length ? (
            <>
              <ul className={`divide-y divide-stone-300 border-y ${line}`}>
                {shortlistedRows.map((r, i) => {
                  const { entry: e, candidate: c, profile, result, screening, overrideScore, thread, pre, subs, sentSub, iv, o, rateNeeded, hint, next: step, name } = r;
                  const outcomeOptions = OUTCOMES_FOR_STAGE[o ? o.stageBefore : e.stage];
                  const facts = [profile?.location, profile?.years_experience != null && `${profile.years_experience} yrs`, profile?.recent_stack.slice(0, 4).join(", ")].filter(Boolean).join(" / ");
                  const score = overrideScore ?? result?.score ?? null;
                  const why = sentences(screening?.reasons ?? null);
                  // Open the conversation when the latest reply still needs you to check how the agent read it.
                  const lastIn = thread.filter((m) => m.direction === "inbound").at(-1);
                  const checkReply = !!lastIn && (!lastIn.intent || (!!lastIn.classification && lastIn.kind !== "client" && lastIn.intent !== "scheduling_reply" && lastIn.classifierCorrect === null));
                  // Conversations are split: with the candidate, and with the client about them (submission, interview times, replies).
                  const withClient = thread.filter((m) => CLIENT_KINDS.includes(m.kind));
                  const withCandidate = thread.filter((m) => !CLIENT_KINDS.includes(m.kind));
                  // Tabs under the row: only the parts this candidate has; the current step opens first.
                  const writing = !!pre?.data && (pre.decision === "submit" || (!pre.decision && pre.recommendation === "proceed"));
                  const tabList: (CandidateTab | false)[] = [
                    !!pre && { key: "prescreen", label: "Pre-screen", content: <PrescreenCard p={pre} submission={subs[0] ?? null} /> },
                    e.stage === "replied" &&
                      !pre &&
                      !!profile?.contacts.email && {
                        key: "prescreen",
                        label: "Pre-screen",
                        content: (
                          <div className={panel}>
                            <TabHead tag={<Tag tone="grey">Not started</Tag>} text="The pre-screen starts by itself after an “interested” reply." />
                            <Actions>
                              <ActionButton action={startPrescreenAction.bind(null, job.id, e.candidateId)} label="Start pre-screen" pendingLabel="Writing questions… (~15s)" variant="lime" />
                            </Actions>
                          </div>
                        ),
                      },
                    (!!subs[0] || rateNeeded || writing) && {
                      key: "submission",
                      label: "Submission",
                      content: <SubmissionPanel submission={subs[0] ?? null} rateNeeded={rateNeeded} writing={writing} to={(subs[0]?.messageId && thread.find((m) => m.id === subs[0].messageId)?.toEmail) || clientEmail?.email || null} />,
                    },
                    !!sentSub && { key: "interview", label: "Interview", content: <InterviewCard submissionId={sentSub.id} stage={e.stage} iv={iv ?? null} hint={hint} location={profile?.location ?? null} /> },
                    !!outcomeOptions && {
                      key: "outcome",
                      label: o ? `Outcome · ${OUTCOMES[o.outcome as OutcomeKind]?.label ?? o.outcome}` : "Outcome",
                      content: (
                        <OutcomeForm
                          jobId={job.id}
                          candidateId={e.candidateId}
                          options={outcomeOptions}
                          existing={o ? { outcome: o.outcome, reason: o.reason, scoredCount: (o.scoredTraces as unknown[]).length } : null}
                        />
                      ),
                    },
                    {
                      key: "why",
                      label: "Why shortlisted",
                      content: <WhyShortlisted score={score} why={why} entry={e} candidate={c} profile={profile} result={result} screening={screening} />,
                    },
                    withCandidate.length > 0 && {
                      key: "candidate",
                      label: `Candidate · ${withCandidate.length}`,
                      unseen: unseenOf(withCandidate),
                      content: <Conversation messages={withCandidate} jobId={job.id} />,
                    },
                    withClient.length > 0 && {
                      key: "client",
                      label: `Client · ${withClient.length}`,
                      unseen: unseenOf(withClient),
                      content: <Conversation messages={withClient} jobId={job.id} />,
                    },
                  ];
                  const initialTab = checkReply
                    ? lastIn.kind === "client"
                      ? "client"
                      : "candidate"
                    : unseenOf(withClient).length
                      ? "client"
                      : unseenOf(withCandidate).length
                        ? "candidate"
                    : o || (step.who === "done" && outcomeOptions)
                      ? "outcome"
                      : sentSub
                        ? "interview"
                        : subs[0] || rateNeeded || writing
                          ? "submission"
                          : pre || e.stage === "replied"
                            ? "prescreen"
                            : withCandidate.length
                              ? "candidate"
                              : "why";
                  const candidateTabs = tabList.filter((t): t is CandidateTab => !!t).map((t) => (t.key === initialTab && step.who === "you" ? { ...t, dot: true } : t));
                  return (
                    <li key={e.id} id={`cand-${e.candidateId}`} className="flex scroll-mt-6 gap-x-6 py-7">
                      <span className={`hidden w-12 shrink-0 pt-1.5 pl-2 font-mono text-sm tabular-nums sm:block ${muted}`}>{String(i + 1).padStart(2, "0")}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                          <div className="min-w-0 flex-[1_1_320px]">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xl tracking-tight break-words sm:text-2xl">
                              {score != null && (
                                <span title="Screening score" className="rounded-md bg-brand px-2 py-0.5 text-base font-bold tracking-normal tabular-nums">
                                  {score}
                                </span>
                              )}
                              {name}
                              <StatusBadge status={e.stage} />
                            </div>
                            <div className={`mt-1.5 text-sm tracking-wide uppercase ${muted}`}>{[profile?.current_title, facts].filter(Boolean).join(" / ") || "Not enriched yet"}</div>
                            <div className={`mt-1 text-sm break-all ${muted}`}>{profile?.contacts.email ?? "no email"}</div>
                          </div>
                          {step.href && (
                            <Link href={step.href} className={darkLink}>
                              {step.label} {icons.arrowUpRight}
                            </Link>
                          )}
                        </div>

                        <p className={`mt-3 flex max-w-3xl items-baseline gap-3 text-base ${NEXT_STYLE[step.who]}`}>
                          <span className="shrink-0 font-mono text-xs tracking-[0.2em] uppercase opacity-70">{step.who === "done" ? "Status" : "Next"}</span>
                          <span className="min-w-0 break-words">{step.text}</span>
                        </p>

                        <CandidateTabs initial={initialTab} tabs={candidateTabs} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <Empty>No one is shortlisted yet. {job.status === "awaiting_shortlist" ? "Pick the shortlist from the banner above." : "The shortlist comes after sourcing and scoring."}</Empty>
          ))}

        {active === "pool" &&
          (pool.length ? (
            <>
              <p className={`text-sm ${muted}`}>
                Sourced and screened, best score first: why each one was or wasn&apos;t a fit.{canAdd ? " Add to shortlist puts someone in play; the agent drafts their first message for you to approve." : ""}
              </p>
              <ul className={`divide-y divide-stone-300 border-y ${line}`}>
                {pool.map(({ entry: e, candidate: c, profile, result, screening, overrideScore }, i) => {
                  const why = sentences(screening?.reasons ?? null);
                  const facts = [profile?.current_title, profile?.years_experience != null && `${profile.years_experience} yrs`, profile?.location].filter(Boolean).join(" / ");
                  return (
                    <li key={e.id} id={`cand-${e.candidateId}`} className="flex scroll-mt-6 gap-x-6 py-5">
                      <span className={`hidden w-12 shrink-0 pt-1 pl-2 font-mono text-sm tabular-nums sm:block ${muted}`}>{String(i + 1).padStart(2, "0")}</span>
                      <div className="grid min-w-0 flex-1 gap-x-6 gap-y-2 md:grid-cols-[minmax(0,17rem)_5rem_minmax(0,1fr)]">
                        <div className="min-w-0">
                          <div className="text-lg tracking-tight break-words">{c?.fullName ?? e.candidateId}</div>
                          <div className={`mt-0.5 text-xs tracking-wide uppercase ${muted}`}>{facts || "not enriched yet"}</div>
                          {canAdd && (
                            <div className="mt-3">
                              <ActionButton
                                action={addToShortlistAction.bind(null, job.id, e.candidateId)}
                                label="Add to shortlist"
                                pendingLabel="Adding…"
                                variant="outline"
                                confirm={{
                                  title: `Add ${c?.fullName ?? e.candidateId} to the shortlist?`,
                                  body: `${result?.filteredOut ? `They were filtered out: ${result.filterReason ?? "no reason saved"}. ` : ""}The agent then writes their first message; nothing is sent until you approve it.`,
                                  ok: "Add to shortlist",
                                }}
                              />
                            </div>
                          )}
                        </div>
                        <div className="whitespace-nowrap">
                          {result?.filteredOut ? (
                            <span className={`text-sm ${muted}`}>filtered out</span>
                          ) : result ? (
                            <>
                              <span className="rounded-md bg-soft px-2 py-0.5 text-base font-bold tabular-nums">{overrideScore ?? result.score}</span>
                              {overrideScore != null && <span className="ml-1 text-xs text-stone-400 line-through">{result.score}</span>}
                              <div className={`mt-1 text-xs ${muted}`}>{result.confidence} conf.</div>
                            </>
                          ) : (
                            <span className={`text-sm ${muted}`}>not scored</span>
                          )}
                        </div>
                        <div className="min-w-0 text-sm text-stone-600">
                          <p className="leading-relaxed">{result?.filteredOut ? result.filterReason : (why[0] ?? "–")}</p>
                          {screening?.dealbreaker_hit && <p className="mt-1 text-rose-800">Dealbreaker: {screening.dealbreaker_hit}</p>}
                          {result?.overrideNote && <p className="mt-1 text-olive">Your note: {result.overrideNote}</p>}
                          <details className="group/more mt-2">
                            <summary className="flex cursor-pointer list-none items-center gap-2 text-olive [&::-webkit-details-marker]:hidden">
                              <span className="text-[10px] transition-transform group-open/more:rotate-90">▶</span>
                              Full reasons and profile
                            </summary>
                            <div className="mt-3">
                              <ScreeningDetails why={why.slice(1)} entry={e} candidate={c} profile={profile} result={result} screening={screening} compact />
                            </div>
                          </details>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <Empty>{entries.length ? "Everyone sourced is on the shortlist." : "No candidates yet. They appear here once sourcing runs."}</Empty>
          ))}

        {active === "sourcing" &&
          (sourcing.highlights.length || sourcing.hasDetails ? (
            <div className={`flex flex-col gap-6 border-y ${line} py-6`}>
              {problemNote && <p className="text-base text-rose-800">{problemNote}</p>}
              {sourcing.highlights.length > 0 && (
                <div className="grid gap-5 md:grid-cols-2">
                  {sourcing.highlights.map((h) => (
                    <div key={h.title} className="border-l-4 border-olive-line pl-4">
                      <div className="text-lg tracking-tight">{h.title}</div>
                      <p className={`mt-1 text-base leading-snug ${muted}`}>{h.text}</p>
                    </div>
                  ))}
                </div>
              )}
              {counts && <div className={`text-sm tracking-wide uppercase ${muted}`}>{counts}</div>}
              {!problemNote && sourcing.hasDetails && <SourcingDetailsBody s={sourcing} />}
            </div>
          ) : (
            <Empty>Sourcing hasn&apos;t run yet. Its search queries and notes show up here.</Empty>
          ))}
      </div>
    </div>
  );
}

const ink = "text-ink";
const muted = "text-stone-500";
const line = "border-stone-300";
const badge = "rounded px-2 py-0.5 text-xs font-normal tracking-normal";
const darkLink = "inline-flex items-center gap-5 whitespace-nowrap rounded-xl border border-ink bg-ink px-5 py-2.5 text-base font-semibold text-white hover:bg-black";
const outlineLink = "inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-stone-300 px-5 py-2.5 text-base text-ink hover:bg-white";
const bannerLink = "inline-flex items-center gap-3 rounded-xl bg-ink px-7 py-4 text-lg font-semibold whitespace-nowrap text-white hover:bg-black";
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  sourced: "Sourced",
  shortlisted: "Shortlisted",
  contacted: "Contacted",
  replied: "Replied",
  prescreened: "Pre-screened",
  submitted: "Sent to client",
  interview: "Interview",
  hired: "Hired",
};
// Why a shortlisted candidate is out, when no outcome was recorded.
const STAGE_OUT: Record<string, string> = { declined: "said no", client_rejected: "client said no", withdrew: "withdrew" };

// Colour of a candidate's "Next" line: amber = you, grey = waiting on someone else, green = an agent is on it.
const NEXT_STYLE: Record<NextStep["who"], string> = {
  you: "text-amber-800",
  waiting: "text-stone-600",
  agent: "text-emerald-800",
  done: "text-stone-500",
};

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{children}</div>;
}

// Conversation tab: the latest messages; older ones fold away above them.
const SHOW_LAST = 3;

// Emails received or sent that nobody has looked at yet ("New"): their tab wasn't clicked since. Drafts don't count.
const isUnseen = (m: Message) => !m.seenAt && (m.direction === "inbound" || m.status === "sent");
const unseenOf = (messages: Message[]) => messages.filter(isUnseen).map((m) => m.id);

// Candidate / Client tab: one conversation, oldest first, the last few open.
function Conversation({ messages, jobId }: { messages: Message[]; jobId: string }) {
  return (
    <div className={panel}>
      {messages.length > SHOW_LAST && (
        <details className="group mb-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-base text-olive [&::-webkit-details-marker]:hidden">
            <span className="text-[10px] transition-transform group-open:rotate-90">▶</span>
            {messages.length - SHOW_LAST} earlier message{messages.length - SHOW_LAST === 1 ? "" : "s"}
          </summary>
          <ul className="mt-3 space-y-3">
            {messages.slice(0, -SHOW_LAST).map((m) => (
              <MessageItem key={m.id} m={m} jobId={jobId} />
            ))}
          </ul>
        </details>
      )}
      <ul className="space-y-3">
        {messages.slice(-SHOW_LAST).map((m) => (
          <MessageItem key={m.id} m={m} jobId={jobId} />
        ))}
      </ul>
    </div>
  );
}

// Why shortlisted tab: the score, the screening reasons as numbered rows, then the profile as facts.
function WhyShortlisted({
  score,
  why,
  entry,
  candidate,
  profile,
  result,
  screening,
}: {
  score: number | null;
  why: string[];
  entry: { candidateId: string; matchedOn: unknown };
  candidate: { source: string; language: string } | undefined;
  profile: CandidateProfileData | undefined;
  result: { confidence: string | null; overrideNote: string | null } | undefined;
  screening: ScreeningData | undefined;
}) {
  const found = (entry.matchedOn as string[]).join(", ");
  return (
    <div className={panel}>
      <TabHead
        tag={score != null ? <Tag tone="lime">Score {score}</Tag> : undefined}
        text={why.length ? `${why.length} reason${why.length === 1 ? "" : "s"} from screening${result?.confidence ? `, ${result.confidence} confidence` : ""}.` : "No screening reasons saved."}
      />
      {why.length > 0 && <Numbered items={why} />}
      {screening?.dealbreaker_hit && <p className="mt-4 text-base text-rose-800">Dealbreaker: {screening.dealbreaker_hit}</p>}
      {result?.overrideNote && <p className="mt-4 rounded-r-lg border-l-4 border-olive-line bg-soft px-4 py-3 text-base text-stone-700">Your note: {result.overrideNote}</p>}
      {profile && (
        <Facts
          items={[
            ["Current role", profile.current_title ?? <Missing />],
            ["Experience", profile.years_experience != null ? `${profile.years_experience} years` : <Missing />],
            ["Location", profile.location ?? <Missing />],
            ["English", profile.english_level ?? <Missing />],
            [
              "Recent stack",
              profile.recent_stack.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {profile.recent_stack.map((t) => (
                    <Tag key={t} tone="soft">
                      {t}
                    </Tag>
                  ))}
                </span>
              ) : (
                "–"
              ),
            ],
            ["Skills", profile.skills.join(", ") || "–"],
          ]}
        />
      )}
      {profile && profile.key_facts.length > 0 && (
        <div className="mt-5">
          <div className={panelLabel}>Key facts</div>
          <ul className="mt-2 space-y-1.5">
            {profile.key_facts.map((f) => (
              <li key={f} className="flex gap-3 text-base text-stone-700">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-olive-mid" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Actions
        note={[
          profile?.missing_fields.length ? `Missing: ${profile.missing_fields.join(", ")}` : null,
          `${entry.candidateId} · ${candidate?.source.replaceAll("_", " ") ?? ""}${candidate && candidate.language !== "en" ? ` · ${candidate.language.toUpperCase()} profile` : ""}${found ? ` · found by ${found}` : ""}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
    </div>
  );
}

// Screening reasons as bullets, then the structured profile (Step 3) and how sourcing found them.
function ScreeningDetails({
  why,
  entry,
  candidate,
  profile,
  result,
  screening,
  compact,
}: {
  why: string[];
  entry: { candidateId: string; matchedOn: unknown };
  candidate: { source: string; language: string } | undefined;
  profile: CandidateProfileData | undefined;
  result: { confidence: string | null; overrideNote: string | null } | undefined;
  screening: ScreeningData | undefined;
  compact?: boolean;
}) {
  const facts: [string, string][] = profile
    ? [
        ["Recent stack", profile.recent_stack.join(", ") || "–"],
        ["Skills", profile.skills.join(", ") || "–"],
        ["English", profile.english_level ?? "not stated"],
      ]
    : [];
  return (
    <div className="space-y-4 text-sm">
      {why.length > 0 && (
        <ul className="space-y-1.5">
          {why.map((w, i) => (
            <li key={i} className="flex gap-3 leading-snug text-stone-600">
              <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-olive-mid" />
              {w}
            </li>
          ))}
        </ul>
      )}
      {!compact && screening?.dealbreaker_hit && <p className="text-red-700">Dealbreaker: {screening.dealbreaker_hit}</p>}
      {!compact && result?.overrideNote && <p className="rounded-lg bg-soft px-4 py-2 text-stone-700">Your note: {result.overrideNote}</p>}
      {profile && (
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
          {facts.map(([k, v]) => (
            <Fragment key={k}>
              <dt className={muted}>{k}</dt>
              <dd className="text-stone-700">{v}</dd>
            </Fragment>
          ))}
          {profile.key_facts.length > 0 && (
            <>
              <dt className={muted}>Key facts</dt>
              <dd className="text-stone-700">
                <ul className="list-disc pl-4">
                  {profile.key_facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {profile.missing_fields.length > 0 && (
            <>
              <dt className={muted}>Missing</dt>
              <dd className="text-amber-700">{profile.missing_fields.join(", ")}</dd>
            </>
          )}
        </dl>
      )}
      <p className="text-xs text-stone-400">
        {entry.candidateId} · {candidate?.source.replaceAll("_", " ")}
        {candidate && candidate.language !== "en" ? ` · ${candidate.language.toUpperCase()} profile` : ""} · found by: {(entry.matchedOn as string[]).join(", ")}
        {result?.confidence ? ` · ${result.confidence} confidence` : ""}
      </p>
    </div>
  );
}

// Who wrote a message and what it is, as shown above it in a conversation.
function messageLabel(m: Message): string {
  if (m.direction === "inbound") {
    if (m.kind === "client") return "Client";
    if (m.intent === "prescreen_answer") return "Candidate · pre-screen answers";
    if (m.intent === "scheduling_reply") return "Candidate · about interview times";
    if (m.intent === "after_outcome") return "Candidate · after the final outcome (not read by any agent)";
    return "Candidate";
  }
  if (m.kind === "follow_up") return `Us · follow-up ${(m.sequenceStep ?? 2) - 1}`;
  if (m.kind === "reply") return "Us · reply";
  if (m.kind === "prescreen") return "Us · pre-screen questions";
  if (m.kind === "submission") return `Us · candidate profile${m.toEmail ? ` to ${m.toEmail}` : ""}`;
  if (m.kind === "scheduling") return "Us · interview times (sent automatically)";
  if (m.kind === "scheduling_client") return `Us · interview time${m.toEmail ? ` to ${m.toEmail}` : ""} (sent automatically)`;
  return "Us · first message";
}

// One message: ours on the left (white), theirs (candidate or client) on the right (pale lime). A draft waiting for
// approval shows only its first lines; it is read and edited on the Review outreach screen.
function MessageItem({ m, jobId }: { m: Message; jobId: string }) {
  const cls = m.classification as ReplyClassification | null;
  const faded = ["rejected", "cancelled"].includes(m.status);
  const draft = m.direction === "outbound" && m.status === "awaiting_approval" && m.kind !== "scheduling";
  const inbound = m.direction === "inbound";
  const state = MESSAGE_STATE[m.status];
  const readAs = cls && m.intent !== "scheduling_reply" && m.kind !== "client";
  return (
    <li className={`rounded-xl border px-5 py-4 ${inbound ? "ml-6 border-olive-line bg-tint sm:ml-16" : "mr-6 border-stone-200 bg-white sm:mr-16"} ${faded ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{messageLabel(m)}</span>
        {isUnseen(m) && <Tag tone="lime">New</Tag>}
        {state && <Tag tone={state.tone}>{state.label}</Tag>}
        {m.gmailThreadId && (
          <a href={gmailThreadUrl(m.gmailThreadId)} target="_blank" rel="noreferrer" className="text-sm text-olive hover:underline">
            Gmail ↗
          </a>
        )}
        <span className={`ml-auto ${panelMeta}`}>{dateTime(m.sentAt ?? m.createdAt)}</span>
      </div>
      {m.rejectComment && <div className="mt-1 text-sm text-stone-500">Your comment: “{m.rejectComment}”</div>}
      {m.direction === "outbound" && <div className="mt-2 text-base font-semibold">{m.subject}</div>}
      <div className="mt-1 text-base">
        {draft ? (
          <>
            <div className="line-clamp-2 text-stone-500">{m.body.replace(/\s+/g, " ")}</div>
            <Link href={`/approvals/outreach/${jobId}`} className="mt-1 inline-flex items-center gap-1 text-olive hover:underline">
              Read and edit on Review outreach {icons.arrowUpRight}
            </Link>
          </>
        ) : (
          <MessageBody body={m.body} />
        )}
      </div>
      {m.status === "sent" && m.footer && <div className="mt-2 text-sm text-stone-400">{m.footer}</div>}
      {cls && m.intent === "scheduling_reply" && (
        <div className="mt-3 border-t border-olive-line/60 pt-3 text-sm text-stone-600">
          Read as: {(cls as unknown as SchedulingReply).intent.replaceAll("_", " ")}
          {(cls as unknown as SchedulingReply).slot_number ? `, option ${(cls as unknown as SchedulingReply).slot_number}` : ""} · {cls.summary}
        </div>
      )}
      {/* A real client reply carries the AI's button hint (specs/13), not a reply classification. */}
      {cls && m.kind === "client" && (
        <div className="mt-3 border-t border-olive-line/60 pt-3 text-sm text-amber-800">
          AI hint: {HINT_LABELS[(cls as unknown as { suggestion: string }).suggestion] ?? "?"}
          {(cls as unknown as { reason?: string }).reason ? ` · ${(cls as unknown as { reason: string }).reason}` : ""}
        </div>
      )}
      {readAs && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-olive-line/60 pt-3 text-sm text-stone-600">
          <span>Read as</span>
          <Tag tone={INTENT_TONE[m.intent ?? cls.intent] ?? "grey"}>{(m.intent ?? cls.intent).replaceAll("_", " ")}</Tag>
          <span className="min-w-0 flex-[1_1_200px]">
            {cls.summary}
            {cls.return_date ? ` (back ${cls.return_date})` : ""}
            {m.intent && m.intent !== cls.intent ? ` · agent first said “${cls.intent.replaceAll("_", " ")}”` : ""}
          </span>
          <ClassificationReview messageId={m.id} intent={m.intent ?? cls.intent} reviewed={m.classifierCorrect} />
        </div>
      )}
      {inbound && !m.intent && <div className="mt-2 text-sm text-amber-700">Not read by the agent yet</div>}
    </li>
  );
}

// Only states worth a tag on a message ("sent" and "received" are the normal case).
const MESSAGE_STATE: Record<string, { label: string; tone: Tone }> = {
  awaiting_approval: { label: "Draft", tone: "amber" },
  rejected: { label: "Sent back", tone: "rose" },
  cancelled: { label: "Cancelled", tone: "grey" },
  sending: { label: "Sending", tone: "soft" },
  failed: { label: "Failed", tone: "rose" },
};
const INTENT_TONE: Record<string, Tone> = { interested: "green", question: "soft", later: "amber", out_of_office: "amber", not_interested: "grey", prescreen_answer: "green" };
