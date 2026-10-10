import { NextResponse, type NextRequest } from "next/server";
import { saveConnection } from "@/agents/tools/google-auth";

// Google sends the browser back here after sign-in (GOOGLE_REDIRECT_URI). Saves the login, returns to the Briefs page
// with a message in the URL (?gmail=...).
export async function GET(req: NextRequest) {
  const back = (msg: string) => {
    const url = new URL("/", req.url);
    url.searchParams.set("gmail", msg);
    const res = NextResponse.redirect(url);
    res.cookies.delete("google_oauth_state");
    return res;
  };
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return back(`Google sign-in cancelled (${p.get("error")}).`);
  const state = req.cookies.get("google_oauth_state")?.value;
  if (!state || state !== p.get("state")) return back("Sign-in check failed. Click Connect Gmail again.");
  try {
    const email = await saveConnection(p.get("code") ?? "");
    return back(`Connected as ${email}.`);
  } catch (e) {
    console.error("Google callback failed:", e);
    return back(`Couldn't connect: ${e instanceof Error ? e.message : String(e)}`);
  }
}
