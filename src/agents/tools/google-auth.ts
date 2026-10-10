// The recruiter's Google login (docs/specs/11-gmail-inbound.md, "Connect Gmail").
// One account in the prototype. The refresh token is kept in the database (google_accounts), never on disk.
import { gmail } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";
import { GOOGLE_SCOPES } from "@/config/google";
import { db } from "@/lib/db";

const ACCOUNT_ID = "default";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Add your Google keys in the Keys menu (key icon, left rail).`);
  return v;
}

export function oauthClient() {
  return new OAuth2Client({
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/google/callback",
  });
}

// Google sign-in page. `prompt: consent` makes Google return a refresh token every time.
export function connectUrl(state: string) {
  return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES, state, include_granted_scopes: true });
}

// Callback: exchange the code for tokens, read the account's email address, save.
export async function saveConnection(code: string): Promise<string> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google didn't return a refresh token. Click Connect Gmail again.");
  const missing = GOOGLE_SCOPES.filter((s) => !(tokens.scope ?? "").split(" ").includes(s));
  if (missing.length) throw new Error(`Some permissions weren't granted (${missing.map((s) => s.split("/").pop()).join(", ")}). Click Connect Gmail again and tick every box.`);
  client.setCredentials(tokens);
  // The account's address comes from Gmail's profile (Google's token info only has it with the extra "email" scope).
  const profile = await gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
  const email = (profile.data.emailAddress ?? "").toLowerCase();
  if (!email) throw new Error("Couldn't read the Google account's email address.");
  const data = { email, refreshToken: tokens.refresh_token, scopes: tokens.scope ?? "", connectedAt: new Date(), lastError: null };
  await db.googleAccount.upsert({ where: { id: ACCOUNT_ID }, create: { id: ACCOUNT_ID, ...data }, update: data });
  return email;
}

export const getGoogleAccount = () => db.googleAccount.findUnique({ where: { id: ACCOUNT_ID } });

export class GoogleNotConnectedError extends Error {}

// A client that refreshes its access token by itself. Throws GoogleNotConnectedError when there's no login.
export async function authorizedClient() {
  const account = await getGoogleAccount();
  if (!account) throw new GoogleNotConnectedError("Gmail is not connected. Click Connect Gmail on the Briefs page.");
  if (account.lastError) throw new GoogleNotConnectedError(`Gmail login expired (${account.lastError}). Click Connect Gmail on the Briefs page.`);
  const client = oauthClient();
  client.setCredentials({ refresh_token: account.refreshToken });
  return { client, account };
}

// Google refuses an expired or revoked login with "invalid_grant" (testing-mode apps: after 7 days).
// Remember it, so the page shows "login expired" instead of failing on every click.
export async function withGoogle<T>(fn: (client: OAuth2Client, email: string) => Promise<T>): Promise<T> {
  const { client, account } = await authorizedClient();
  try {
    return await fn(client, account.email);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid_grant|invalid_token|Token has been expired or revoked/i.test(msg)) {
      await db.googleAccount.update({ where: { id: ACCOUNT_ID }, data: { lastError: "Google ended the login" } });
      throw new GoogleNotConnectedError("Gmail login expired: Google ends test-app logins after 7 days. Click Connect Gmail on the Briefs page.");
    }
    throw e;
  }
}

export async function disconnectGoogle() {
  const account = await getGoogleAccount();
  if (!account) return;
  await oauthClient().revokeToken(account.refreshToken).catch(() => undefined); // already revoked or expired: fine
  await db.googleAccount.delete({ where: { id: ACCOUNT_ID } });
}
