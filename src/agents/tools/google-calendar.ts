// Real Google Calendar (docs/specs/14-google-calendar.md): interview events in the recruiter's primary calendar, with a
// Google Meet link and invites sent by Google, plus the recruiter's free/busy. Guardrails: only events the app created
// (stored ids) are changed or deleted; free/busy only, never event details; never from automated tests.
import { randomUUID } from "node:crypto";
import { calendar } from "@googleapis/calendar";
import type { OAuth2Client } from "google-auth-library";
import { isTestScript } from "./gmail";
import { withGoogle } from "./google-auth";

const api = (auth: OAuth2Client) => calendar({ version: "v3", auth });
const offInTests = () => {
  if (isTestScript()) throw new Error("Real Google Calendar is off inside automated tests (scripts/tests/*, eval).");
};

export type CreatedEvent = { eventId: string; htmlLink: string | null; meetLink: string | null };
export type EventArgs = { summary: string; description: string; start: Date; end: Date; guests: string[] };

async function createEvent(a: EventArgs): Promise<CreatedEvent> {
  offInTests();
  return withGoogle(async (auth) => {
    const res = await api(auth).events.insert({
      calendarId: "primary",
      conferenceDataVersion: 1,
      sendUpdates: "all", // Google emails the invites
      requestBody: {
        summary: a.summary,
        description: a.description,
        start: { dateTime: a.start.toISOString() },
        end: { dateTime: a.end.toISOString() },
        attendees: a.guests.map((email) => ({ email })),
        conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
        reminders: { useDefault: true },
      },
    });
    const meet = res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? res.data.hangoutLink ?? null;
    return { eventId: res.data.id!, htmlLink: res.data.htmlLink ?? null, meetLink: meet };
  });
}

async function deleteEvent(eventId: string): Promise<void> {
  offInTests();
  await withGoogle(async (auth) => {
    try {
      await api(auth).events.delete({ calendarId: "primary", eventId, sendUpdates: "all" });
    } catch (e) {
      if (/410|404|deleted|Not Found/i.test(e instanceof Error ? e.message : String(e))) return; // already gone
      throw e;
    }
  });
}

// The recruiter's busy intervals (free/busy only: no titles or details).
async function busyTimes(from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
  offInTests();
  return withGoogle(async (auth) => {
    const res = await api(auth).freebusy.query({ requestBody: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] } });
    const busy = res.data.calendars?.primary?.busy ?? [];
    return busy.map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
  });
}

// Tests swap these for a fake Google Calendar and set `fake: true`.
export const calendarTransport = { createEvent, deleteEvent, busyTimes, fake: false };
export const realCalendarAllowed = () => calendarTransport.fake || !isTestScript();
