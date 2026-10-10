import { connection } from "next/server";
import { KEYS, keyStatuses } from "@/lib/settings";
import { KeysMenu } from "./keys-menu";

// Left rail, bottom: the Keys menu (bring your own key). Only masked values reach the browser.
export async function KeysChip() {
  await connection();
  const statuses = await keyStatuses();
  const fields = KEYS.map(({ name, group, label, secret, required, placeholder }) => ({
    ...statuses.find((s) => s.name === name)!,
    group,
    label,
    secret,
    required: !!required,
    placeholder,
  }));
  return <KeysMenu fields={fields} redirectUri={process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/google/callback"} />;
}
