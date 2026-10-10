// Step 8: finding interview times is code, not AI (safer across time zones). Up to 3 times in the next 5 business
// days that are free in both calendars and inside 09:00-19:00 local time for both sides.
import { BUSINESS_DAYS_AHEAD, INTERVIEW_MINUTES, SLOTS_TO_PROPOSE } from "@/config/scheduling";
import { localParts, nextBusinessDays, withinWorkingHours } from "@/lib/timezones";
import { getFreeSlots, type Attendee } from "../tools/bookings";

const HOUR = 3600_000;

// `busy`: extra busy intervals every slot must avoid (the recruiter's real Google Calendar, specs/14).
export async function findSlots(args: { candidate: Attendee; client: Attendee; now?: Date; exclude?: Date[]; count?: number; busy?: { start: Date; end: Date }[] }): Promise<Date[]> {
  const now = args.now ?? new Date();
  const count = args.count ?? SLOTS_TO_PROPOSE;
  // Business days are counted on the client's calendar, starting tomorrow.
  const days = nextBusinessDays(now, args.client.tz, BUSINESS_DAYS_AHEAD);
  const range = { from: new Date(now.getTime() + HOUR), to: new Date(now.getTime() + (BUSINESS_DAYS_AHEAD + 4) * 24 * HOUR) };
  const [mine, theirs] = await Promise.all([getFreeSlots(args.candidate.person, args.candidate.tz, range), getFreeSlots(args.client.person, args.client.tz, range)]);
  const clientFree = new Set(theirs.map((d) => d.getTime()));
  const excluded = new Set((args.exclude ?? []).map((d) => d.getTime()));
  const both = mine.filter(
    (d) =>
      clientFree.has(d.getTime()) &&
      !excluded.has(d.getTime()) &&
      !(args.busy ?? []).some((b) => b.start.getTime() < d.getTime() + INTERVIEW_MINUTES * 60_000 && d.getTime() < b.end.getTime()) &&
      days.includes(localParts(d, args.client.tz).date) &&
      // Guardrail, checked again here: inside working hours for both sides.
      withinWorkingHours(d, args.candidate.tz) &&
      withinWorkingHours(d, args.client.tz),
  );
  // Spread out: the earliest time on each day first, then more times on the same days (at least 2 hours apart).
  const picked: Date[] = [];
  for (const day of days) {
    const first = both.find((d) => localParts(d, args.client.tz).date === day);
    if (first && picked.length < count) picked.push(first);
  }
  for (const d of both) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p.getTime() - d.getTime()) >= 2 * HOUR)) picked.push(d);
  }
  return picked.sort((a, b) => a.getTime() - b.getTime());
}
