// Bring your own key: keys typed in the app's Keys menu (left rail) are saved in the local database and copied into
// process.env, so the rest of the code keeps reading process.env as before. A key saved in the app wins over the
// same name in .env.local; removing it in the app falls back to .env.local. Full values never go to the browser.
import { db } from "@/lib/db";

export type KeyGroup = "anthropic" | "langfuse" | "google";

export type KeyDef = {
  name: string; // environment variable name
  group: KeyGroup;
  label: string;
  secret: boolean; // shown only as "…last 4"
  required?: boolean;
  placeholder: string;
  check?: (v: string) => string | null; // error message, or null when the value looks right
};

const startsWith = (prefix: string, what: string) => (v: string) => (v.startsWith(prefix) ? null : `${what} starts with "${prefix}".`);
const emailList = (v: string) => {
  const bad = v.split(",").map((s) => s.trim()).filter((s) => s && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  return bad.length ? `Not an email address: ${bad.join(", ")}` : null;
};

export const KEYS: KeyDef[] = [
  { name: "ANTHROPIC_API_KEY", group: "anthropic", label: "API key", secret: true, required: true, placeholder: "sk-ant-…", check: startsWith("sk-ant-", "An Anthropic API key") },
  { name: "LANGFUSE_PUBLIC_KEY", group: "langfuse", label: "Public key", secret: true, placeholder: "pk-lf-…", check: startsWith("pk-lf-", "A Langfuse public key") },
  { name: "LANGFUSE_SECRET_KEY", group: "langfuse", label: "Secret key", secret: true, placeholder: "sk-lf-…", check: startsWith("sk-lf-", "A Langfuse secret key") },
  { name: "LANGFUSE_BASE_URL", group: "langfuse", label: "Region URL", secret: false, placeholder: "https://cloud.langfuse.com", check: startsWith("https://", "The URL") },
  {
    name: "GOOGLE_CLIENT_ID",
    group: "google",
    label: "OAuth client ID",
    secret: true,
    placeholder: "…apps.googleusercontent.com",
    check: (v) => (v.endsWith(".apps.googleusercontent.com") ? null : 'A Google client ID ends with ".apps.googleusercontent.com".'),
  },
  { name: "GOOGLE_CLIENT_SECRET", group: "google", label: "OAuth client secret", secret: true, placeholder: "GOCSPX-…" },
  { name: "GOOGLE_TEST_INBOX", group: "google", label: "Test inbox", secret: false, placeholder: "you.test@gmail.com", check: emailList },
  { name: "GOOGLE_SEND_ALLOWLIST", group: "google", label: "Also allowed to send to", secret: false, placeholder: "a@x.com, b@y.com (optional)", check: emailList },
];

export const LANGFUSE_DEFAULT_URL = "https://cloud.langfuse.com";

// What .env.local had when the server started, so removing a key in the app can fall back to it.
const g = globalThis as unknown as { hireloopEnvBase?: Record<string, string | undefined> };
function envBase() {
  g.hireloopEnvBase ??= Object.fromEntries(KEYS.map((k) => [k.name, process.env[k.name] || undefined]));
  return g.hireloopEnvBase;
}

// Copy saved keys into process.env. Called at server start (src/instrumentation.ts), after every save, and before
// every agent run (so terminal scripts see keys saved in the app too). One small SQLite read.
export async function applyStoredSettings() {
  const base = envBase();
  const rows = await db.setting.findMany();
  for (const k of KEYS) {
    const v = rows.find((r) => r.key === k.name)?.value || base[k.name];
    if (v) process.env[k.name] = v;
    else delete process.env[k.name];
  }
}

export type KeyStatus = { name: string; set: boolean; source: "app" | "env" | null; shown: string };

const mask = (v: string) => `•••• ${v.slice(-4)}`;

// For the Keys menu: whether each key is set and where from. Secrets only as their last 4 characters.
export async function keyStatuses(): Promise<KeyStatus[]> {
  const base = envBase();
  const rows = await db.setting.findMany();
  return KEYS.map((k) => {
    const saved = rows.find((r) => r.key === k.name)?.value;
    const v = saved || base[k.name] || "";
    return { name: k.name, set: !!v, source: saved ? "app" : v ? "env" : null, shown: !v ? "" : k.secret ? mask(v) : v };
  });
}

export const anthropicReady = () => !!process.env.ANTHROPIC_API_KEY;
export const langfuseReady = () => !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
export const googleReady = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// Save one group of the Keys menu. Empty fields keep what is there (so a saved secret needn't be typed again).
export async function saveKeys(group: KeyGroup, values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const defs = KEYS.filter((k) => k.group === group);
  const changes = defs.map((k) => ({ k, v: (values[k.name] ?? "").trim() })).filter((x) => x.v);
  for (const { k, v } of changes) {
    const err = k.check?.(v);
    if (err) return { ok: false, message: err };
  }
  if (!changes.length) return { ok: false, message: "Nothing to save: type a new value first." };
  for (const { k, v } of changes) await db.setting.upsert({ where: { key: k.name }, create: { key: k.name, value: v }, update: { value: v } });
  await applyStoredSettings();
  const check = await checkGroup(group);
  return { ok: check.ok, message: check.ok ? `Saved. ${check.message}` : `Saved, but ${check.message}` };
}

// Remove a group's keys saved in the app (.env.local values, if any, apply again).
export async function removeKeys(group: KeyGroup) {
  await db.setting.deleteMany({ where: { key: { in: KEYS.filter((k) => k.group === group).map((k) => k.name) } } });
  await applyStoredSettings();
}

// A free check that the keys work. Anthropic: list models. Langfuse: read the project. Google can only be checked by
// signing in, which "Connect Gmail" does.
export async function checkGroup(group: KeyGroup): Promise<{ ok: boolean; message: string }> {
  try {
    if (group === "anthropic") {
      if (!anthropicReady()) return { ok: false, message: "no Anthropic key is set." };
      const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      });
      return r.ok ? { ok: true, message: "Anthropic accepted the key." } : { ok: false, message: `Anthropic refused the key (HTTP ${r.status}).` };
    }
    if (group === "langfuse") {
      if (!langfuseReady()) return { ok: false, message: "both Langfuse keys are needed for tracing." };
      const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
      const r = await fetch(`${process.env.LANGFUSE_BASE_URL || LANGFUSE_DEFAULT_URL}/api/public/projects`, { headers: { Authorization: `Basic ${auth}` } });
      return r.ok ? { ok: true, message: "Langfuse accepted the keys." } : { ok: false, message: `Langfuse refused the keys (HTTP ${r.status}). Check the region URL too.` };
    }
    if (!googleReady()) return { ok: false, message: "both the client ID and the secret are needed before you can connect Gmail." };
    return { ok: true, message: "Now click Connect Gmail (mail icon) to sign in." };
  } catch (e) {
    return { ok: false, message: `the check couldn't reach the service (${e instanceof Error ? e.message : String(e)}).` };
  }
}
