// Small helpers for raw candidate profiles (mock ATS data). No AI here.

// Lowercase and strip accents, so "Kraków" matches "krakow".
export const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word match ("go" must not match "good"); works for Latin and Cyrillic text and terms like "c++".
export function containsTerm(text: string, term: string): boolean {
  const t = fold(term.trim());
  if (!t) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(t)}(?![\\p{L}\\p{N}])`, "u").test(fold(text));
}

export function emailOf(rawProfile: string): string | null {
  return rawProfile.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0].toLowerCase() ?? null;
}

// Same person under two ids (e.g. a LinkedIn export and an old CV upload) shares an email.
// Without an email, fall back to the folded full name.
export function personKey(c: { fullName: string; rawProfile: string }): string {
  return emailOf(c.rawProfile) ?? `name:${fold(c.fullName).replace(/\s+/g, " ").trim()}`;
}

// First meaningful line, for compact search results.
export function headline(rawProfile: string): string {
  const lines = rawProfile.split("\n").map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => /headline|engineer|developer|dev\b|programista|розробни/i.test(l)) ?? lines[0] ?? "";
  return line.replace(/^headline:\s*/i, "").slice(0, 140);
}

// ---------- location filter ----------
// Places a spec's location field can name, with the spellings that appear in profiles (EN/UK/PL).
const PLACES: Record<string, string[]> = {
  ukraine: ["Ukraine", "Україна", "Kyiv", "Київ", "Lviv", "Львів", "Kharkiv", "Харків", "Odesa", "Одеса", "Dnipro", "Дніпро", "Vinnytsia", "Вінниця", "Zaporizhzhia", "Ivano-Frankivsk", "Chernihiv", "Poltava"],
  poland: ["Poland", "Polska", "Warsaw", "Warszawa", "Kraków", "Wrocław", "Gdańsk", "Poznań", "Łódź", "Lublin", "Katowice", "Szczecin", "Gdynia", "Rzeszów"],
};
const CITY_TO_COUNTRY = Object.fromEntries(
  Object.entries(PLACES).flatMap(([country, names]) => names.map((n) => [fold(n), country])),
);

// Terms to filter on, derived ONLY from the spec's location field (guardrail: no other location source).
// Returns [] when the spec names no country or city we know (e.g. "Remote, EU time zone"): no filter.
export function locationTerms(specLocation: string[]): string[] {
  const text = specLocation.join(" ");
  const terms = new Set<string>();
  for (const names of Object.values(PLACES)) {
    if (names.slice(0, 2).some((n) => containsTerm(text, n))) names.forEach((n) => terms.add(n));
  }
  for (const [city, country] of Object.entries(CITY_TO_COUNTRY)) {
    if (containsTerm(text, city) && !terms.has(PLACES[country][0])) {
      terms.add(PLACES[country].find((n) => fold(n) === city)!);
    }
  }
  return [...terms];
}

// First city named in a raw profile ("Kraków", "Київ"), for the Candidates list. Null when none we know.
export function cityOf(rawProfile: string): string | null {
  for (const names of Object.values(PLACES)) {
    const city = names.slice(2).find((n) => containsTerm(rawProfile, n));
    if (city) return city;
  }
  return null;
}
