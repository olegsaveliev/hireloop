import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { jobFinished, jobStage, latestByRole, needsAction } from "@/lib/briefs";
import { displayStatus, jobProgress } from "@/lib/job-progress";
import { DECLINED_THREAD_REASON, gmailStatus } from "@/agents/inbound/workflow";
import { gmailThreadUrl } from "@/agents/tools/gmail";
import { ActionButton } from "./action-button";
import { createSpecAction } from "./actions";
import { icons } from "./icons";
import { BriefRow } from "./brief-row";
import { BriefTools } from "./brief-tools";
import { NewSenderForm } from "./new-sender-form";
import { checkInboxAction, clearAllNotBriefsAction, clearNotBriefAction, deleteBriefAction, markAsBriefAction } from "./inbound-actions";

// Briefs mockup (2026-10-09): warm ink / stone greys and a lime accent.
const ink = "text-ink";
const muted = "text-stone-500";
const line = "border-stone-300";
const outlineLink = `inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-5 py-2.5 text-base hover:bg-white ${line} ${ink}`;
// Review spec: dark, like "Review now" in the banner (same action); lime stays for Create spec, which starts the agent.
const darkLink = "inline-flex items-center gap-5 whitespace-nowrap rounded-xl border border-ink bg-ink px-5 py-2.5 text-base font-semibold text-white hover:bg-black";
const badge = "rounded px-2 py-0.5 text-xs";
// Status tag colours on the Briefs rows (one per kind of status).
const tone = {
  new: "bg-sky-100 text-sky-800",
  review: "bg-amber-100 text-amber-800",
  problem: "bg-rose-100 text-rose-800",
  sender: "bg-violet-100 text-violet-800",
  running: "bg-emerald-100 text-emerald-800",
  closed: "bg-stone-200 text-stone-600",
  updates: "bg-orange-100 text-orange-800",
};
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const say = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Screen 1: inbox of client briefs, in tabs: All, To do, In progress, Done, Not briefs (docs/specs/11-gmail-inbound.md).
// Look from the Briefs mockup (2026-10-09): headline, "The next useful thing" banner, numbered rows.
export default async function BriefsPage({ searchParams }: PageProps<"/">) {
  await connection();
  const { gmail, tab, added } = (await searchParams) as { gmail?: string; tab?: string; added?: string };
  const [clients, briefs, waitingAll, ignored, ignoredCount, google] = await Promise.all([
    db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.clientBrief.findMany({ include: { client: true, jobSpecs: { include: { job: true } } }, orderBy: { receivedAt: "desc" } }),
    // Briefs from unknown senders: first email of each thread, waiting for "Which client is this?".
    db.inboundEmail.findMany({ where: { status: "waiting_sender" }, orderBy: { receivedAt: "asc" } }),
    // Emails under the Briefs label that aren't briefs (classifier said no, or sender marked "not a client").
    db.inboundEmail.findMany({ where: { status: { in: ["ignored", "not_client"] } }, orderBy: { receivedAt: "desc" }, take: 30 }),
    db.inboundEmail.count({ where: { status: { in: ["ignored", "not_client"] } } }),
    gmailStatus(),
  ]);
  const waiting = waitingAll.filter((e, i) => waitingAll.findIndex((x) => x.gmailThreadId === e.gmailThreadId) === i).reverse();
  const laterInThread = (e: (typeof waitingAll)[number]) => waitingAll.filter((x) => x.gmailThreadId === e.gmailThreadId && x.id !== e.id).length;

  const jobs = briefs.flatMap((b) => b.jobSpecs.flatMap((s) => (s.job ? [s.job] : [])));
  const progress = await jobProgress(jobs);
  const reached = (jobId: string) => progress.get(jobId)?.stageCounts ?? ({} as Record<string, number>);

  type Brief = (typeof briefs)[number];
  const latest = (b: Brief) => latestByRole(b.jobSpecs);
  const isDone = (b: Brief) => latest(b).every((s) => s.job && jobFinished(s.job, reached(s.job.id).hired ?? 0));
  const todo = briefs.filter((b) => needsAction(b.jobSpecs));
  const started = briefs.filter((b) => !needsAction(b.jobSpecs));
  const inProgress = started.filter((b) => !isDone(b));
  const done = started.filter(isDone);

  const location = (b: Brief) => {
    const l = latest(b).map((s) => (s.spec as { location?: string[] }).location?.[0]).find(Boolean);
    return l && l.length <= 28 ? l : null;
  };
  const withJobs = (b: Brief) => latest(b).filter((s) => s.job);
  const finished = (job: NonNullable<Brief["jobSpecs"][number]["job"]>) => jobFinished(job, reached(job.id).hired ?? 0);
  const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

  // Where a brief stands, as the tag next to its title (the row button is the way in, so no links here). Each status
  // has its own colour: New blue, Spec to review amber, Spec rejected red; one job: where it stands (green while it
  // runs, amber when the shortlist waits for you, red when it's stuck, grey when closed); several jobs: In progress / Done.
  const status = (b: Brief): { text: string; tone: string } => {
    if (todo.includes(b)) {
      const toReview = latest(b).filter((s) => s.status === "awaiting_approval").length;
      if (toReview) return { text: toReview > 1 ? `${toReview} specs to review` : "Spec to review", tone: tone.review };
      return latest(b).length === 0 ? { text: "New", tone: tone.new } : { text: "Spec rejected", tone: tone.problem };
    }
    const js = withJobs(b);
    if (js.length === 1) {
      const job = js[0].job!;
      if (finished(job)) return { text: "Job closed", tone: tone.closed };
      const shown = displayStatus(job, progress.get(job.id));
      const text = capital(jobStage(shown, reached(job.id)));
      if (["awaiting_shortlist", "needs_candidates"].includes(shown)) return { text, tone: tone.review };
      if (["paused_over_budget", "no_candidates", "failed"].includes(job.status)) return { text, tone: tone.problem };
      return { text, tone: tone.running };
    }
    return done.includes(b) ? { text: "Done", tone: tone.closed } : { text: "In progress", tone: tone.running };
  };

  // Brief summary: subject with its status tag, then client / place / date. Only a brief with several jobs (no single
  // Open job button) or a job next to a To do spec gets one short line per job, linking to it.
  const summary = (b: Brief) => {
    const st = status(b);
    const js = withJobs(b);
    const jobLines = js.length > 1 || (js.length === 1 && todo.includes(b)) ? js : [];
    return (
      <>
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xl tracking-tight sm:text-2xl ${ink}`}>
          {b.subject}
          <span className={`${badge} ${st.tone} font-normal tracking-normal`}>{st.text}</span>
          {b.updateCount > 0 && (
            <span className={`${badge} ${tone.updates} font-normal tracking-normal`}>
              {b.updateCount} update{b.updateCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className={`mt-1.5 text-sm tracking-wide uppercase ${muted}`}>
          {[b.client.name, location(b), shortDate(b.receivedAt)].filter(Boolean).join(" / ")}
        </div>
        {jobLines.length > 0 && (
          <div className="mt-2.5 space-y-1 text-sm">
            {jobLines.map(({ job }) => (
              <div key={job!.id} className={`flex flex-wrap items-center gap-1.5 ${muted}`}>
                Job:
                <Link href={`/jobs/${job!.id}`} className={`hover:underline ${ink}`}>{job!.title}</Link>·{" "}
                {finished(job!) ? "closed" : jobStage(job!.status, reached(job!.id))}
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  // The button on the right: the one next step for this brief.
  const nextStep = (b: Brief) => {
    const toReview = latest(b).find((s) => s.status === "awaiting_approval");
    if (toReview)
      return (
        <Link href={`/approvals/spec/${toReview.id}`} className={darkLink}>
          Review spec {icons.arrowUpRight}
        </Link>
      );
    if (!b.jobSpecs.some((s) => s.status === "approved"))
      return <ActionButton action={createSpecAction.bind(null, b.id)} label="Create spec" pendingLabel="Agent is writing the spec… (~30s)" variant="lime" icon={icons.arrowUpRight} />;
    const js = withJobs(b);
    if (js.length === 1)
      return (
        <Link href={`/jobs/${js[0].job!.id}`} className={outlineLink}>
          Open job {icons.arrowUpRight}
        </Link>
      );
    return null;
  };

  // The bin: deletes the brief, only until a spec is approved (then a job hangs off it).
  const bin = (b: Brief) =>
    !b.jobSpecs.some((s) => s.status === "approved") && (
      <ActionButton
        action={deleteBriefAction.bind(null, b.id)}
        label="Delete brief"
        variant="icon"
        icon={icons.trash}
        confirm={{ title: `Delete “${b.subject}”?`, body: "The brief and its draft specs are deleted. This can't be undone.", ok: "Delete" }}
      />
    );

  const briefRow = (b: Brief, n: number) => (
    <BriefRow
      key={b.id}
      number={n}
      main={summary(b)}
      actions={nextStep(b)}
      remove={bin(b)}
      email={{ subject: b.subject, fromName: b.fromName, fromEmail: b.fromEmail, when: dateTime(b.receivedAt), body: b.body }}
      footer={nextStep(b)}
      extras={
        <div className="space-y-4">
          {(b.source === "gmail" || !!(b.attachmentNames as string[] | null)?.length) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {b.source === "gmail" && <span>Came in via Gmail</span>}
              {b.gmailThreadId && (
                <a href={gmailThreadUrl(b.gmailThreadId)} target="_blank" rel="noreferrer" className="hover:text-ink hover:underline">
                  Open in Gmail ↗
                </a>
              )}
              {!!(b.attachmentNames as string[] | null)?.length && <span>Attachments (not read): {(b.attachmentNames as string[]).join(", ")}</span>}
            </div>
          )}
          <BriefTools
            briefId={b.id}
            clientId={b.clientId}
            clients={clients}
            hasSpec={b.jobSpecs.length > 0}
          />
        </div>
      }
    />
  );

  // Email from an unknown sender: first email of its thread, waiting for "Which client is this?".
  const senderRow = (e: (typeof waiting)[number], n: number) => (
    <BriefRow
      key={e.id}
      number={n}
      label="Email"
      main={
        <>
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xl tracking-tight sm:text-2xl ${ink}`}>
            {e.subject}
            <span className={`${badge} ${tone.sender} font-normal tracking-normal`}>New sender: which client?</span>
          </div>
          <div className={`mt-1.5 text-sm tracking-wide ${muted}`}>
            <span className="uppercase">{e.fromName}</span> / {e.fromEmail} / <span className="uppercase">{shortDate(e.receivedAt)}</span>
            {laterInThread(e) > 0 && ` · +${laterInThread(e)} later in the thread`}
          </div>
        </>
      }
      actions={<NewSenderForm inboundId={e.id} clients={clients} />}
      email={{ subject: e.subject, fromName: e.fromName, fromEmail: e.fromEmail, when: dateTime(e.receivedAt), body: e.body }}
    />
  );

  // "The next useful thing": the one action that helps most right now, then a line on what else is waiting.
  const specsToReview = todo.flatMap((b) => latest(b).filter((s) => s.status === "awaiting_approval"));
  const needSpec = todo.filter((b) => latest(b).length === 0);
  const rejected = todo.filter((b) => latest(b).length > 0 && !latest(b).some((s) => s.status === "awaiting_approval"));
  const waitingFor = [
    { n: specsToReview.length, title: (n: number) => (n === 1 ? "One job spec needs your eye." : `${say(n)} job specs need your eye.`), href: `/approvals/spec/${specsToReview[0]?.id}`, cta: "Review now", rest: (n: number) => plural(n, "spec to review", "specs to review") },
    { n: waiting.length, title: (n: number) => (n === 1 ? "A new sender needs a client." : `${say(n)} new senders need a client.`), href: "/#list", cta: "Show me", rest: (n: number) => plural(n, "new sender", "new senders") },
    { n: needSpec.length, title: (n: number) => (n === 1 ? "One brief is waiting for a spec." : `${say(n)} briefs are waiting for a spec.`), href: "/#list", cta: "Show me", rest: (n: number) => plural(n, "brief without a spec", "briefs without a spec") },
    { n: rejected.length, title: (n: number) => (n === 1 ? "A rejected spec needs a new draft." : `${say(n)} rejected specs need a new draft.`), href: "/#list", cta: "Show me", rest: (n: number) => plural(n, "rejected spec", "rejected specs") },
  ].filter((w) => w.n > 0);
  const [first, ...others] = waitingFor;
  // Jobs where everyone on the shortlist is out (Briefs status "Needs candidates").
  const needCandidates = briefs.flatMap((b) => withJobs(b).map((s) => s.job!)).filter((j) => progress.get(j.id)?.noneLeft && !finished(j));
  const next = first
    ? {
        title: first.title(first.n),
        text: others.length ? `Also in To do: ${others.map((w) => w.rest(w.n)).join(", ")}.` : "Your inbox is clear. Keep the pipeline moving.",
        href: first.href,
        cta: first.cta,
      }
    : needCandidates.length
      ? {
          title: needCandidates.length === 1 ? `${needCandidates[0].title} needs candidates.` : `${needCandidates.length} jobs need candidates.`,
          text: "Everyone on the shortlist is out (said no, client said no, or withdrew). Open the job to see who else was found.",
          href: `/jobs/${needCandidates[0].id}`,
          cta: "Open job",
        }
    : {
        title: "Nothing needs you right now.",
        text: inProgress.length ? `${plural(inProgress.length, "brief is", "briefs are")} in progress. Keep the pipeline moving.` : "Your inbox is clear. Check Gmail or add a new brief.",
        href: "/jobs",
        cta: "Open jobs",
      };

  const tabs = [
    { key: "all", label: "All briefs", count: briefs.length + waiting.length },
    { key: "todo", label: "To do", count: todo.length + waiting.length },
    { key: "progress", label: "In progress", count: inProgress.length },
    { key: "done", label: "Done", count: done.length },
    { key: "not", label: "Not briefs", count: ignoredCount },
  ];
  const active = tabs.find((t) => t.key === tab)?.key ?? "todo";
  const list = (rows: ReactNode[]) => <div className={`divide-y divide-stone-300 border-b ${line}`}>{rows}</div>;

  return (
    <div className={`flex flex-col gap-10 pt-2 sm:gap-12 ${ink}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className={`min-w-0 flex-[1_1_240px] text-lg font-semibold tracking-tight uppercase sm:text-xl ${muted}`}>Hireloop</div>
        <ActionButton
          action={checkInboxAction}
          label="Check Gmail"
          pendingLabel="Reading Gmail…"
          variant="outline"
          hideAfter={5000}
          disabled={!google.connected}
          title={google.connected ? "Read new emails under your Gmail label “Briefs”" : "Connect Gmail first (bottom of the left panel)"}
        />
        <Link href="/briefs/new" className={outlineLink}>
          {icons.plus} New brief
        </Link>
        {gmail && <div className={`basis-full text-sm ${muted}`}>{gmail}</div>}
        {added && <div className="basis-full text-right text-sm text-green-700">Brief added under To do.</div>}
      </div>

      <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] sm:text-7xl lg:text-[5.5rem]">
        Less busywork.
        <br />
        More hiring.
      </h1>

      <section aria-label="The next useful thing" className="flex flex-wrap items-center gap-x-8 gap-y-6 rounded-md bg-brand px-6 py-8 text-ink sm:px-12 sm:py-12">
        <div className="min-w-0 flex-[1_1_360px]">
          <div className="text-xs font-semibold tracking-[0.25em] uppercase sm:text-sm">The next useful thing</div>
          <p className="mt-4 text-2xl tracking-tight sm:text-4xl">{next.title}</p>
          <p className="mt-4 text-base">{next.text}</p>
        </div>
        <Link href={next.href} className="inline-flex items-center gap-3 rounded-xl bg-ink px-7 py-4 text-lg font-semibold whitespace-nowrap text-white hover:bg-black">
          {next.cta} {icons.arrowUpRight}
        </Link>
      </section>

      <div id="list" className="flex scroll-mt-6 flex-col gap-4">
        <nav className="flex flex-wrap gap-1 sm:gap-2" aria-label="Briefs">
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <Link
                key={t.key}
                href={t.key === "todo" ? "/" : `/?tab=${t.key}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3.5 py-2.5 text-base whitespace-nowrap sm:px-5 sm:py-3 sm:text-lg ${
                  on ? "bg-ink text-white" : `${muted} hover:text-ink`
                }`}
              >
                {t.label} · {t.count}
              </Link>
            );
          })}
        </nav>

        {active === "all" &&
          (briefs.length + waiting.length ? (
            list([...waiting.map((e, i) => senderRow(e, i + 1)), ...[...todo, ...inProgress, ...done].map((b, i) => briefRow(b, waiting.length + i + 1))])
          ) : (
            <Empty>No briefs yet. Click Check Gmail, or New brief to paste one.</Empty>
          ))}

        {active === "todo" &&
          (todo.length + waiting.length ? (
            list([...waiting.map((e, i) => senderRow(e, i + 1)), ...todo.map((b, i) => briefRow(b, waiting.length + i + 1))])
          ) : (
            <Empty>{briefs.length === 0 ? "No briefs yet. Click Check Gmail, or New brief to paste one." : "Nothing waiting for you."}</Empty>
          ))}

        {active === "progress" &&
          (inProgress.length ? list(inProgress.map((b, i) => briefRow(b, i + 1))) : <Empty>Nothing in progress. A brief moves here once its specs are approved.</Empty>)}

        {active === "done" &&
          (done.length ? list(done.map((b, i) => briefRow(b, i + 1))) : <Empty>Nothing done yet. A brief is done when each of its jobs has a hire or was stopped.</Empty>)}

        {active === "not" &&
          (ignoredCount ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {/* A note in a thin-bordered box, so it reads as an explanation, not as one more row. */}
                <div className={`flex min-w-0 flex-[1_1_320px] items-start gap-3 rounded-xl border ${line} bg-white/60 px-5 py-4 text-sm text-stone-600`}>
                  <span className={`mt-px ${muted}`}>{icons.info}</span>
                  <p>
                    Emails the agent decided aren&apos;t job requests. Wrong? Click “This is a brief”. Clear removes an email&apos;s text
                    from the app (it stays in Gmail and won&apos;t be imported again).
                    {ignoredCount > ignored.length && ` Showing the newest ${ignored.length}.`}
                  </p>
                </div>
                <ActionButton
                  action={clearAllNotBriefsAction}
                  label={`Clear all ${ignoredCount}`}
                  pendingLabel="Clearing…"
                  variant="outline"
                  confirm={{
                    title: `Clear all ${ignoredCount} emails from Not briefs?`,
                    body: "Their text is erased from the app (Gmail keeps them). This can't be undone.",
                    ok: "Clear all",
                  }}
                />
              </div>
              {list(
                ignored.map((e) => (
                  // From the user's mockup (2026-10-09): subject, then sender · date, then "Why:" on its own line; lime
                  // "This is a brief" on the right. Lines kept close together.
                  <div key={e.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5 sm:flex-nowrap">
                    <div className="min-w-0 flex-[1_1_320px] max-w-3xl">
                      <div className={`text-lg leading-snug tracking-tight sm:text-xl ${ink}`}>{e.subject}</div>
                      <div className={`mt-1 text-sm ${muted}`}>
                        {e.fromName} &lt;{e.fromEmail}&gt; · {dateTime(e.receivedAt)}
                      </div>
                      <p className={`mt-1 text-sm leading-snug ${muted}`}>
                        {e.status === "not_client" ? (
                          "You marked the sender as not a client."
                        ) : (
                          <>
                            <span className={ink}>Why:</span> {e.reason ?? "?"}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 max-sm:basis-full">
                      <a href={gmailThreadUrl(e.gmailThreadId)} target="_blank" rel="noreferrer" className={`rounded-xl px-3 py-2.5 text-base hover:bg-white hover:text-ink ${muted}`}>
                        Gmail ↗
                      </a>
                      {(e.traceId || e.status === "not_client" || e.reason === DECLINED_THREAD_REASON) && (
                        <ActionButton action={markAsBriefAction.bind(null, e.id)} label="This is a brief" pendingLabel="Moving…" variant="softLime" />
                      )}
                      <ActionButton action={clearNotBriefAction.bind(null, e.id)} label="Clear" pendingLabel="Clearing…" variant="quiet" />
                    </div>
                  </div>
                )),
              )}
            </div>
          ) : (
            <Empty>No emails here. Emails under your Gmail label “Briefs” that aren&apos;t job requests show up here.</Empty>
          ))}
      </div>

    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{children}</div>;
}
