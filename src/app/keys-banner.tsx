import { connection } from "next/server";
import { anthropicReady } from "@/lib/settings";
import { OpenKeysButton } from "./open-keys-button";

// First run (bring your own key): until there is an Anthropic key, every page says where to add it.
export async function KeysBanner() {
  await connection();
  if (anthropicReady()) return null;
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
      <div>
        <div className="font-semibold text-amber-900">Add your Anthropic API key to start</div>
        <p className="text-sm text-amber-800">The agents run on your own key. Langfuse and Google are optional and can be added later.</p>
      </div>
      <OpenKeysButton />
    </div>
  );
}
