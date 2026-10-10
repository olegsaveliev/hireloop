// Time zone helpers for Step 8 (scheduling). Plain code with the built-in Intl time zone database (handles
// summer/winter time: Europe and the US switch on different dates). All times are stored in UTC.
import { CITY_TIME_ZONES, COUNTRY_TIME_ZONES, INTERVIEW_MINUTES, WORK_END_HOUR, WORK_START_HOUR } from "@/config/scheduling";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const partsFormat = new Map<string, Intl.DateTimeFormat>();
// Local calendar parts of an instant in a time zone.
export function localParts(d: Date, tz: string) {
  let f = partsFormat.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
    partsFormat.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`, // local calendar date, e.g. "2026-10-13"
    weekday: WEEKDAYS.indexOf(p.weekday), // 0 = Sunday
    minutes: Number(p.hour) * 60 + Number(p.minute), // minutes since local midnight
  };
}

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;

// Guardrail "never book outside 09:00-19:00 local time": the whole interview, on a weekday, in this time zone.
export function withinWorkingHours(start: Date, tz: string, minutes = INTERVIEW_MINUTES): boolean {
  const s = localParts(start, tz);
  const e = localParts(new Date(start.getTime() + minutes * 60_000), tz);
  return isWeekday(s.weekday) && s.date === e.date && s.minutes >= WORK_START_HOUR * 60 && e.minutes <= WORK_END_HOUR * 60;
}

// "Europe/Kyiv" -> "Kyiv", "America/New_York" -> "New York".
export const cityOf = (tz: string) => tz.split("/").at(-1)!.replaceAll("_", " ");

// "UTC+3", "UTC-4" (the offset on that date: summer and winter time differ).
export function offsetLabel(d: Date, tz: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value ?? "GMT";
  return name === "GMT" ? "UTC+0" : name.replace("GMT", "UTC");
}

const hm = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const day = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);

// One side of a slot, time zone stated explicitly: "Tue 13 Oct, 16:00-17:00 Kyiv time (UTC+3)".
export function slotIn(start: Date, tz: string, minutes = INTERVIEW_MINUTES): string {
  const end = new Date(start.getTime() + minutes * 60_000);
  return `${day(start, tz)}, ${hm(start, tz)}-${hm(end, tz)} ${cityOf(tz)} time (${offsetLabel(start, tz)})`;
}

// Both sides: the reader's time zone first. Same zone -> stated once.
export function slotLine(start: Date, readerTz: string, otherTz: string): string {
  if (offsetLabel(start, readerTz) === offsetLabel(start, otherTz) && cityOf(readerTz) === cityOf(otherTz)) return slotIn(start, readerTz);
  return `${slotIn(start, readerTz)} = ${hm(start, otherTz)}-${hm(new Date(start.getTime() + INTERVIEW_MINUTES * 60_000), otherTz)} ${cityOf(otherTz)} time (${offsetLabel(start, otherTz)})`;
}

// Candidate's time zone from the profile location ("Wrocław, Poland" -> Europe/Warsaw, "London, United Kingdom" ->
// Europe/London, "Austin, TX, USA" -> America/Chicago). Country first, then a city. null = unknown (never guessed).
export function timeZoneOfLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const parts = location
    .split(/[,(\/]/)
    .map((x) => x.replace(/\)/g, "").trim().toLowerCase())
    .filter(Boolean);
  for (const part of [...parts].reverse()) if (COUNTRY_TIME_ZONES[part]) return COUNTRY_TIME_ZONES[part];
  for (const part of parts) {
    if (CITY_TIME_ZONES[part]) return CITY_TIME_ZONES[part];
    const zone = zoneByCity().get(part);
    if (zone) return zone;
  }
  return null;
}

// "london" -> "Europe/London", from the built-in time zone list (city part of each name).
let byCity: Map<string, string> | null = null;
function zoneByCity(): Map<string, string> {
  if (!byCity) byCity = new Map(Intl.supportedValuesOf("timeZone").map((z) => [cityOf(z).toLowerCase(), z]));
  return byCity;
}

// The time zone list for pickers: every zone the built-in database knows, Europe and the Americas first.
export function allTimeZones(): string[] {
  const all = Intl.supportedValuesOf("timeZone").filter((z) => z.includes("/") && !z.startsWith("Etc/"));
  const rank = (z: string) => (z.startsWith("Europe/") ? 0 : z.startsWith("America/") ? 1 : 2);
  return all.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// The next `n` business days (Mon-Fri) after `from`, as local dates in `tz`.
export function nextBusinessDays(from: Date, tz: string, n: number): string[] {
  const days: string[] = [];
  const today = localParts(from, tz).date;
  for (let t = from.getTime(); days.length < n; t += 6 * 3600_000) {
    const p = localParts(new Date(t), tz);
    if (p.date !== today && isWeekday(p.weekday) && !days.includes(p.date)) days.push(p.date);
  }
  return days;
}

// "2026-10-13T16:00" read as local time in `tz` -> the exact moment (UTC). Used by the interview-times editor
// (specs/08: times are approved and editable). Two passes handle summer/winter time changes.
export function zonedToUtc(local: string, tz: string): Date {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error(`Not a date and time: ${local}`);
  const wanted = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = wanted;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(t), tz);
    const shown = Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), Math.floor(p.minutes / 60), p.minutes % 60);
    t += wanted - shown;
  }
  return new Date(t);
}

// The exact moment as "2026-10-13T16:00" in `tz` (for a datetime-local input).
export function utcToZonedInput(d: Date, tz: string): string {
  const p = localParts(d, tz);
  return `${p.date}T${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`;
}
