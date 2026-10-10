import { readFile } from "node:fs/promises";
import path from "node:path";

// Prompts live as plain files in /prompts so they can be read and edited without touching code.
export async function loadPrompt(name: string): Promise<string> {
  return readFile(path.join(process.cwd(), "prompts", `${name}.md`), "utf-8");
}
