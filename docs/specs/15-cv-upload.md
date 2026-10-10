# CV upload: CV reader (added 2026-10-10)

## Purpose
Let a recruiter add real candidates by uploading PDF CVs, so the candidate pool is the mock seed candidates plus
uploaded ones, and sourcing finds both.

## Trigger
**Upload** on the Candidates page (`/candidates`, left menu after Jobs), with 1-5 PDFs chosen or dropped.

How the upload box works (changed 2026-10-10):
- Chosen or dropped files go into a list; choosing again adds to it (finished rows from the last upload are cleared).
  Each waiting file has an ✕ to take it out before uploading.
- Checked in the browser as soon as files are picked, before anything is sent: not a PDF, over 5 MB, already in the
  list, or more than 5 in the list → that file is left out with a note saying why (the server checks again).
- **Upload** sends each file on its own (`POST /candidates/upload`, one PDF per request), 3 at the same time
  (`CV_READER_CONCURRENCY`); each row shows Waiting → Reading… → Saved / Not saved with its own message, and the
  candidate list refreshes as each one is saved. A route, not a server action: Next.js runs a page's server actions
  one at a time, so they couldn't read 3 CVs at once.

## Inputs
- The PDF file (max 5 MB each, up to 5 per upload; `CV_MAX_FILE_MB` / `CV_MAX_FILES_PER_UPLOAD` in `src/config/budgets.ts`).
- Sent to the model as a PDF document block, so text PDFs and scans both work.

## Output
```json
{
  "readable": "boolean",
  "full_name": "string | null",
  "language": "en | uk | pl | other",
  "profile_text": "string",
  "problem": "string | null"
}
```
Saved by the app (the agent saves nothing):
- `candidates` row: next free id `cand-NNN` (seed is cand-001 ... cand-060), `source: "pdf_upload"` (seed CVs already use
  `cv_upload`), `language`, `fullName`, `rawProfile` = `profile_text`.
- `cv_uploads` row: the original PDF (in the database, not on disk), file name, size, SHA-256, agent run id.

## Model
Haiku, thinking off. Transcription, not judgment.

## Tools
None. The PDF goes straight into the prompt.

## Agent steps
1. Read the PDF.
2. Write the CV out as plain text in its original language, same order and headings; contacts kept.
3. Leave out protected attributes.
4. Return the name as written (or null) and the language.
5. If it isn't a CV or has no readable text: `readable: false` with the reason.

## Human approval
None. The recruiter is on the page and sees each file's result right away. Uploaded candidates then go through
the normal flow (sourcing, enrichment, screening, shortlist approval ...).

## Guardrails
- Never invent anything not in the PDF. No name in the CV → the candidate is called "Unknown (<file name>)".
- Never keep protected attributes in the text (date of birth/age, gender, family status, children, religion, health,
  nationality/citizenship, photo).
- The CV's real email is kept as written (your choice, 2026-10-10). Outreach can't email it: the Gmail allow-list
  only sends to test inbox addresses, so a draft for an uploaded candidate stops with "Can't be sent from the app".

## Edge cases
- Not a PDF (name or file header), or over 5 MB: refused before any AI run.
- Same file uploaded again (same SHA-256): refused before any AI run ("Already uploaded (cand-NNN)"). If the same
  file is sent twice at the same moment, both are read but only one is saved; the other says "Already uploaded".
- Two CVs saved at the same moment never share an id: a clash on `cand-NNN` is retried with the next free id.
- Same person as an existing candidate (same email, or same name when there is no email): saved, with a note;
  sourcing already treats them as one person (`personKey`).
- Not a CV (e.g. an invoice): not saved, the reason is shown.
- **Delete** (bin on an uploaded CV) removes the candidate, the PDF and the enriched profile. Refused while the
  candidate is in any job's pipeline. Mock candidates can't be deleted.
- `npm run db:reset` rebuilds the database from seed data, so uploaded CVs are lost; upload them again.

## Cost budget
- Budget: $0.02 per CV
- Max agent turns: 2
- Rationale: a 2-page CV is ~5k input and ~2k output tokens on Haiku. First test runs: ~$0.004 per (one-page) CV.
- Over budget (above 1x): run completes, gets flagged on the Runs page and tagged `over-budget` in Langfuse.
- Runaway (above 3x or max turns hit): run is stopped, nothing is saved, item goes to the approval queue with
  "Stopped: over budget" (Step 3, buttons Dismiss and Candidates page; upload the file again to retry).
- These are starting guesses. After the first 10 real runs, set the budget to about 1.5x the median actual cost.
- Not part of any job's budget (uploads aren't tied to a job).

## Langfuse tracing
- Trace name: `cv-reader`
- Tags: `cv-upload`
- Metadata: `file_name`
- Scores: `cost_vs_budget`

## Acceptance criteria
- [x] Candidates page lists all candidates, uploaded first with an "Uploaded" tag; filters All / Uploaded / Mock.
- [x] Upload 1-5 PDFs by drop or file picker; each file shows its own result.
- [x] Picking again adds to the list; ✕ removes a file; wrong type / too big / duplicate / over 5 is said right away.
- [x] Each file shows its own progress (Waiting, Reading…, Saved / Not saved); 3 are read at the same time.
- [x] Uploaded candidate is a normal `candidates` row that sourcing searches and enrichment reads.
- [x] Original PDF stored in the database and opens from the PDF button; the saved text is viewable.
- [x] Every run logged in `agent_runs` with trace link and budget; over-budget rules apply.
- [x] Delete works, and is refused while the candidate is in a job.

## Test cases
`npm run test:cv-upload` (about $0.02):
1. English CV with birth date and family status → saved, name as written, `pdf_upload`, `en`, email and jobs kept,
   birth date and family left out, PDF kept.
2. Polish CV → `pl`, text not translated.
3. An invoice PDF → not saved.
4. The same file again → refused, no AI run.
5. A text file named .pdf → refused, no AI run.
