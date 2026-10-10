// CV upload tests (docs/specs/15-cv-upload.md "Test cases" + "Acceptance criteria"). Hand-made PDFs (scripts/tests/make-test-pdf.ts)
// go straight into the upload workflow. Real runs: 3 Haiku CV-reader runs + 1 enrichment run, about $0.05.
//   1. English CV -> candidate saved (pdf_upload, name, email kept), protected attributes left out, PDF kept
//   2. Polish CV -> language "pl", text kept in Polish
//   3. An invoice PDF -> not saved ("not a CV")
//   4. Same file again -> refused before any AI run
//   5. Not a PDF -> refused before any AI run
// Plus: sourcing's search finds the uploaded candidate, enrichment works on it, delete is refused while the candidate
// is in a job and works once not. Everything the test creates is deleted at the end. Run with: npm run test:cv-upload
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("@/lib/db");
  const { uploadCvs, deleteUploadedCv } = await import("@/agents/cv-reader/workflow");
  const { runEnrichmentAgent } = await import("@/agents/enrichment/agent");
  const { makeTestPdf } = await import("./make-test-pdf");
  const { containsTerm } = await import("@/lib/candidates");

  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
  };
  const run = Date.now().toString(36);
  const created: string[] = [];
  const runsBefore = await db.agentRun.count({ where: { agent: "cv-reader" } });

  const english = makeTestPdf([
    `Taras Testenko ${run}`,
    "Senior Rust Engineer",
    "Lviv, Ukraine | taras.testenko@example.com | linkedin.com/in/taras-testenko",
    "Date of birth: 12.03.1991 | Married, two children",
    "",
    "Experience",
    "Senior Rust Engineer, Quantlabs (2021-03 - present): low-latency trading engine, Rust, Tokio, Kafka",
    "Backend Developer, SoftServe (2017-06 - 2021-02): Go, PostgreSQL, Kubernetes",
    "",
    "Skills: Rust, Go, Tokio, Kafka, PostgreSQL, Kubernetes. English: C1",
  ]);
  const polish = makeTestPdf([
    `Kasia Probna ${run}`,
    "Programistka Java",
    "Gdansk, Polska | kasia.probna@example.com",
    "",
    "Doswiadczenie zawodowe",
    "Programistka Java, Allegro (2019-01 - obecnie): mikroserwisy, Spring Boot, Kafka",
    "Umiejetnosci: Java, Spring Boot, Kafka, Docker. Jezyk angielski: B2",
  ]);
  const invoice = makeTestPdf([`INVOICE no. ${run}`, "Office chairs x 4 .......... 1,200.00 EUR", "VAT 23% ........ 276.00 EUR", "Total due: 1,476.00 EUR", "Pay by bank transfer within 14 days."]);

  try {
    console.log("\n--- Upload (3 Haiku runs) ---");
    const [r1, r2, r3, r4, r5] = await uploadCvs(
      [
        { name: "taras-cv.pdf", bytes: english },
        { name: "kasia-cv.pdf", bytes: polish },
        { name: "invoice.pdf", bytes: invoice },
        { name: "taras-cv-copy.pdf", bytes: english },
        { name: "notes.pdf", bytes: Buffer.from("just some text, not a pdf") },
      ],
      { extraTags: ["test"] },
    );
    for (const r of [r1, r2]) if (r.candidateId) created.push(r.candidateId);

    // 1. English CV
    check("1. English CV saved", r1.ok && !!r1.candidateId, r1.message);
    const taras = r1.candidateId ? await db.candidate.findUnique({ where: { id: r1.candidateId } }) : null;
    check("1. name as written", !!taras?.fullName.startsWith("Taras Testenko"), taras?.fullName);
    check("1. source pdf_upload, language en", taras?.source === "pdf_upload" && taras.language === "en", `${taras?.source} ${taras?.language}`);
    check("1. real email kept in the text", !!taras?.rawProfile.includes("taras.testenko@example.com"));
    check("1. jobs and dates kept", !!taras && /Quantlabs/.test(taras.rawProfile) && /2017/.test(taras.rawProfile));
    check("1. protected attributes left out (birth date, family)", !!taras && !/1991|married|children/i.test(taras.rawProfile), taras?.rawProfile.slice(0, 400));
    const upload = r1.candidateId ? await db.cvUpload.findUnique({ where: { candidateId: r1.candidateId } }) : null;
    check("1. original PDF kept in the database", !!upload && Buffer.from(upload.pdf).equals(english) && upload.fileName === "taras-cv.pdf");

    // 2. Polish CV
    check("2. Polish CV saved", r2.ok, r2.message);
    const kasia = r2.candidateId ? await db.candidate.findUnique({ where: { id: r2.candidateId } }) : null;
    check("2. language pl, text not translated", kasia?.language === "pl" && /Doswiadczenie|Umiejetnosci/.test(kasia.rawProfile), kasia?.language);

    // 3-5. Refused
    check("3. invoice not saved", !r3.ok && !r3.candidateId, r3.message);
    check("4. same file again refused", !r4.ok && /Already uploaded/.test(r4.message), r4.message);
    check("5. not a PDF refused", !r5.ok && /Not a PDF/.test(r5.message), r5.message);
    const runsAfter = await db.agentRun.count({ where: { agent: "cv-reader" } });
    check("4-5. no AI run for refused files (3 runs, or more only for a schema retry)", runsAfter - runsBefore >= 3 && runsAfter - runsBefore <= 6, `${runsAfter - runsBefore} runs`);
    const lastRun = await db.agentRun.findFirst({ where: { agent: "cv-reader" }, orderBy: { createdAt: "desc" } });
    check("Run logged with trace and budget", !!lastRun?.traceId && lastRun.budgetUsd > 0, `$${lastRun?.costUsd.toFixed(4)} of $${lastRun?.budgetUsd}`);

    if (taras) {
      console.log("\n--- Joins the pool ---");
      check("Sourcing search would find it (Rust + Lviv)", containsTerm(taras.rawProfile, "Rust") && containsTerm(taras.rawProfile, "Lviv"));
      const e = await runEnrichmentAgent({ candidateId: taras.id, extraTags: ["test"] });
      check("Enrichment reads it", !!e.data && e.data.skills.includes("Rust") && e.data.contacts.email === "taras.testenko@example.com", e.error ?? "");

      console.log("\n--- Delete ---");
      // A throwaway "[test]" job on any existing brief (npm run cleanup:test removes it if this test is stopped).
      // No briefs at all (e.g. after clearing the demo data): a throwaway client and brief, deleted below.
      let temp: { clientId: string; briefId: string } | null = null;
      let brief = await db.clientBrief.findFirst({ select: { id: true, clientId: true } });
      if (!brief) {
        temp = { clientId: `client-test-${run}`, briefId: `brief-test-${run}` };
        await db.client.create({ data: { id: temp.clientId, name: "[test] client", country: "PL", timezone: "Europe/Warsaw" } });
        brief = await db.clientBrief.create({
          data: { id: temp.briefId, clientId: temp.clientId, fromName: "Test", fromEmail: "test@example.com", subject: `[test] cv upload ${run}`, body: "test", receivedAt: new Date() },
          select: { id: true, clientId: true },
        });
      }
      const spec = await db.jobSpec.create({ data: { briefId: brief.id, clientId: brief.clientId, status: "approved", agentDraft: {}, spec: {}, agentRunIds: [] } });
      const job = await db.job.create({ data: { jobSpecId: spec.id, clientId: brief.clientId, title: `[test] cv upload ${run}`, status: "sourcing" } });
      try {
        await db.pipelineEntry.create({ data: { jobId: job.id, candidateId: taras.id, stage: "sourced", matchedOn: [] } });
        const refused = await deleteUploadedCv(taras.id);
        check("Delete refused while in a job", !refused.ok && /can't delete/.test(refused.message), refused.message);
      } finally {
        await db.job.delete({ where: { id: job.id } }); // pipeline entry goes with it
        await db.jobSpec.delete({ where: { id: spec.id } });
        if (temp) {
          await db.clientBrief.delete({ where: { id: temp.briefId } });
          await db.client.delete({ where: { id: temp.clientId } });
        }
      }
      const mock = await deleteUploadedCv("cand-001");
      check("Mock candidates can't be deleted", !mock.ok);
      const del = await deleteUploadedCv(taras.id);
      const gone = !(await db.candidate.findUnique({ where: { id: taras.id } })) && !(await db.cvUpload.findUnique({ where: { candidateId: taras.id } })) && !(await db.candidateProfile.findUnique({ where: { candidateId: taras.id } }));
      check("Delete removes candidate, PDF and profile", del.ok && gone, del.message);
    }
  } finally {
    for (const id of created) await deleteUploadedCv(id);
    await db.$disconnect();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
}
main();
