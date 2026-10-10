import { revalidatePath } from "next/cache";
import { uploadCvs, type UploadResult } from "@/agents/cv-reader/workflow";

// One PDF CV per request (docs/specs/15-cv-upload.md). The upload box sends up to 3 of these at the same time and shows
// each file's progress; a route, not a server action, because Next.js runs a page's server actions one at a time.
export async function POST(req: Request) {
  let result: UploadResult;
  try {
    const file = (await req.formData()).get("cv");
    if (!(file instanceof File) || file.size === 0) result = { fileName: "", ok: false, message: "Choose a PDF." };
    else [result] = await uploadCvs([{ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }]);
  } catch (e) {
    result = { fileName: "", ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  return Response.json(result);
}
