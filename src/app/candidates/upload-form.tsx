"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { icons } from "../icons";
import type { UploadResult } from "@/agents/cv-reader/workflow";

const muted = "text-stone-500";

type Status = "ready" | "waiting" | "reading" | "saved" | "failed";
type Item = { key: string; file: File; status: Status; message?: string };

const badge: Record<Status, { label: string; className: string }> = {
  ready: { label: "Ready", className: "bg-stone-100 text-stone-600" },
  waiting: { label: "Waiting", className: "bg-stone-100 text-stone-600" },
  reading: { label: "Reading…", className: "animate-pulse bg-amber-100 text-amber-800" },
  saved: { label: "Saved", className: "bg-ink text-brand" },
  failed: { label: "Not saved", className: "bg-rose-100 text-rose-800" },
};

const sizeOf = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// Candidates page (docs/specs/15-cv-upload.md): pick or drop PDF CVs (choosing again adds to the list), remove any with ✕,
// then Upload. The whole lime banner is the drop box. Files go to ./upload one per request, `concurrency` at a time; each row shows its own progress.
// Wrong type, too big, already in the list or over the limit is said right away, before anything is sent.
export function UploadForm({ maxFiles, maxMb, concurrency }: { maxFiles: number; maxMb: number; concurrency: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [over, setOver] = useState(false);

  const busy = items.some((i) => i.status === "waiting" || i.status === "reading");
  const ready = items.filter((i) => i.status === "ready");
  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  function add(files: FileList | null) {
    if (busy || !files?.length) return;
    // Finished rows from the last upload make room for the new picks.
    const list = items.filter((i) => i.status === "ready");
    const notes: string[] = [];
    const left: string[] = [];
    for (const file of Array.from(files)) {
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (!file.name.toLowerCase().endsWith(".pdf")) notes.push(`${file.name}: not a PDF, left out.`);
      else if (file.size > maxMb * 1024 * 1024) notes.push(`${file.name}: too big (max ${maxMb} MB), left out.`);
      else if (list.some((i) => i.key === key)) notes.push(`${file.name}: already in the list.`);
      else if (list.length >= maxFiles) left.push(file.name);
      else list.push({ key, file, status: "ready" });
    }
    if (left.length) notes.push(`Up to ${maxFiles} PDFs per upload, so ${left.join(", ")} ${left.length === 1 ? "was" : "were"} left out. Upload ${left.length === 1 ? "it" : "them"} next.`);
    setItems(list);
    setWarnings(notes);
  }

  async function uploadOne(item: Item) {
    update(item.key, { status: "reading" });
    try {
      const body = new FormData();
      body.append("cv", item.file);
      const res = await fetch("/candidates/upload", { method: "POST", body });
      const r = (await res.json()) as UploadResult;
      update(item.key, { status: r.ok ? "saved" : "failed", message: r.message });
    } catch (e) {
      update(item.key, { status: "failed", message: `Upload failed: ${e instanceof Error ? e.message : String(e)}` });
    }
    router.refresh(); // the candidate list below picks up each saved CV as it lands
  }

  async function upload() {
    const queue = [...ready];
    if (!queue.length) return;
    setWarnings([]);
    setItems((list) => list.map((i) => (i.status === "ready" ? { ...i, status: "waiting" } : i)));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await uploadOne(next);
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  }

  const saved = items.filter((i) => i.status === "saved").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const pending = items.filter((i) => i.status === "waiting" || i.status === "reading").length;
  const title = busy
    ? `Reading ${pending} CV${pending === 1 ? "" : "s"}…`
    : ready.length
      ? `${ready.length} CV${ready.length === 1 ? "" : "s"} ready to upload.`
      : saved || failed
        ? `Saved ${saved} of ${saved + failed} CV${saved + failed === 1 ? "" : "s"}.`
        : "Grow the pool with your own CVs.";
  const text = busy
    ? "Claude Haiku reads each PDF, about 15 seconds each. They appear in the list below as they land."
    : ready.length
      ? `Upload to read them, or drop more (up to ${maxFiles}). Claude Haiku reads each PDF for about $0.01–0.02, shown on Runs.`
      : `Drop up to ${maxFiles} PDFs on this box. The CV reader saves each one and it joins the next sourcing run. ${maxMb} MB each; scans work too.`;
  const choose = (dark: boolean) => (
    <label
      className={`inline-flex items-center gap-3 rounded-xl border px-7 py-4 text-lg font-semibold whitespace-nowrap ${busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${dark ? "border-ink bg-ink text-white hover:bg-black" : "border-ink/30 text-ink hover:bg-white/40"}`}
    >
      {icons.upload} {ready.length ? "Add more" : "Choose PDFs"}
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        disabled={busy}
        className="sr-only"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = ""; // so choosing the same file again still counts as a change
        }}
      />
    </label>
  );

  // The lime "next useful thing" banner is the drop box: drop PDFs anywhere on it, or choose them with the button.
  return (
    <section
      aria-label="Upload CVs"
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        add(e.dataTransfer.files);
      }}
      className={`rounded-md bg-brand px-6 py-8 text-ink transition-shadow sm:px-12 sm:py-12 ${over ? "ring-4 ring-ink ring-offset-4 ring-offset-page" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-6">
        <div className="min-w-0 flex-[1_1_360px]">
          <div className="text-xs font-semibold tracking-[0.25em] uppercase sm:text-sm">{over ? "Drop to add" : "The next useful thing"}</div>
          <p className="mt-4 text-2xl tracking-tight sm:text-4xl">{title}</p>
          <p className="mt-4 text-base">{text}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {ready.length > 0 && !busy && choose(false)}
          {ready.length > 0 || busy ? (
            <button
              type="button"
              onClick={upload}
              disabled={busy}
              className="inline-flex items-center gap-3 rounded-xl border border-ink bg-ink px-7 py-4 text-lg font-semibold whitespace-nowrap text-white hover:not-disabled:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Reading CVs…" : `Upload ${ready.length} CV${ready.length === 1 ? "" : "s"}`}
            </button>
          ) : (
            choose(true)
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="mt-6 flex flex-col gap-1.5 text-sm">
          {warnings.map((w, i) => (
            <li key={i} className="rounded-lg bg-white/70 px-4 py-2 text-amber-900">
              {w}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <ul className="mt-6 flex flex-col gap-2 text-sm">
          {items.map((i) => (
            <li key={i.key} className="flex items-start gap-3 rounded-lg bg-white/70 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate font-semibold">{i.file.name}</span>
                  <span className={muted}>{sizeOf(i.file.size)}</span>
                </div>
                {i.message && <div className={`mt-0.5 ${i.status === "failed" ? "text-rose-800" : muted}`}>{i.message}</div>}
              </div>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${badge[i.status].className}`}>{badge[i.status].label}</span>
              {(i.status === "ready" || (!busy && (i.status === "saved" || i.status === "failed"))) && (
                <button
                  type="button"
                  onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}
                  className="-my-1 shrink-0 rounded-md p-1 text-stone-500 hover:bg-white hover:text-stone-800"
                  aria-label={`Remove ${i.file.name}`}
                  title="Remove from the list"
                >
                  {icons.x}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
