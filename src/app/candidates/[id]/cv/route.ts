import { db } from "@/lib/db";

// The original uploaded PDF, opened in the browser's own PDF viewer (docs/specs/15-cv-upload.md).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upload = await db.cvUpload.findUnique({ where: { candidateId: id } });
  if (!upload) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(upload.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(upload.fileName)}`,
    },
  });
}
