import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { ActionButton } from "../action-button";
import { icons } from "../icons";
import { continueOverBudgetAction, decidePrescreenAction, stopOverBudgetAction } from "../jobs/actions";
import { dismissProblemAction, retryProblemAction } from "./actions";
import { RateForm } from "./rate-form";
import { dismissInboundAction, regenerateWithUpdateAction } from "../inbound-actions";

// Approval queue in the Briefs style (canvas mockup approved 2026-10-10): grey label, big headline, lime "The next
// useful thing" banner, pill tabs, numbered rows. Buttons: dark = you look at something, lime = starts an agent or
// moves the pipeline on, outline = open / dismiss.
const ink = "text-ink";
const muted = "text-stone-500";
const line = "border-stone-300";
const darkLink = "inline-flex items-center gap-5 whitespace-nowrap rounded-xl border border-ink bg-ink px-5 py-2.5 text-base font-semibold text-white hover:bg-black";
const outlineLink = `inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-5 py-2.5 text-base hover:bg-white ${line} ${ink}`;
const badge = "rounded px-2 py-0.5 text-xs font-normal tracking-normal";
const tone = {
  approve: "bg-amber-100 text-amber-800",
  problem: "bg-rose-100 text-rose-800",
  manager: "bg-violet-100 text-violet-800",
};

// What each kind of item is called on its tag. `problem` = red tag (something went wrong).
const KINDS: Record<string, { label: string; problem?: boolean }> = {
  job_spec: { label: "Job spec" },
  client_update: { label: "Client update" },
  new_sender: { label: "New sender" },
  shortlist: { label: "Shortlist" },
  no_candidates: { label: "No candidates", problem: true },
  outreach: { label: "Outreach" },
  prescreen_review: { label: "Pre-screen" },
  submission: { label: "Submission" },
  submission_rate: { label: "Rate needed" },
  client_replied: { label: "Client replied" },
  interview_times: { label: "Interview times" },
  scheduling: { label: "Scheduling", problem: true },
  gmail_send_failed: { label: "Email not sent", problem: true },
  google_event_failed: { label: "Calendar problem", problem: true },
  job_budget: { label: "Over budget", problem: true },
  stopped_run: { label: "Stopped run", problem: true },
  failed_run: { label: "Failed run", problem: true },
};
const isProblemKind = (kind: string) => !!KINDS[kind]?.problem;
// Items for the account manager rather than the recruiter (violet tag).
const forManager = (kind: string) => kind === "submission" || kind === "client_replied";

// Recently decided: one small tag per outcome.
const DECIDED: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  dismissed: "bg-stone-200 text-stone-600",
};

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const say = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The banner's headline for the most urgent kind of item, by how many of that kind are waiting.
const HEADLINES: Record<string, (n: number) => string> = {
  job_spec: (n) => (n === 1 ? "One job spec needs your eye." : `${say(n)} job specs need your eye.`),
  client_update: (n) => (n === 1 ? "A client sent an update." : `${say(n)} client updates to read.`),
  new_sender: (n) => (n === 1 ? "A new sender needs a client." : `${say(n)} new senders need a client.`),
  shortlist: (n) => (n === 1 ? "A shortlist is ready to pick." : `${say(n)} shortlists are ready to pick.`),
  outreach: (n) => (n === 1 ? "Outreach drafts are ready to review." : `${say(n)} jobs have outreach drafts to review.`),
  prescreen_review: (n) => (n === 1 ? "A pre-screen is ready for your call." : `${say(n)} pre-screens are ready for your call.`),
  submission: (n) => (n === 1 ? "A submission is ready for the client." : `${say(n)} submissions are ready for clients.`),
  submission_rate: (n) => (n === 1 ? "A submission needs the candidate’s rate." : `${say(n)} submissions need a rate.`),
  client_replied: (n) => (n === 1 ? "A client replied." : `${say(n)} clients replied.`),
  interview_times: (n) => (n === 1 ? "Interview times are ready to send." : `${say(n)} sets of interview times to send.`),
};

