// CV upload (docs/specs/15-cv-upload.md): uploaded PDFs -> CV reader (Haiku) -> new `candidates` rows (source "pdf_upload"; seed CVs use "cv_upload")
// that sourcing finds like any other candidate. The original PDF is kept in `cv_uploads`.
import { createHash } from "node:crypto";
import { CV_MAX_FILE_MB, CV_MAX_FILES_PER_UPLOAD, CV_READER_CONCURRENCY } from "@/config/budgets";
import { emailOf, personKey } from "@/lib/candidates";
import { db } from "@/lib/db";
import { pool } from "../pipeline/shared";
import { runCvReader } from "./agent";

export type UploadFile = { name: string; bytes: Buffer };
export type UploadResult = { fileName: string; ok: boolean; message: string; candidateId?: string };

const STEP = 3; // feeds the candidate pool that Steps 2-3 work on

// Next free "cand-NNN" (seed candidates are cand-001 ... cand-060).
async function nextCandidateId(): Promise<string> {
  const ids = await db.candidate.findMany({ where: { id: { startsWith: "cand-" } }, select: { id: true } });
  const max = Math.max(0, ...ids.map((c) => Number(c.id.slice(5))).filter(Number.isFinite));
  return `cand-${String(max + 1).padStart(3, "0")}`;
}

// The Candidates page sends files side by side (one request per file), so two saves can pick the same next id, or
// the same file can arrive twice. A clash on the id -> try again with a fresh id; the same file -> "already uploaded".
async function saveCandidate(c: { fullName: string; language: string; rawProfile: string; file: UploadFile; sha256: string; agentRunId?: string }): Promise<{ id: string } | { duplicateOf: string }> {
  for (let attempt = 1; ; attempt++) {
    const id = await nextCandidateId();
    try {
      await db.$transaction([
        db.candidate.create({ data: { id, fullName: c.fullName, source: "pdf_upload", language: c.language, rawProfile: c.rawProfile } }),
        db.cvUpload.create({ data: { candidateId: id, fileName: c.file.name, sizeBytes: c.file.bytes.length, sha256: c.sha256, pdf: new Uint8Array(c.file.bytes), agentRunId: c.agentRunId } }),
      ]);
      return { id };
    } catch (e) {
      const twin = await db.cvUpload.findUnique({ where: { sha256: c.sha256 }, select: { candidateId: true } });
      if (twin) return { duplicateOf: twin.candidateId };
      if (attempt >= 5) throw e;
    }
  }
}

