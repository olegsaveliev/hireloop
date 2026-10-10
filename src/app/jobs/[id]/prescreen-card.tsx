import { missingAnswers, type PrescreenQuestion, type PrescreenSummary } from "@/agents/prescreen/schema";
import { dateTime } from "@/lib/format";
import { ActionButton } from "../../action-button";
import { decidePrescreenAction } from "../actions";
import Link from "next/link";
import { icons } from "../../icons";
import { btnOutline, panel } from "./card-styles";
import { Actions, Facts, Missing, Numbered, TabHead, Tag } from "./card-ui";
import type { Tone } from "./card-styles";

type PrescreenRow = {
  jobId: string;
  candidateId: string;
  status: string;
  questions: unknown;
  data: unknown;
  recommendation: string | null;
  completeness: number | null;
  decision: string | null;
  decidedAt: Date | null;
  updatedAt: Date;
};

const RECOMMENDATION: Record<string, { label: string; tone: Tone; text: string }> = {
  proceed: { label: "Proceed", tone: "green", text: "The agent suggests submitting them to the client." },
  discuss: { label: "Discuss", tone: "amber", text: "The agent isn't sure: your call." },
  stop: { label: "Stop", tone: "rose", text: "The agent suggests not submitting them." },
};

type SubmissionRow = { id: string; status: string; decidedAt: Date | null; createdAt: Date };

// Pre-screen tab on the Job page (Step 6): waiting for answers, or the summary, the facts, the answers and your call.
export function PrescreenCard({ p, submission }: { p: PrescreenRow; submission: SubmissionRow | null }) {
  const questions = p.questions as PrescreenQuestion[];
  const s = p.data as PrescreenSummary | null;
  if (!s) {
    // questions_draft until the recruiter approves the questions on the Review outreach screen.
    const drafted = p.status === "questions_draft";
    return (
      <div className={panel}>
        <TabHead
          tag={<Tag tone="amber">{drafted ? "Questions drafted" : "Questions sent"}</Tag>}
          text={drafted ? `${questions.length} questions are waiting for your approval.` : `Waiting for answers to ${questions.length} questions.`}
          meta={dateTime(p.updatedAt)}
        />
        <Numbered items={questions.map((q) => q.question)} />
        <Actions note={drafted ? "Nothing is sent until you approve it." : "Answers arrive when you click Check replies."}>
          {drafted && (
            <Link href={`/approvals/outreach/${p.jobId}`} className={btnOutline}>
              Review questions {icons.arrowUpRight}
            </Link>
          )}
        </Actions>
      </div>
    );
  }
  const missing = missingAnswers(s);
  const rec = RECOMMENDATION[s.recommendation] ?? { label: s.recommendation, tone: "grey" as Tone, text: "" };
  const answered = s.answers.length - missing.length;
  return (
    <div className={panel}>
      <TabHead tag={<Tag tone={rec.tone}>{rec.label}</Tag>} text={rec.text} meta={`${answered}/${s.answers.length} answered · ${dateTime(p.updatedAt)}`} />
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-stone-700">{s.summary}</p>
      {s.red_flags.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {s.red_flags.map((f) => (
            <li key={f} className="flex gap-3 text-base text-rose-800">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-rose-500" />
              {f}
            </li>
          ))}
        </ul>
      )}
      <Facts
        items={[
          ["Rate", s.rate_expectation ?? <Missing />],
          ["Availability", s.availability ?? <Missing />],
        ]}
      />
      <details className="group mt-6">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-base text-olive [&::-webkit-details-marker]:hidden">
          <span className="text-[10px] transition-transform group-open:rotate-90">▶</span>
          Questions and answers · {s.answers.length}
          {missing.length > 0 && <Tag tone="amber">{missing.length} not answered</Tag>}
        </summary>
        <Numbered
          items={s.answers.map((a) => (
            <>
              <div className="text-stone-500">{a.question}</div>
              <div className="mt-0.5">{a.answer ? a.answer : <Missing>Not answered</Missing>}</div>
            </>
          ))}
        />
      </details>
      <Actions note={p.decision ? `Your call: ${p.decision === "submit" ? "submit" : "don't submit"}${p.decidedAt ? ` · ${dateTime(p.decidedAt)}` : ""}` : !submission ? "Your call: submit them to the client?" : undefined}>
        {!p.decision && !submission && (
          <>
            <ActionButton action={decidePrescreenAction.bind(null, p.jobId, p.candidateId, "dont_submit")} label="Don't submit" variant="outline" />
            <ActionButton action={decidePrescreenAction.bind(null, p.jobId, p.candidateId, "submit")} label="Prepare submission" variant="lime" />
          </>
        )}
      </Actions>
    </div>
  );
}

const SUBMISSION: Record<string, { label: string; tone: Tone; text: string }> = {
  awaiting_approval: { label: "Awaiting approval", tone: "amber", text: "The client profile is ready for the account manager." },
  sent: { label: "Sent", tone: "green", text: "The client has the profile." },
  withdrawn: { label: "Not submitted", tone: "grey", text: "You chose not to send it." },
  rejected: { label: "Sent back", tone: "rose", text: "Sent back with a comment; the agent is rewriting it." },
};

// Submission tab on the Job page (Step 7): the client profile's state, where it goes, and Open / Client view.
export function SubmissionPanel({
  submission,
  rateNeeded,
  writing,
  to,
}: {
  submission: SubmissionRow | null;
  rateNeeded: boolean;
  writing: boolean;
  to: string | null; // where it went (sent) or goes (client email); null = the client has no email yet
}) {
  if (!submission) {
    return (
      <div className={panel}>
        {rateNeeded ? (
          <TabHead tag={<Tag tone="amber">Rate needed</Tag>} text="Type the candidate's rate in the approval queue so the profile can be written." />
        ) : (
          <TabHead tag={<Tag tone="soft">Writing</Tag>} text={writing ? "The agent is writing the client profile…" : "No submission yet."} />
        )}
        {rateNeeded && (
          <Actions>
            <Link href="/approvals" className={btnOutline}>
              Approval queue {icons.arrowUpRight}
            </Link>
          </Actions>
        )}
      </div>
    );
  }
  const st = SUBMISSION[submission.status] ?? { label: submission.status, tone: "grey" as Tone, text: "" };
  const pending = submission.status === "awaiting_approval";
  return (
    <div className={panel}>
      <TabHead tag={<Tag tone={st.tone}>{st.label}</Tag>} text={st.text} />
      <Facts
        items={[
          [
            pending ? "Goes to" : "Sent to",
            to ?? (
              <Missing>
                No client email yet.{" "}
                <Link href="/clients" className="underline underline-offset-2">
                  Add it on Clients
                </Link>
              </Missing>
            ),
          ],
          [submission.decidedAt ? (submission.status === "sent" ? "Sent" : "Decided") : "Written", dateTime(submission.decidedAt ?? submission.createdAt)],
        ]}
      />
      <Actions>
        <Link href={`/submissions/${submission.id}`} target="_blank" className={btnOutline}>
          Client view {icons.arrowUpRight}
        </Link>
        <Link href={`/approvals/submission/${submission.id}`} className={btnOutline}>
          {pending ? "Review and send" : "Open"} {icons.arrowUpRight}
        </Link>
      </Actions>
    </div>
  );
}