// Screen 2: everything waiting for a human, across all steps, in tabs: Waiting, Approve, Problems, Account manager,
// Recently decided.
export default async function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  await connection();
  const { tab } = (await searchParams) as { tab?: string };
  const [waiting, decided, clients, pendingSubs] = await Promise.all([
    db.approvalItem.findMany({ where: { status: "awaiting_approval" }, orderBy: { createdAt: "asc" } }),
    db.approvalItem.findMany({ where: { status: { not: "awaiting_approval" } }, orderBy: { decidedAt: "desc" }, take: 15 }),
    db.client.findMany(),
    db.submission.findMany({ where: { status: "awaiting_approval" }, select: { id: true, jobId: true, candidateId: true } }),
  ]);
  const submissionOf = (jobId: string | null, candidateId: string | null) => pendingSubs.find((s) => s.jobId === jobId && s.candidateId === candidateId)?.id;
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? "";

  type Item = (typeof waiting)[number];
  const dismiss = (item: Item, label = "Dismiss") => <ActionButton action={dismissProblemAction.bind(null, item.id)} label={label} variant="outline" />;
  const go = (href: string, label: string) => (
    <Link href={href} className={darkLink}>
      {label} {icons.arrowUpRight}
    </Link>
  );
  const see = (href: string, label: string) => (
    <Link href={href} className={outlineLink}>
      {label}
    </Link>
  );

  // The page an item's main button opens (also used by the banner); null when the item is decided right in its row.
  const mainLink = (item: Item): { href: string; label: string } | null => {
    const subId = submissionOf(item.jobId, item.candidateId);
    if (item.kind === "job_spec" && item.jobSpecId) return { href: `/approvals/spec/${item.jobSpecId}`, label: "Review spec" };
    if (item.kind === "shortlist" && item.jobId) return { href: `/approvals/shortlist/${item.jobId}`, label: "Pick shortlist" };
    if (item.kind === "outreach" && item.jobId) return { href: `/approvals/outreach/${item.jobId}`, label: "Review drafts" };
    if (item.kind === "submission" && subId) return { href: `/approvals/submission/${subId}`, label: "Review submission" };
    if (item.kind === "client_replied" && item.jobId) return { href: `/jobs/${item.jobId}`, label: "Open job" };
    if (item.kind === "no_candidates" && item.jobId) return { href: `/approvals/shortlist/${item.jobId}`, label: "Edit spec" };
    return null;
  };

  // The buttons on an item's row, by kind.
  const actions = (item: Item): ReactNode => {
    const isProblem = item.kind === "stopped_run" || item.kind === "failed_run";
    const isJobProblem = isProblem && item.step >= 2 && !!item.jobId;
    const main = mainLink(item);
    // Older items: new senders are now handled on the Briefs page.
    if (item.kind === "new_sender")
      return (
        <>
          {see("/", "Choose the client on Briefs")}
          <ActionButton action={dismissInboundAction.bind(null, item.id)} label="Dismiss" variant="outline" />
        </>
      );
    if (item.kind === "client_update")
      return (
        <>
          {item.jobSpecId && see(`/approvals/spec/${item.jobSpecId}`, "See spec")}
          <ActionButton action={dismissInboundAction.bind(null, item.id)} label="Dismiss" variant="outline" />
          {item.detail?.includes("waiting for approval") && (
            <ActionButton action={regenerateWithUpdateAction.bind(null, item.id)} label="Regenerate spec with this update" pendingLabel="Agent is rewriting… (~30s)" variant="lime" />
          )}
        </>
      );
    if (item.kind === "interview_times" && item.jobId && item.candidateId) return <InterviewTimesLink jobId={item.jobId} candidateId={item.candidateId} />;
    if (item.kind === "client_replied" && main)
      return (
        <>
          {dismiss(item, "Mark handled")}
          {go(main.href, main.label)}
        </>
      );
    if ((item.kind === "gmail_send_failed" || item.kind === "google_event_failed") && item.jobId)
      return (
        <>
          {see(`/jobs/${item.jobId}`, "See job")}
          {dismiss(item)}
          <ActionButton action={retryProblemAction.bind(null, item.id)} label="Try again" pendingLabel="Sending…" variant="lime" />
        </>
      );
    if (item.kind === "prescreen_review" && item.jobId && item.candidateId)
      return (
        <>
          {see(`/jobs/${item.jobId}`, "See answers")}
          <ActionButton action={decidePrescreenAction.bind(null, item.jobId, item.candidateId, "dont_submit")} label="Don't submit" variant="outline" />
          <ActionButton action={decidePrescreenAction.bind(null, item.jobId, item.candidateId, "submit")} label="Prepare submission" variant="lime" />
        </>
      );
    if (item.kind === "submission_rate" && item.jobId && item.candidateId)
      return <RateForm jobId={item.jobId} candidateId={item.candidateId} placeholder={/EUR|€/.test(item.detail ?? "") ? "e.g. €55/hr" : "e.g. $55/hr"} />;
    if (item.kind === "scheduling" && item.jobId)
      return (
        <>
          {see(`/jobs/${item.jobId}`, "See job")}
          {dismiss(item, "Mark handled")}
        </>
      );
    if (item.kind === "no_candidates" && main)
      return (
        <>
          {dismiss(item)}
          {go(main.href, main.label)}
        </>
      );
    if (item.kind === "job_budget")
      return (
        <>
          <ActionButton action={stopOverBudgetAction.bind(null, item.id)} label="Stop job" variant="outline" />
          <ActionButton action={continueOverBudgetAction.bind(null, item.id)} label="Continue" pendingLabel="Starting…" variant="lime" />
        </>
      );
    // CV upload (docs/specs/15-cv-upload.md): nothing was kept to retry with; the recruiter uploads the file again.
    if (isProblem && item.step === 3 && !item.jobId)
      return (
        <>
          {dismiss(item)}
          {see("/candidates", "Candidates page")}
        </>
      );
    if (isProblem && item.step === 9)
      return (
        <>
          {dismiss(item)}
          {see("/feedback", "Feedback page")}
        </>
      );
    if (isProblem)
      return (
        <>
          {see(isJobProblem ? `/jobs/${item.jobId}` : "/runs?over=1", isJobProblem ? "See job" : "See run")}
          {dismiss(item)}
          <ActionButton action={retryProblemAction.bind(null, item.id)} label="Try again" pendingLabel={isJobProblem ? "Starting…" : "Running… (~30s)"} variant="lime" />
        </>
      );
    return main ? go(main.href, main.label) : null;
  };

  // "Job spec: Senior Go Engineer" -> "Senior Go Engineer": the tag already says what it is (problems keep their wording).
  const shortTitle = (item: { kind: string; title: string }) =>
    KINDS[item.kind] && !KINDS[item.kind].problem ? item.title.replace(/^[^:]{1,30}:\s+/, "").replace(/^./, (c) => c.toUpperCase()) : item.title;

  // One numbered row: title with its tags, then client / date in grey capitals, the detail, and the buttons on the right.
  const row = (item: Item, n: number) => {
    const kind = KINDS[item.kind] ?? { label: item.kind.replaceAll("_", " ") };
    const meta = [clientName(item.clientId), dateTime(item.createdAt)].filter(Boolean).join(" / ");
    return (
      <li key={item.id} id={`item-${item.id}`} className="flex scroll-mt-6 flex-wrap items-center gap-x-6 gap-y-3 py-6 sm:flex-nowrap">
        <span className={`w-8 shrink-0 self-start pt-1.5 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(n).padStart(2, "0")}</span>
        <div className="min-w-0 flex-[1_1_300px]">
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xl tracking-tight break-words sm:text-2xl ${ink}`}>
            {shortTitle(item)}
            <span className={`${badge} ${kind.problem ? tone.problem : tone.approve}`}>{kind.label}</span>
            {forManager(item.kind) && <span className={`${badge} ${tone.manager}`}>Account manager</span>}
          </div>
          {meta && <div className={`mt-1.5 text-sm tracking-wide uppercase ${muted}`}>{meta}</div>}
          {item.detail && <p className={`mt-1.5 max-w-3xl text-base leading-snug ${muted}`}>{item.detail}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 max-sm:basis-full">{actions(item)}</div>
      </li>
    );
  };

  // "The next useful thing": the oldest item to approve (or, if there are none, the oldest problem), then a line on
  // what else is waiting. Its button opens that item, or jumps to its row when it's decided right there.
  const approve = waiting.filter((i) => !isProblemKind(i.kind));
  const problems = waiting.filter((i) => isProblemKind(i.kind));
  const manager = waiting.filter((i) => forManager(i.kind));
  const first = approve[0] ?? problems[0];
  const next = (() => {
    if (!first)
      return {
        title: "Nothing needs you right now.",
        text: "The agents are working. Anything that needs a human yes shows up here.",
        href: "/jobs",
        cta: "Open jobs",
      };
    const firstIsProblem = isProblemKind(first.kind);
    const group = firstIsProblem ? problems : approve.filter((i) => i.kind === first.kind);
    const title = firstIsProblem
      ? group.length === 1
        ? "One problem needs a look."
        : `${say(group.length)} problems need a look.`
      : (HEADLINES[first.kind] ?? ((n: number) => plural(n, "item needs you.", "items need you.")))(group.length);
    const restApprove = approve.length - (firstIsProblem ? 0 : group.length);
    const restProblems = problems.length - (firstIsProblem ? group.length : 0);
    const also = [restApprove > 0 && `${restApprove} more to approve`, restProblems > 0 && plural(restProblems, "problem", "problems")].filter(Boolean);
    const client = clientName(first.clientId);
    const what = `${group.length > 1 ? "Oldest: " : ""}${shortTitle(first)}${client ? ` · ${client}` : ""}.`;
    const main = mainLink(first);
    return {
      title,
      text: also.length ? `${what} Also waiting: ${also.join(", ")}.` : what,
      href: main?.href ?? `/approvals#item-${first.id}`,
      cta: main?.label ?? "Show me",
    };
  })();

  const tabs = [
    { key: "waiting", label: "Waiting", count: waiting.length },
    { key: "approve", label: "Approve", count: approve.length },
    { key: "problems", label: "Problems", count: problems.length },
    { key: "manager", label: "Account manager", count: manager.length },
    { key: "decided", label: "Recently decided", count: decided.length },
  ];
  const active = tabs.find((t) => t.key === tab)?.key ?? "waiting";
  const shown = { waiting, approve, problems, manager }[active as "waiting"] ?? [];
  const empty: Record<string, string> = {
    waiting: "Nothing is waiting for you.",
    approve: "Nothing to approve.",
    problems: "No problems. Everything ran as planned.",
    manager: "Nothing waiting for the account manager.",
  };

  return (
    <div className={`flex flex-col gap-10 pt-2 sm:gap-12 ${ink}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className={`min-w-0 flex-[1_1_240px] text-lg font-semibold tracking-tight uppercase sm:text-xl ${muted}`}>Approval queue</div>
        <span className={`text-base ${muted}`}>Nothing leaves Hireloop without a human yes.</span>
      </div>

      <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] sm:text-7xl lg:text-[5.5rem]">
        Agents draft.
        <br />
        You decide.
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
        <nav className="flex flex-wrap gap-1 sm:gap-2" aria-label="Approval queue">
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <Link
                key={t.key}
                href={t.key === "waiting" ? "/approvals" : `/approvals?tab=${t.key}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3.5 py-2.5 text-base whitespace-nowrap sm:px-5 sm:py-3 sm:text-lg ${on ? "bg-ink text-white" : `${muted} hover:text-ink`}`}
              >
                {t.label} · {t.count}
              </Link>
            );
          })}
        </nav>

        {active === "decided" ? (
          decided.length ? (
            <ul className={`divide-y divide-stone-300 border-b ${line}`}>
              {decided.map((item, i) => {
                const href =
                  item.kind === "shortlist" && item.jobId
                    ? `/approvals/shortlist/${item.jobId}`
                    : item.kind === "outreach" && item.jobId
                      ? `/approvals/outreach/${item.jobId}`
                      : item.jobSpecId
                        ? `/approvals/spec/${item.jobSpecId}`
                        : null;
                const meta = [KINDS[item.kind]?.label ?? item.kind, clientName(item.clientId), item.decidedAt && dateTime(item.decidedAt)].filter(Boolean).join(" / ");
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5 sm:flex-nowrap">
                    <span className={`w-8 shrink-0 self-start pt-1 font-mono text-sm tabular-nums sm:w-12 sm:pl-2 ${muted}`}>{String(i + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-[1_1_300px]">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-lg tracking-tight sm:text-xl">
                        {shortTitle(item)}
                        <span className={`${badge} ${DECIDED[item.status] ?? "bg-stone-200 text-stone-600"}`}>{item.status.replaceAll("_", " ")}</span>
                      </div>
                      <div className={`mt-1 text-sm tracking-wide uppercase ${muted}`}>{meta}</div>
                    </div>
                    {href && (
                      <Link href={href} className={outlineLink}>
                        Open {icons.arrowUpRight}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>Nothing decided yet.</Empty>
          )
        ) : shown.length ? (
          <ul className={`divide-y divide-stone-300 border-b ${line}`}>{shown.map((item, i) => row(item, i + 1))}</ul>
        ) : (
          <Empty>{empty[active]}</Empty>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{children}</div>;
}

// "Send interview times" item -> the times screen of that candidate's interview.
async function InterviewTimesLink({ jobId, candidateId }: { jobId: string; candidateId: string }) {
  const iv = await db.interview.findUnique({ where: { jobId_candidateId: { jobId, candidateId } }, select: { id: true } });
  if (!iv) return null;
  return (
    <Link href={`/approvals/interview/${iv.id}`} className={darkLink}>
      Review times {icons.arrowUpRight}
    </Link>
  );
}
