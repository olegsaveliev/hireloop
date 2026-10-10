import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { connectUrl } from "@/agents/tools/google-auth";

// "Connect Gmail": send the browser to Google's sign-in page. The random `state` (also kept in a short-lived cookie)
// proves the callback answers a sign-in this app started.
export async function GET() {
  const state = randomUUID();
  const res = NextResponse.redirect(connectUrl(state));
  res.cookies.set("google_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