// File checks before any AI runs (nothing is spent on a file that would be refused).
function checkFile(f: UploadFile): string | null {
  if (!f.name.toLowerCase().endsWith(".pdf") || f.bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return "Not a PDF file.";
  if (f.bytes.length > CV_MAX_FILE_MB * 1024 * 1024) return `Too big (max ${CV_MAX_FILE_MB} MB).`;
  return null;
}

export async function uploadCvs(files: UploadFile[], opts: { extraTags?: string[] } = {}): Promise<UploadResult[]> {
  if (files.length === 0) return [{ fileName: "", ok: false, message: "Choose at least one PDF." }];
  if (files.length > CV_MAX_FILES_PER_UPLOAD) return [{ fileName: "", ok: false, message: `Up to ${CV_MAX_FILES_PER_UPLOAD} PDFs at a time.` }];

  const results = new Map<UploadFile, UploadResult>();
  const toRead: { file: UploadFile; sha256: string }[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const problem = checkFile(file);
    if (problem) {
      results.set(file, { fileName: file.name, ok: false, message: problem });
      continue;
    }
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    const existing = seen.has(sha256) ? null : await db.cvUpload.findUnique({ where: { sha256 }, select: { candidateId: true } });
    if (seen.has(sha256) || existing) {
      results.set(file, { fileName: file.name, ok: false, message: `Already uploaded${existing ? ` (${existing.candidateId})` : ""}.` });
      continue;
    }
    seen.add(sha256);
    toRead.push({ file, sha256 });
  }

  // The AI runs go in parallel; saving goes one by one afterwards so candidate ids don't clash.
  const read = new Map<UploadFile, Awaited<ReturnType<typeof runCvReader>>>();
  await pool(toRead, CV_READER_CONCURRENCY, async ({ file }) => {
    read.set(file, await runCvReader({ pdfBase64: file.bytes.toString("base64"), fileName: file.name, extraTags: opts.extraTags }));
  });

  for (const { file, sha256 } of toRead) {
    const { data, runs, error } = read.get(file)!;
    const last = runs[runs.length - 1];
    if (!data) {
      // Over 3x budget: nothing saved, one item in the approval queue (CLAUDE.md cost rules). A plain failure is
      // only shown on the page: the recruiter is right there and can upload again.
      if (runs.some((r) => r.status === "stopped_over_budget")) {
        await db.approvalItem.create({
          data: {
            kind: "stopped_run",
            step: STEP,
            status: "awaiting_approval",
            title: "Stopped: over budget",
            detail: `CV upload “${file.name}”. The CV reader went above 3x its budget; nothing was saved. Upload the file again to retry.`,
            agentRunId: last?.runId,
          },
        });
        results.set(file, { fileName: file.name, ok: false, message: "Stopped: over budget. Nothing saved (see Approval queue)." });
      } else results.set(file, { fileName: file.name, ok: false, message: `Couldn't read it: ${error ?? "unknown error"}.` });
      continue;
    }
    if (!data.readable || !data.profile_text.trim()) {
      results.set(file, { fileName: file.name, ok: false, message: `Not saved: ${data.problem ?? "no readable CV text."}` });
      continue;
    }

    // No name in the CV: label it by the file name (never a made-up name).
    const fullName = data.full_name?.trim() || `Unknown (${file.name.replace(/\.pdf$/i, "")})`;
    const rawProfile = data.profile_text.trim();
    const key = personKey({ fullName, rawProfile });
    const twin = (await db.candidate.findMany({ select: { id: true, fullName: true, rawProfile: true } })).find((c) => personKey(c) === key);

    const saved = await saveCandidate({ fullName, language: data.language, rawProfile, file, sha256, agentRunId: last?.runId });
    if ("duplicateOf" in saved) {
      results.set(file, { fileName: file.name, ok: false, message: `Already uploaded (${saved.duplicateOf}).` });
      continue;
    }
    const { id } = saved;
    const notes = [
      !data.full_name && "no name found in the CV",
      !emailOf(rawProfile) && "no email in the CV",
      twin && `same ${key.startsWith("name:") ? "name" : "email"} as ${twin.id} (${twin.fullName}); sourcing treats them as one person`,
    ].filter(Boolean);
    results.set(file, { fileName: file.name, ok: true, candidateId: id, message: `Saved as ${id} · ${fullName}${notes.length ? ` (${notes.join("; ")})` : ""}.` });
  }

  return files.map((f) => results.get(f)!);
}

// Delete an uploaded CV completely: the candidate, the PDF and its enriched profile. Refused while the candidate is in
// a job's pipeline (their messages, screening and submissions point at them).
export async function deleteUploadedCv(candidateId: string): Promise<{ ok: boolean; message: string }> {
  const upload = await db.cvUpload.findUnique({ where: { candidateId }, select: { fileName: true } });
  if (!upload) return { ok: false, message: "Only uploaded CVs can be deleted." };
  const jobs = await db.pipelineEntry.count({ where: { candidateId } });
  if (jobs) return { ok: false, message: `In ${jobs} job${jobs === 1 ? "" : "s"}: can't delete.` };
  await db.$transaction([
    db.candidateProfile.deleteMany({ where: { candidateId } }),
    db.cvUpload.delete({ where: { candidateId } }),
    db.candidate.delete({ where: { id: candidateId } }),
  ]);
  return { ok: true, message: `Deleted ${upload.fileName}.` };
}
