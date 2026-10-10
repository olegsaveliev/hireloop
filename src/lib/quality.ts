// Quality per agent for the Runs page (docs/specs/10-langfuse-polish.md, part 6), from the app's own database.
// Same rules as the Langfuse scores the app sends, so recruiters see the numbers without a Langfuse login.
import { db } from "@/lib/db";

export type QualityRow = { agent: string; measure: string; value: number | null; n: number; unit: string };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function qualityPerAgent(): Promise<QualityRow[]> {
  // job-spec-agent, approved_without_edits: 1 if approved with 0 fields edited, 0 if edited or rejected.
  const specs = await db.jobSpec.findMany({ where: { status: { in: ["approved", "rejected"] } }, select: { status: true, fieldsEdited: true } });
  const specValues = specs.map((s) => (s.status === "approved" && s.fieldsEdited === 0 ? 1 : 0));

  // outreach-draft, approved_without_edits: sent exactly as the agent wrote it = 1; sent edited or rejected = 0.
  const drafts = await db.message.findMany({
    where: { direction: "outbound", status: { in: ["sent", "rejected"] } },
    select: { status: true, subject: true, body: true, agentDraft: true },
  });
  const draftValues = drafts
    .filter((d) => d.agentDraft) // only drafts the agent wrote
    .map((d) => {
      const a = d.agentDraft as { subject: string; body: string };
      return d.status === "sent" && a.subject === d.subject && a.body.trim() === d.body.trim() ? 1 : 0;
    });

  // screening-agent, recruiter_agreement: one value per shortlist approval (job).
  const jobs = await db.job.findMany({ where: { recruiterAgreement: { not: null } }, select: { recruiterAgreement: true } });
  const agreement = jobs.map((j) => j.recruiterAgreement!);

  // reply-classifier, classifier_correct: the recruiter's Correct / Wrong clicks.
  const replies = await db.message.findMany({ where: { direction: "inbound", classifierCorrect: { not: null } }, select: { classifierCorrect: true } });
  const correct = replies.map((r) => (r.classifierCorrect ? 1 : 0));

  return [
    { agent: "job-spec-agent", measure: "Approved without edits", value: avg(specValues), n: specValues.length, unit: "specs decided" },
    { agent: "screening-agent", measure: "Recruiter agreement (top 10 kept)", value: avg(agreement), n: agreement.length, unit: "shortlists" },
    { agent: "outreach-draft", measure: "Approved without edits", value: avg(draftValues), n: draftValues.length, unit: "drafts decided" },
    { agent: "reply-classifier", measure: "Classification correct", value: avg(correct), n: correct.length, unit: "replies reviewed" },
  ];
}
