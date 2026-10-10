// Step 8 (docs/specs/08-scheduling-agent.md): scheduling rules, in one place so they're easy to change.

// Interview length, and the working day nobody is booked outside of (local time, both sides).
export const INTERVIEW_MINUTES = 60;
export const WORK_START_HOUR = 9; // 09:00
export const WORK_END_HOUR = 19; // 19:00: the interview must END by then
// Look for times in the next N business days (starting tomorrow), and propose up to this many.
export const BUSINESS_DAYS_AHEAD = 5;
export const SLOTS_TO_PROPOSE = 3;
// The candidate may ask to reschedule once; the second request goes to the recruiter.
export const MAX_RESCHEDULES = 1;
// "Run reminders now": reminder this long before the interview; nudge after this long without an answer.
export const REMINDER_BEFORE_HOURS = 24;
export const NUDGE_AFTER_HOURS = 48;

// Candidate time zone from the profile's location ("Kraków, Poland"). Unknown -> escalate, never guess.
export const COUNTRY_TIME_ZONES: Record<string, string> = {
  // Countries with one time zone (2026-10-10: more added after "London, United Kingdom" got stuck).
  poland: "Europe/Warsaw",
  ukraine: "Europe/Kyiv",
  germany: "Europe/Berlin",
  netherlands: "Europe/Amsterdam",
  "united kingdom": "Europe/London",
  uk: "Europe/London",
  "great britain": "Europe/London",
  england: "Europe/London",
  scotland: "Europe/London",
  wales: "Europe/London",
  "northern ireland": "Europe/London",
  ireland: "Europe/Dublin",
  france: "Europe/Paris",
  belgium: "Europe/Brussels",
  luxembourg: "Europe/Luxembourg",
  switzerland: "Europe/Zurich",
  austria: "Europe/Vienna",
  italy: "Europe/Rome",
  spain: "Europe/Madrid",
  portugal: "Europe/Lisbon",
  denmark: "Europe/Copenhagen",
  sweden: "Europe/Stockholm",
  norway: "Europe/Oslo",
  finland: "Europe/Helsinki",
  estonia: "Europe/Tallinn",
  latvia: "Europe/Riga",
  lithuania: "Europe/Vilnius",
  "czech republic": "Europe/Prague",
  czechia: "Europe/Prague",
  slovakia: "Europe/Bratislava",
  hungary: "Europe/Budapest",
  romania: "Europe/Bucharest",
  bulgaria: "Europe/Sofia",
  moldova: "Europe/Chisinau",
  greece: "Europe/Athens",
  croatia: "Europe/Zagreb",
  slovenia: "Europe/Ljubljana",
  serbia: "Europe/Belgrade",
  cyprus: "Asia/Nicosia",
  malta: "Europe/Malta",
  georgia: "Asia/Tbilisi",
  armenia: "Asia/Yerevan",
  turkey: "Europe/Istanbul",
  israel: "Asia/Jerusalem",
  "united arab emirates": "Asia/Dubai",
  uae: "Asia/Dubai",
  india: "Asia/Kolkata",
  singapore: "Asia/Singapore",
  japan: "Asia/Tokyo",
};
// Countries with several time zones (US, Canada, ...) are matched only by city: the city part of a time zone name
// ("Los Angeles" -> America/Los_Angeles) or these extra cities. Anything else stays unknown and asks the recruiter.
export const CITY_TIME_ZONES: Record<string, string> = {
  "san francisco": "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  "san diego": "America/Los_Angeles",
  boston: "America/New_York",
  miami: "America/New_York",
  atlanta: "America/New_York",
  washington: "America/New_York",
  austin: "America/Chicago",
  dallas: "America/Chicago",
  houston: "America/Chicago",
  "salt lake city": "America/Denver",
  montreal: "America/Toronto",
  ottawa: "America/Toronto",
  kyiv: "Europe/Kyiv",
  kiev: "Europe/Kyiv",
};
