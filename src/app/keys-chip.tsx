import { connection } from "next/server";
import { KEYS, keyStatuses, type KeyGroup } from "@/lib/settings";
import { KeysMenu, type KeyField } from "./keys-menu";

// The fields of some Keys groups with their status. Only masked values reach the browser.
export async function keyFields(groups: KeyGroup[]): Promise<KeyField[]> {
  const statuses = await keyStatuses();
  return KEYS.filter((k) => groups.includes(k.group)).map(({ name, group, label, secret, required, placeholder }) => ({
    ...statuses.find((s) => s.name === name)!,
    group,
    label,
    secret,
    required: !!required,
    placeholder,
  }));
}

// Left rail, bottom: the Keys menu (bring your own key) for Anthropic and Langfuse. Google is in the mail icon's menu.
export async function KeysChip() {
  await connection();
  return <KeysMenu fields={await keyFields(["anthropic", "langfuse"])} />;
}
