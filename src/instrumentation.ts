// Runs once when the Next.js server starts: copy keys saved in the app's Keys menu into process.env (src/lib/settings.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applyStoredSettings } = await import("@/lib/settings");
  await applyStoredSettings().catch((e) => console.warn("Couldn't load keys saved in the app:", e instanceof Error ? e.message : e));
}
