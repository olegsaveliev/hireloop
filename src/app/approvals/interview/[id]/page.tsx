import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { dateTime, initials } from "@/lib/format";
import { utcToZonedInput } from "@/lib/timezones";
import { MessageBody } from "../../../jobs/[id]/message-body";
import { TimesEditor } from "./times-editor";
import { PageHeader } from "../../../page-header";

// Step 8 approval (since 2026-10-08): the interview times and the email to the candidate, before anything is sent.
// Redesigned 2026-10-09: the times first; the email and the latest messages are folded.
export default async function InterviewTimesPage({ params }: PageProps<"/approvals/interview/[id]">) {
  await connection();
  const { id } = await params;
  const iv = await db.interview.findUnique({ where: { id } });
  if (!iv) notFound();
  const [job, candidate, client, draft, thread] = await Promise.all([
    db.job.findUniqueOrThrow({ where: { id: iv.jobId } }),
    db.candidate.findUniqueOrThrow({ where: { id: iv.candidateId } }),
    db.client.findUniqueOrThrow({ where: { id: iv.clientId } }),
    db.message.findFirst({ where: { jobId: iv.jobId, candidateId: iv.candidateId, kind: "scheduling", status: "awaiting_approval" }, orderBy: { createdAt: "desc" } }),
    db.message.findMany({ where: { jobId: iv.jobId, candidateId: iv.candidateId, direction: "inbound" }, orderBy: { sentAt: "desc" }, take: 4 }),
  ]);
  const ctz = iv.candidateTz ?? iv.clientTz;
  const lastClient = thread.find((m) => m.kind === "client");
  const lastCandidate = thread.find((m) => m.kind !== "client");
  const ready = iv.status === "times_draft" && !!draft;
  const latest = [lastClient && { who: "Client", m: lastClient }, lastCandidate && { who: candidate.fullName.split(" ")[0], m: lastCandidate }].filter((x) => !!x);

  return (
    <div className="text-ink">
      <PageHeader
        back={{ href: `/jobs/${job.id}`, label: "Job page" }}
        title="Send interview times"
        meta={
          <>
            <span>{candidate.fullName}</span>
            <span className={`rounded-md px-2 py-0.5 text-sm ${ready ? "bg-amber-100 text-amber-800" : "bg-stone-200 text-stone-600"}`}>{ready ? "Awaiting approval" : "Already decided"}</span>
            <span>
              {client.name} · {job.title}
            </span>
          </>
        }
        subtitle="Pick the times to offer. Nothing is sent until you approve."
      />

      {!ready ? (
        <p className={`mt-5 rounded-xl border border-dashed border-stone-300 bg-white/60 px-6 py-6 text-center text-base ${muted}`}>
          These times were already decided (status: {iv.status.replaceAll("_", " ")}). See the{" "}
          <Link href={`/jobs/${job.id}`} className="underline underline-offset-2">
            Job page
          </Link>
          .
        </p>
      ) : (
        <article className="mt-5 overflow-hidden rounded-xl border border-stone-300 bg-white">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 px-5 py-3.5 sm:px-6">
            <span className="hidden size-10 shrink-0 place-items-center rounded-full bg-soft text-sm text-olive sm:grid">{initials(candidate.fullName)}</span>
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium break-words">{candidate.fullName}</div>
              <div className={`text-sm break-all ${muted}`}>Candidate · {draft.toEmail}</div>
            </div>
          </header>
          <TimesEditor
            now={new Date().getTime()}
            interviewId={iv.id}
            jobId={job.id}
            candidateName={candidate.fullName}
            candidateTz={ctz}
            clientTz={iv.clientTz}
            subject={draft.subject}
            body={draft.body}
            slots={(iv.proposedSlots as string[]).map((s) => utcToZonedInput(new Date(s), ctz))}
            calendarChecked={!!(draft.agentDraft as { calendarChecked?: boolean } | null)?.calendarChecked}
          />
        </article>
      )}

      {latest.length > 0 && (
        <details className="group mt-5">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-olive [&::-webkit-details-marker]:hidden">
            <span className="text-[10px] transition-transform group-open:rotate-90">▶</span>
            Latest messages ({latest.length})
          </summary>
          <div className="mt-3 space-y-2">
            {latest.map(({ who, m }) => (
              <div key={m.id} className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm">
                <div className={`text-xs ${muted}`}>
                  {who} · {dateTime(m.sentAt ?? m.createdAt)}
                </div>
                <MessageBody body={m.body} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

const muted = "text-stone-500";
