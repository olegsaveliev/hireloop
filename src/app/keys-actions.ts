"use server";

import { KEYS, removeKeys, saveKeys, type KeyGroup } from "@/lib/settings";
import { asState, type ActionState } from "./action-state";

// Keys menu (bring your own key): save, remove. See src/lib/settings.ts.

export async function saveKeysAction(group: KeyGroup, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = Object.fromEntries(KEYS.filter((k) => k.group === group).map((k) => [k.name, String(formData.get(k.name) ?? "")]));
  return asState(() => saveKeys(group, values));
}

export async function removeKeysAction(group: KeyGroup): Promise<ActionState> {
  return asState(async () => {
    await removeKeys(group);
    return { ok: true, message: "Removed from the app. Values in .env.local, if any, apply again." };
  });
}
