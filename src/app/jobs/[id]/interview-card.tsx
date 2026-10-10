import Link from "next/link";
import { allTimeZones, cityOf, offsetLabel, slotLine, timeZoneOfLocation } from "@/lib/timezones";
import { TimeZoneFix } from "./time-zone-fix";
import { dateTime } from "@/lib/format";
import { ActionButton } from "../../action-button";
import { clientConfirmsAction, clientDeclinesTimeAction, createGoogleEventAction, markNoShowAction, retrySchedulingAction } from "../actions";
import { ClientAnswer, HintLine, type ClientHint } from "../client-answer";
import { icons } from "../../icons";
import { btnLime, btnOutline, panel, panelLabel, type Tone } from "./card-styles";
import { Actions, Numbered, TabHead, Tag } from "./card-ui";

type InterviewRow = {
  id: string;
  status: string;
  candidateTz: string | null;
  clientTz: string;
  proposedSlots: unknown;
  chosenSlot: Date | null;
  confirmedSlot: Date | null;
  rescheduleCount: number;
  messagesToConfirm: number;
  escalationReason: string | null;
  reminderSentAt: Date | null;
  nudgedAt: Date | null;
  googleEventId: string | null;
  googleEventLink: string | null;
  meetLink: string | null;
};

const STATUS: Record<string, { label: string; tone: Tone; text: string }> = {
  finding: { label: "Finding times", tone: "soft", text: "The agent is looking for free slots…" },
  times_draft: { label: "Times ready", tone: "amber", text: "Approve the times before they go to the candidate." },
  proposed: { label: "Times sent", tone: "grey", text: "Waiting for the candidate to pick a time." },
  rescheduled: { label: "Rescheduled", tone: "amber", text: "New times sent; waiting for the candidate." },
  awaiting_client: { label: "Client to confirm", tone: "amber", text: "The candidate picked a time; the client confirms it." },
  confirmed: { label: "Booked", tone: "green", text: "In both calendars." },
  escalated: { label: "Needs you", tone: "rose", text: "Scheduling got stuck." },
  no_show: { label: "No-show", tone: "rose", text: "The candidate missed the interview." },
  cancelled: { label: "Cancelled", tone: "grey", text: "A final outcome was recorded." },
};

// Interview tab on the Job page (Step 8): the client's answer to a sent submission, then the interview being scheduled.
export function InterviewCard({
  submissionId,
  stage,
  iv,
  hint,
  location,
}: {
  submissionId: string;
  stage: string;
  iv: InterviewRow | null;
  hint: ClientHint | null;
  location: string | null; // the candidate's profile location (for the time zone picker)
}) {
  if (!iv) {
    if (stage === "client_rejected")
      return (
        <div className={panel}>
          <TabHead tag={<Tag tone="rose">Client said no</Tag>} text="The client passed on this candidate." />
        </div>
      );
    if (stage !== "submitted") return null; // e.g. withdrew before the client answered (Step 9 outcome)
    return <ClientAnswer submissionId={submissionId} hint={hint} />;
  }
  const ctz = iv.candidateTz ?? iv.clientTz;
  const line = (d: Date) => slotLine(d, ctz, iv.clientTz); // candidate (recruiter) side first
  const slots = (iv.proposedSlots as string[]).map((s) => new Date(s));
  const st = STATUS[iv.status] ?? { label: iv.status.replaceAll("_", " "), tone: "grey" as Tone, text: "" };
  const history = [
    iv.rescheduleCount > 0 && `Rescheduled ${iv.rescheduleCount}×`,
    iv.nudgedAt && `Nudged ${dateTime(iv.nudgedAt)}`,
    iv.reminderSentAt && `Reminder sent ${dateTime(iv.reminderSentAt)}`,
  ].filter(Boolean);
  const when = iv.confirmedSlot ?? iv.chosenSlot;
  // Stopped because the time zone couldn't be read from the location: the picker replaces Try again.
  const needsTz = iv.status === "escalated" && !iv.candidateTz;
  const now = new Date();
  return (
    <div className={panel}>
      <TabHead
        tag={<Tag tone={st.tone}>{st.label}</Tag>}
        text={needsTz ? "Pick the candidate's time zone to find interview times." : (iv.escalationReason ?? st.text)}
        meta={history.join(" · ") || undefined}
      />
      {needsTz && <TimeZoneFix interviewId={iv.id} location={location} guess={timeZoneOfLocation(location)} options={allTimeZones().map((z) => [z, `${cityOf(z)} · ${z.split("/")[0]} · ${offsetLabel(now, z)}`])} />}
      {when ? (
        <div className="mt-5">
          <div className={panelLabel}>{iv.confirmedSlot ? "Booked for" : "Candidate picked"}</div>
          <div className={`mt-1 text-2xl font-semibold tracking-tight ${iv.status === "cancelled" ? "text-stone-400 line-through" : ""}`}>{line(when)}</div>
        </div>
      ) : (
        slots.length > 0 && <Numbered items={slots.map((d) => line(d))} />
      )}
      {!iv.candidateTz && !needsTz && <div className="mt-3 text-sm text-amber-800">Candidate&apos;s time zone unknown; times use the client&apos;s.</div>}
      {iv.status === "awaiting_client" && hint?.label && (
        <div className="mt-4">
          <HintLine hint={hint} />
        </div>
      )}
      <Actions
        note={
          iv.status === "awaiting_client"
            ? hint
              ? "The client replied in Gmail. Record their answer."
              : "Waiting for the client to confirm (Check replies)."
            : undefined
        }
      >
        {iv.status === "confirmed" && iv.googleEventLink && (
          <a href={iv.googleEventLink} target="_blank" rel="noreferrer" className={btnOutline}>
            Calendar event {icons.arrowUpRight}
          </a>
        )}
        {iv.status === "confirmed" && iv.meetLink && (
          <a href={iv.meetLink} target="_blank" rel="noreferrer" className={btnOutline}>
            Google Meet {icons.arrowUpRight}
          </a>
        )}
        {iv.status === "awaiting_client" && hint && (
          <>
            <ActionButton action={clientDeclinesTimeAction.bind(null, iv.id)} label="Client can't make it" variant={hint.suggestion === "cant_make_time" ? "lime" : "outline"} />
            <ActionButton
              action={clientConfirmsAction.bind(null, iv.id)}
              label="Client confirms"
              pendingLabel="Booking…"
              variant={hint.suggestion === "cant_make_time" ? "outline" : "lime"}
            />
          </>
        )}
        {iv.status === "confirmed" && !iv.googleEventId && <ActionButton action={createGoogleEventAction.bind(null, iv.id)} label="Create Google event" pendingLabel="Creating…" variant="outline" />}
        {iv.status === "confirmed" && stage === "interview" && <ActionButton action={markNoShowAction.bind(null, iv.id)} label="Mark no-show" variant="outline" />}
        {iv.status === "times_draft" && (
          <Link href={`/approvals/interview/${iv.id}`} className={btnLime}>
            Review times {icons.arrowUpRight}
          </Link>
        )}
        {iv.status === "escalated" && !needsTz && <ActionButton action={retrySchedulingAction.bind(null, iv.id)} label="Try again: find new times" pendingLabel="Finding times… (~10s)" variant="lime" />}
      </Actions>
    </div>
  );
}
