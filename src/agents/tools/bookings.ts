// The app's own interview bookings (`calendar_events`), per candidate and client contact. Called by app code only.
// A person is busy only when the app already booked them; your real busy hours come from Google Calendar's free/busy
// (src/agents/scheduling/workflow.ts, specs/14). Candidates and clients have no calendar we can read.
import { db } from "@/lib/db";
import { INTERVIEW_MINUTES } from "@/config/scheduling";
import { withinWorkingHours } from "@/lib/timezones";

const HOUR = 3600_000;
const MIN = 60_000;

type Interval = { start: number; end: number };
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

async function events(person: string, from: Date, to: Date): Promise<Interval[]> {
  const rows = await db.calendarEvent.findMany({ where: { person, startsAt: { lt: to }, endsAt: { gt: from } } });
  return rows.map((r) => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime() }));
}

function freeAt(start: Date, busy: Interval[], minutes: number): boolean {
  const slot = { start: start.getTime(), end: start.getTime() + minutes * MIN };
  return !busy.some((b) => overlaps(b, slot));
}

// get_free_slots(person, range): interview-length slots starting on the hour, inside the person's
// working hours (09:00-19:00 local, weekdays), with nothing booked.
export async function getFreeSlots(person: string, tz: string, range: { from: Date; to: Date }, minutes = INTERVIEW_MINUTES): Promise<Date[]> {
  const busy = await events(person, range.from, range.to);
  const slots: Date[] = [];
  for (let t = Math.ceil(range.from.getTime() / HOUR) * HOUR; t + minutes * MIN <= range.to.getTime(); t += HOUR) {
    const start = new Date(t);
    if (withinWorkingHours(start, tz, minutes) && freeAt(start, busy, minutes)) slots.push(start);
  }
  return slots;
}

export type Attendee = { person: string; tz: string };

// book(slot, attendees): refuses a time outside 09:00-19:00 local for anyone (guardrail, in code)
// or a time someone is no longer free. Returns the event ids, or why it can't book.
export async function book(slot: Date, attendees: Attendee[], title: string, interviewId: string): Promise<{ eventIds: string[] } | { error: string }> {
  const end = new Date(slot.getTime() + INTERVIEW_MINUTES * MIN);
  for (const a of attendees) {
    if (!withinWorkingHours(slot, a.tz)) return { error: `outside 09:00-19:00 local time for ${a.person}` };
    if (!freeAt(slot, await events(a.person, slot, end), INTERVIEW_MINUTES)) return { error: `${a.person} is no longer free at that time` };
  }
  const eventIds: string[] = [];
  for (const a of attendees) {
    const e = await db.calendarEvent.create({ data: { person: a.person, startsAt: slot, endsAt: end, title, interviewId } });
    eventIds.push(e.id);
  }
  return { eventIds };
}

export async function cancel(eventIds: string[]) {
  await db.calendarEvent.deleteMany({ where: { id: { in: eventIds } } });
}
