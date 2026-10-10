-- CreateTable
CREATE TABLE "cv_uploads" (
    "candidateId" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "pdf" BLOB NOT NULL,
    "agentRunId" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "cv_uploads_sha256_key" ON "cv_uploads"("sha256");
