import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/db";
import type { SubmissionData } from "@/agents/submission/schema";
import { candidateRef } from "@/agents/submission/workflow";
import type { SubmissionFormat } from "@/config/submission";
import { PrintButton } from "./print-button";

// Step 7: the one-page profile exactly as the client would see it (template fields only), generated on demand from
// the database; nothing is written to disk. "Print / save as PDF" uses the browser's print dialog (`?print=1`
// opens it straight away: the PDF icon on Send to client).
export default async function SubmissionPreviewPage({ params, searchParams }: PageProps<"/submissions/[id]">) {
  await connection();
  const { id } = await params;
  const { print } = await searchParams;
  const sub = await db.submission.findUnique({ where: { id } });
  if (!sub) notFound();
  const [job, client, candidate] = await Promise.all([
    db.job.findUniqueOrThrow({ where: { id: sub.jobId } }),
    db.client.findUniqueOrThrow({ where: { id: sub.clientId } }),
    db.candidate.findUniqueOrThrow({ where: { id: sub.candidateId } }),
  ]);
  const d = sub.data as SubmissionData;
  const has = (f: string) => ((sub.format as SubmissionFormat).fields as string[]).includes(f);

  const status = STATUS[sub.status] ?? { label: sub.status.replaceAll("_", " "), style: "bg-stone-200 text-stone-700" };
  // Numbered sections, as on Send to client. Only the format's fields are shown.
  const sections = [
    has("summary") && { title: "Summary", body: <p className="leading-relaxed text-stone-800">{d.summary}</p> },
    has("key_skills") && {
      title: "Key skills",
      body: (
        <div className="flex flex-wrap gap-1.5">
          {d.key_skills.map((k) => (
            <span key={k} className="rounded-md bg-soft px-2.5 py-0.5 text-sm text-olive">
              {k}
            </span>
          ))}
        </div>
      ),
    },
    has("experience_highlights") && {
      title: "Experience highlights",
      body: (
        <ul className="space-y-1.5">
          {d.experience_highlights.map((h, i) => (
            <li key={i} className="flex gap-3 leading-snug text-stone-800">
              <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-olive-mid" />
              {h}
            </li>
          ))}
        </ul>
      ),
    },
  ].filter((x) => !!x);

  return (
    <div className="mx-auto max-w-[210mm] text-ink">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <Link href={`/approvals/submission/${sub.id}`} className="text-sm text-stone-500 hover:text-ink">
            ← Send to client
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-base text-stone-500">
            What {client.name} sees
            <span className={`rounded-md px-2 py-0.5 text-sm ${status.style}`}>{status.label}</span>
          </div>
        </div>
        <PrintButton autoPrint={print === "1"} />
      </div>

      <article className="space-y-7 rounded-xl border border-stone-300 bg-white px-8 py-9 sm:px-12 sm:py-11 print:rounded-none print:border-0 print:p-0 print:[print-color-adjust:exact]">
        <header className="border-b border-stone-200 pb-6">
          <div className="font-mono text-xs tracking-[0.2em] text-stone-500 uppercase">Hireloop · Candidate profile for {client.name}</div>
          <h1 className="mt-3 text-3xl leading-tight font-bold tracking-[-0.03em]">{sub.anonymized ? candidateRef(sub.candidateId) : candidate.fullName}</h1>
          {has("headline") && <div className="mt-1 text-lg text-stone-700">{d.headline}</div>}
          <div className="mt-3 inline-block rounded-md bg-soft px-2.5 py-0.5 text-sm text-olive">Role · {job.title}</div>
        </header>

        {sections.map((sec, i) => (
          <section key={sec.title}>
            <div className="mb-3 flex items-center gap-3">
              <span className="rounded-md bg-soft px-2 py-0.5 font-mono text-xs text-olive">{String(i + 1).padStart(2, "0")}</span>
              <h2 className="text-base font-medium">{sec.title}</h2>
            </div>
            {sec.body}
          </section>
        ))}

        {(has("rate") || has("availability")) && (
          <section className="grid gap-3 border-t border-stone-200 pt-6 sm:grid-cols-2">
            {has("rate") && (
              <div className="rounded-lg bg-panel px-4 py-3">
                <div className="font-mono text-xs tracking-[0.2em] text-stone-500 uppercase">Rate</div>
                <div className="mt-1 text-base">{d.rate}</div>
              </div>
            )}
            {has("availability") && (
              <div className="rounded-lg bg-panel px-4 py-3">
                <div className="font-mono text-xs tracking-[0.2em] text-stone-500 uppercase">Availability</div>
                <div className="mt-1 text-base">{d.availability}</div>
              </div>
            )}
          </section>
        )}
      </article>
    </div>
  );
}

const STATUS: Record<string, { label: string; style: string }> = {
  awaiting_approval: { label: "Draft, awaiting approval", style: "bg-amber-100 text-amber-800" },
  sent: { label: "Sent to client", style: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected draft", style: "bg-rose-100 text-rose-800" },
  withdrawn: { label: "Not submitted", style: "bg-stone-200 text-stone-600" },
};
