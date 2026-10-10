// Step 3: enrichment agent (docs/specs/03-enrichment-agent.md). One Haiku run per candidate; saves nothing.
// The raw profile goes straight into the prompt (no get_candidate tool call needed: saves a turn).
import { db } from "@/lib/db";
import { loadPrompt } from "../prompts";
import { runAgentWithSchema } from "../structured-output";
import { enrichmentOutputSchema, type CandidateProfileData } from "./schema";

const AGENT = "enrichment-agent" as const;

// "YYYY-MM" / "YYYY" / "present" -> month index. Start of year for "YYYY" starts, end of year for "YYYY" ends.
function monthIndex(value: string, edge: "start" | "end", now: Date): number | null {
  const v = value.trim().toLowerCase();
  if (/present|now|current|doteper|obecnie/.test(v)) return now.getFullYear() * 12 + now.getMonth();
  const m = v.match(/^(\d{4})(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const month = m[2] ? Number(m[2]) - 1 : edge === "start" ? 0 : 11;
  return Number(m[1]) * 12 + month;
}

// Years of experience from job history, counting overlapping periods once (spec edge case).
export function yearsFromHistory(history: CandidateProfileData["job_history"], now = new Date()): number | null {
  const spans = history
    .map((j) => [monthIndex(j.start, "start", now), monthIndex(j.end, "end", now)] as const)
    .filter((s): s is readonly [number, number] => s[0] !== null && s[1] !== null && s[1] >= s[0])
    .map(([a, b]) => [a, b + 1] as [number, number]) // inclusive end month
    .sort((x, y) => x[0] - y[0]);
  if (!spans.length) return null;
  let months = 0;
  let [curStart, curEnd] = spans[0];
  for (const [a, b] of spans.slice(1)) {
    if (a <= curEnd) curEnd = Math.max(curEnd, b);
    else {
      months += curEnd - curStart;
      [curStart, curEnd] = [a, b];
    }
  }
  months += curEnd - curStart;
  return Math.round((months / 12) * 10) / 10;
}

// App-side clean-up after validation: computed years, and every empty field listed in missing_fields.
export function finalizeProfile(data: CandidateProfileData, candidateId: string): CandidateProfileData {
  const computed = yearsFromHistory(data.job_history);
  const profile = { ...data, candidate_id: candidateId, years_experience: computed ?? data.years_experience };
  const empty: Record<string, boolean> = {
    current_title: !profile.current_title,
    years_experience: profile.years_experience === null,
    skills: profile.skills.length === 0,
    recent_stack: profile.recent_stack.length === 0,
    location: !profile.location,
    english_level: !profile.english_level,
    "contacts.email": !profile.contacts.email,
    "contacts.linkedin": !profile.contacts.linkedin,
    job_history: profile.job_history.length === 0,
  };
  // Recomputed from the fields themselves, so the list is consistent across candidates (the model's own
  // list sometimes names fields outside the schema, e.g. "phone").
  const missing = Object.keys(empty).filter((f) => empty[f]);
  // "contacts" as a whole: the spec's test case says "contacts null, listed in missing_fields".
  if (empty["contacts.email"] && empty["contacts.linkedin"]) missing.push("contacts");
  return { ...profile, missing_fields: missing };
}

// The candidate fields the agent sees. Seed candidates have them; eval items carry them directly.
export type RawCandidate = { id: string; source: string; rawProfile: string; language: string };

export async function runEnrichmentAgent(args: { candidateId: string; jobId?: string; extraTags?: string[]; candidate?: RawCandidate }) {
  const candidate = args.candidate ?? (await db.candidate.findUniqueOrThrow({ where: { id: args.candidateId } }));
  const result = await runAgentWithSchema(
    {
      agent: AGENT,
      systemPrompt: await loadPrompt(AGENT),
      prompt: `Candidate id: ${candidate.id}\nProfile source: ${candidate.source}\n\n<raw_profile>\n${candidate.rawProfile}\n</raw_profile>`,
      tags: ["step-3", ...(args.jobId ? [`job:${args.jobId}`] : []), ...(args.extraTags ?? [])],
      metadata: { candidate_id: candidate.id, profile_language: candidate.language },
      jobId: args.jobId,
    },
    enrichmentOutputSchema,
  );
  return { ...result, data: result.data ? finalizeProfile(result.data, candidate.id) : null };
}
