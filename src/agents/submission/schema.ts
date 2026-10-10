// Step 7 output (docs/specs/07-submission-agent.md "Output"), plus `highlight_sources`: for each experience highlight,
// a short quote from the source data it comes from ("every claim traceable"). Guardrails are checked in code;
// a failed check makes the output invalid -> one retry. The same anonymization check runs again on the account
// manager's edits before anything is sent.
import { z } from "zod";
import { fold } from "@/lib/candidates";

export const submissionFieldsSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  key_skills: z.array(z.string()),
  experience_highlights: z.array(z.string()),
  rate: z.string(),
  availability: z.string(),
});
export type SubmissionFields = z.infer<typeof submissionFieldsSchema>;

export type SubmissionData = SubmissionFields & {
  candidate_id: string;
  client_id: string;
  anonymized: boolean;
  highlight_sources: string[];
};

// Lowercase, no accents, no quotes, single spaces: so quotes and terms match the source text loosely.
const norm = (s: string) => fold(s).replace(/["'“”‘’`\\]/g, "").replace(/\s+/g, " ").trim();

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const PHONE = /(\+\d[\d\s().-]{7,}\d)|\b\d{3}[\s.-]\d{3}[\s.-]\d{3,4}\b/;

// Anonymized profiles: no name, no contacts, no employer names (spec: "remove name, contacts, current employer";
// acceptance: "no name/email/phone/employer"; all employers are removed, the stricter reading).
export function identifyingDetails(text: string, who: { fullName: string; employers: string[] }): string[] {
  const t = norm(text);
  const hits: string[] = [];
  for (const part of who.fullName.split(/\s+/).filter((p) => p.length >= 3)) if (new RegExp(`(?<![\\p{L}])${norm(part)}(?![\\p{L}])`, "u").test(t)) hits.push(`name "${part}"`);
  if (EMAIL.test(text)) hits.push("an email address");
  if (PHONE.test(text)) hits.push("a phone number");
  if (/linkedin/i.test(text)) hits.push("a LinkedIn link");
  for (const e of who.employers.filter((x) => x.trim().length >= 3)) if (t.includes(norm(e))) hits.push(`employer "${e}"`);
  return [...new Set(hits)];
}

export const fieldsText = (f: SubmissionFields) => [f.headline, f.summary, ...f.key_skills, ...f.experience_highlights, f.rate, f.availability].join("\n");

export type SubmissionCheckContext = {
  candidateId: string;
  clientId: string;
  anonymized: boolean;
  fields: readonly string[]; // the template's fields: each must be filled
  rate: string; // the confirmed rate: the app puts it in, whatever the agent wrote
  sourceText: string; // profile + screening + pre-screen, as given to the agent
  who: { fullName: string; employers: string[] };
};

// Built per run: the checks need the candidate's source data.
export function submissionSchema(ctx: SubmissionCheckContext) {
  const source = norm(ctx.sourceText);
  const inSource = (term: string) => norm(term).split(/[\s/,()]+/).filter((w) => w.length >= 2).every((w) => source.includes(w));
  return submissionFieldsSchema
    .extend({ candidate_id: z.string(), highlight_sources: z.array(z.string()) })
    .transform((d): SubmissionData => ({ ...d, rate: ctx.rate, candidate_id: ctx.candidateId, client_id: ctx.clientId, anonymized: ctx.anonymized }))
    .superRefine((d, issue) => {
      const fail = (message: string) => issue.addIssue({ code: "custom", message });
      for (const f of ctx.fields) {
        const v = d[f as keyof SubmissionFields];
        if (Array.isArray(v) ? v.length === 0 : !v.trim()) fail(`The client's template needs "${f}": fill it in`);
      }
      const unknownSkills = d.key_skills.filter((s) => !inSource(s));
      if (unknownSkills.length) fail(`key_skills must come from the source data; not found: ${unknownSkills.join(", ")}`);
      if (d.highlight_sources.length !== d.experience_highlights.length) fail("Give exactly one highlight_sources quote per experience highlight");
      const unquoted = d.highlight_sources.filter((q) => !source.includes(norm(q)));
      if (unquoted.length) fail(`highlight_sources must be exact quotes from the source data; not found: ${unquoted.map((q) => `"${q}"`).join(", ")}`);
      // No invented numbers (years, team sizes, percentages): every number must appear in the source data.
      const claims = [d.headline, d.summary, ...d.key_skills, ...d.experience_highlights].join(" ");
      const numbers = [...new Set(claims.match(/\d+(?:[.,]\d+)?/g) ?? [])].filter((n) => !source.includes(n));
      if (numbers.length) fail(`These numbers are not in the source data: ${numbers.join(", ")}. Use only numbers from the source.`);
      if (ctx.anonymized) {
        const hits = identifyingDetails(fieldsText(d), ctx.who);
        if (hits.length) fail(`Anonymized profile contains ${hits.join(", ")}. Remove them (describe employers generically, e.g. "a US fintech").`);
      }
    });
}
