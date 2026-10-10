// Records the LinkedIn demo video: Playwright clicks through the real app and saves one clip per scene.
//
//   npm run video:record                 all scenes (live part first, then the finished Kestrel job)
//   npm run video:record -- 06 07        only these scenes (by number)
//   npm run video:record -- --headed     watch the browser while it records
//
// Point it at a throwaway copy of the app, not your working database (see PROGRESS.md, "LinkedIn demo video"):
//   DATABASE_URL=file:/path/to/copy/prisma/dev.db VIDEO_BASE_URL=http://localhost:3100 npm run video:record
//
// Live part (01-05): copies the Kestrel brief (brief-003) into a new brief and lets the real agents work on it:
// spec, sourcing, enrichment, screening, outreach drafts (~$0.30). It STOPS at the drafts: nothing is sent.
// Finished part (06-12): the real Kestrel job from the 2026-10-10 rehearsal (reply, pre-screen, submission, client
// reply, interview, hired, runs). Only reads pages there.
//
// Capture: Chrome's screencast at 2x pixels (2160x2700 JPEG frames), turned into a 30 fps video per scene. Sharper
// than Playwright's built-in recorder, so the edit can zoom in without blur.
//
// Output (not in git): video/raw/<scene>.mp4, video/raw/markers.json (when each scene's waits start and end, for
// speeding them up in the edit), video/raw/state.json (ids of the live brief/spec/job, so scenes can be re-run).
import { chromium, type BrowserContext, type CDPSession, type Locator, type Page } from "playwright";
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

config({ path: ".env.local" });

const BASE = process.env.VIDEO_BASE_URL ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "video", "raw");
const SIZE = { width: 1080, height: 1350 }; // 4:5, the tallest LinkedIn feed format
const SCALE = 2; // captured at 2160x2700
const ZOOM = 1.35; // the app drawn 1.35x bigger so text is readable on a phone

// The finished job from the rehearsal (Kestrel, Bohdan Petrenko hired).
const KESTREL = {
  sourceBriefId: "brief-003",
  jobId: "cmv1uysow000p51itxtitt396",
  submissionId: "cmv1xqdld002451ito4rd5z1f",
};

// What the recruiter "learned from the client" in the rehearsal, typed into the live spec.
const SPEC_ANSWERS = {
  title: "Senior Backend Developer (Kotlin)",
  must_have: "Strong backend development experience\nKotlin\nSpring Boot\nPostgreSQL\nKafka",
  nice_to_have: "Java\nHealthcare data / GDPR experience",
  location: "Remote, EU (CET overlap)",
  selling_points: "Healthcare product with real impact\nUrgent start, fast hiring process",
};

type State = { briefId?: string; specId?: string; jobId?: string };
type Marker = { scene: string; label: string; t: number };

const statePath = path.join(OUT, "state.json");
const markersPath = path.join(OUT, "markers.json");
const readJson = <T>(p: string, fallback: T): T => (fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : fallback);
let state: State = readJson<State>(statePath, {});
const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

// ---------- helpers ----------

// Look and feel inside the recorded page: zoom, no dev-only Next.js button, smooth scrolling, a visible cursor
// (headless Chrome draws none) with a lime ring on every click. Plain JavaScript text on purpose: tsx adds helpers to
// compiled functions that don't exist inside the browser page.
const pageSetup = (zoom: number) => `(() => {
  const style = \`
    html { zoom: ${zoom}; scroll-behavior: smooth; }
    nextjs-portal { display: none !important; }
    #rec-cursor { position: fixed; z-index: 2147483647; pointer-events: none; width: 26px; height: 26px;
      margin: -3px 0 0 -3px; transition: transform .12s; filter: drop-shadow(0 3px 6px rgba(0,0,0,.28)); }
    #rec-cursor.down { transform: scale(.82); }
    .rec-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 52px; height: 52px; margin: -26px 0 0 -26px;
      border-radius: 50%; border: 3px solid #D6F23C; background: rgba(226,245,108,.25); animation: rec-ring .55s ease-out forwards; }
    @keyframes rec-ring { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }\`;
  const arrow = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#1a1a1a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const install = () => {
    if (document.getElementById("rec-cursor")) return;
    const s = document.createElement("style");
    s.textContent = style;
    document.head.appendChild(s);
    const c = document.createElement("div");
    c.id = "rec-cursor";
    c.innerHTML = arrow;
    document.body.appendChild(c);
    // Mouse events report unzoomed pixels; elements inside the zoomed page need them divided back.
    const at = (el, e) => { el.style.left = (e.clientX / ${zoom}) + "px"; el.style.top = (e.clientY / ${zoom}) + "px"; };
    document.addEventListener("mousemove", (e) => at(c, e), true);
    document.addEventListener("mousedown", (e) => {
      c.classList.add("down");
      const r = document.createElement("div");
      r.className = "rec-ring";
      at(r, e);
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 650);
    }, true);
    document.addEventListener("mouseup", () => c.classList.remove("down"), true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();`;

// Never press anything that emails a candidate or a client. The live part stops at the drafts.
const FORBIDDEN = /send|submit to client|client confirms|client wants interview/i;

// Saves Chrome's screencast frames with their times, then turns them into a constant 30 fps video.
class Capture {
  private cdp?: CDPSession;
  private frames: { file: string; t: number }[] = [];
  private dir: string;
  constructor(private page: Page, private name: string, private t0: number) {
    this.dir = path.join(OUT, `${name}-frames`);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async start() {
    const cdp = (this.cdp = await this.page.context().newCDPSession(this.page));
    cdp.on("Page.screencastFrame", (f) => {
      const file = `${String(this.frames.length).padStart(5, "0")}.jpg`;
      fs.writeFileSync(path.join(this.dir, file), Buffer.from(f.data, "base64"));
      const at = f.metadata.timestamp ? f.metadata.timestamp * 1000 : Date.now();
      this.frames.push({ file, t: Math.max(0, (at - this.t0) / 1000) });
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: SIZE.width * SCALE,
      maxHeight: SIZE.height * SCALE,
    });
  }

  // Stops capturing and returns the encode step, run after all scenes so the next scene starts right away
  // (the agents don't wait for the camera).
  async stop(): Promise<() => void> {
    await this.cdp?.send("Page.stopScreencast").catch(() => {});
    const end = (Date.now() - this.t0) / 1000;
    if (!this.frames.length) throw new Error(`${this.name}: no frames captured`);
    // Each frame stays on screen until the next one arrives; the first one also covers the time before it.
    const lines = ["ffconcat version 1.0"];
    this.frames.forEach((f, i) => {
      const next = i + 1 < this.frames.length ? this.frames[i + 1].t : end;
      const from = i === 0 ? 0 : f.t;
      lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - from).toFixed(4)}`);
    });
    lines.push(`file '${this.frames[this.frames.length - 1].file}'`);
    const list = path.join(this.dir, "list.ffconcat");
    fs.writeFileSync(list, lines.join("\n"));
    return () => {
      execFileSync("ffmpeg", [
      "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list,
      "-vf", `scale=${SIZE.width * SCALE}:${SIZE.height * SCALE}:flags=lanczos,fps=30,format=yuv420p`,
        "-c:v", "libx264", "-preset", "medium", "-crf", "14", path.join(OUT, `${this.name}.mp4`),
      ]);
      fs.rmSync(this.dir, { recursive: true, force: true });
    };
  }
}

class Scene {
  start = Date.now();
  mouse = { x: SIZE.width / 2, y: SIZE.height * 0.62 };
  constructor(public name: string, public page: Page, private markers: Marker[]) {}

  mark(label: string) {
    const t = Math.round((Date.now() - this.start) / 100) / 10;
    this.markers.push({ scene: this.name, label, t });
    console.log(`  [${this.name}] ${t.toFixed(1)}s ${label}`);
  }

  pause = (ms: number) => this.page.waitForTimeout(ms);

  async goto(url: string) {
    await this.page.goto(BASE + url, { waitUntil: "networkidle" });
    await this.page.mouse.move(this.mouse.x, this.mouse.y);
  }

  // Glide the cursor to an element (it scrolls into view first), like a person would.
  async moveTo(target: Locator, block: ScrollLogicalPosition = "center") {
    await target.evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b }), block);
    await this.pause(700);
    const box = await target.boundingBox();
    if (!box) throw new Error(`${this.name}: element not visible`);
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await this.page.mouse.move(to.x, to.y, { steps: 28 });
    this.mouse = to;
    await this.pause(250);
  }

  async click(target: Locator) {
    const text = ((await target.innerText({ timeout: 5000 }).catch(() => "")) || (await target.getAttribute("aria-label", { timeout: 1000 }).catch(() => "")) || "").trim();
    if (FORBIDDEN.test(text)) throw new Error(`${this.name}: refusing to click "${text}" (it would send an email)`);
    await this.moveTo(target);
    await this.page.mouse.down();
    await this.pause(90);
    await this.page.mouse.up();
    await this.pause(400);
  }

  // Replace a field's text by typing, so the change is visible on video.
  async type(target: Locator, text: string) {
    await this.click(target);
    await target.press("ControlOrMeta+a");
    await target.press("Backspace");
    await target.pressSequentially(text, { delay: 10 });
    await this.pause(250);
  }

  async scrollTo(target: Locator, holdMs = 1200, block: ScrollLogicalPosition = "center") {
    await target.evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b }), block);
    await this.pause(holdMs);
  }

  async scrollBy(dy: number, holdMs = 1000) {
    await this.page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), dy);
    await this.pause(holdMs);
  }

  // A tab on a candidate row (Pre-screen, Interview, Candidate · 7, ...).
  tab(name: string | RegExp) {
    return this.page.getByRole("tab", { name, exact: typeof name === "string" }).first();
  }

  // Waits on the real agents. The scene keeps recording; the edit speeds these stretches up.
  async waitFor(what: string, check: () => Promise<boolean>, timeoutMs: number) {
    this.mark(`wait-start: ${what}`);
    const until = Date.now() + timeoutMs;
    while (!(await check().catch(() => false))) {
      if (Date.now() > until) throw new Error(`${this.name}: gave up waiting for ${what} after ${timeoutMs / 1000}s`);
      await this.pause(2000);
    }
    this.mark(`wait-end: ${what}`);
  }
}

async function record(ctxFactory: () => Promise<BrowserContext>, name: string, markers: Marker[], body: (s: Scene) => Promise<void>, encodes: (() => void)[]) {
  console.log(`Scene ${name}`);
  const ctx = await ctxFactory();
  const page = await ctx.newPage();
  const scene = new Scene(name, page, markers);
  const capture = new Capture(page, name, scene.start);
  await capture.start();
  try {
    await body(scene);
    await scene.pause(800);
  } finally {
    encodes.push(await capture.stop());
    await ctx.close();
  }
}

const visible = (l: Locator) => l.first().isVisible();

// ---------- scenes ----------

type SceneDef = { id: string; name: string; zoom?: number; run: (s: Scene) => Promise<void> };

const kestrelBohdan = async (s: Scene) => {
  await s.goto(`/jobs/${KESTREL.jobId}`);
  await s.pause(600);
  await s.scrollTo(s.page.getByText("Bohdan Petrenko").first(), 900, "start");
};

const scenes: SceneDef[] = [
  {
    id: "01",
    name: "01-brief-create-spec",
    run: async (s) => {
      await s.goto("/");
      await s.pause(2500); // the headline: "Less busywork. More hiring."
      s.mark("headline shown");
      const row = s.page.locator("div.py-6").filter({ hasText: "urgent" }).filter({ has: s.page.getByRole("button", { name: "Create spec" }) }).first();
      await s.moveTo(row.getByText("urgent").first());
      await s.pause(700);
      await s.click(row.getByRole("button", { name: "Create spec" }));
      const review = s.page.getByRole("link", { name: /Review spec/ });
      await s.waitFor("spec agent", () => visible(review), 180_000);
      await s.pause(1500);
      state.specId = (await review.first().getAttribute("href"))!.split("/").pop();
      saveState();
      await s.click(review.first());
      await s.page.waitForURL(/\/approvals\/spec\//);
      await s.pause(1500);
    },
  },
  {
    id: "02",
    name: "02-spec-review",
    run: async (s) => {
      if (!state.specId) throw new Error("No live spec yet: run scene 01 first.");
      await s.goto(`/approvals/spec/${state.specId}`);
      await s.pause(2000);
      s.mark("brief and spec shown");
      await s.moveTo(s.page.locator("#spec-title"));
      await s.scrollTo(s.page.locator("#open-questions"), 2500, "start");
      s.mark("open questions shown");
      await s.type(s.page.locator("#spec-title"), SPEC_ANSWERS.title);
      await s.click(s.page.getByRole("button", { name: "Seniority" }));
      await s.click(s.page.getByRole("option", { name: "Senior", exact: true }));
      for (const key of ["must_have", "nice_to_have", "location", "selling_points"] as const)
        await s.type(s.page.locator(`#spec-${key}`), SPEC_ANSWERS[key]);
      s.mark("answers typed");
      // Tick the open questions the recruiter just answered.
      const boxes = s.page.getByRole("checkbox", { name: "Mark as answered" });
      await s.scrollTo(s.page.locator("#open-questions"), 600, "start");
      const n = await boxes.count();
      for (let i = 0; i < n; i++) if (!(await boxes.nth(i).isChecked())) await s.click(boxes.nth(i));
      s.mark("questions ticked");
      await s.pause(800);
      await s.click(s.page.getByRole("button", { name: /Approve spec/ }));
      const openJob = s.page.getByRole("link", { name: /Open job/ });
      await s.waitFor("job created", () => visible(openJob), 60_000);
      await s.scrollTo(s.page.getByText("Spec approved · job created"), 1800);
      s.mark("approved");
      state.jobId = (await openJob.first().getAttribute("href"))!.split("/").pop();
      saveState();
    },
  },
  {
    id: "03",
    name: "03-pipeline",
    run: async (s) => {
      if (!state.jobId) throw new Error("No live job yet: run scenes 01-02 first.");
      await s.goto(`/jobs/${state.jobId}`);
      await s.pause(1500);
      // The page refreshes itself every few seconds while agents run: the numbers and the candidate list fill in.
      const { db } = await import("@/lib/db");
      const ready = async () => (await db.job.findUniqueOrThrow({ where: { id: state.jobId } })).status === "awaiting_shortlist";
      await s.waitFor("sourcing, enrichment, screening", ready, 600_000);
      await s.pause(4500); // the page's next refresh shows the result
      await s.pause(2500);
      await s.scrollBy(520, 2000);
      await s.scrollBy(-520, 1000);
    },
  },
  {
    id: "04",
    name: "04-shortlist",
    run: async (s) => {
      await s.goto(`/approvals/shortlist/${state.jobId}`);
      await s.pause(2000);
      s.mark("shortlist shown");
      // Open the top candidate's written reasons: the "every score explained" moment.
      await s.click(s.page.getByText("Screening reasons").first());
      s.mark("reasons open");
      await s.pause(3500);
      await s.scrollBy(380, 2200);
      // Keep the top two (best score first), untick the rest.
      const boxes = s.page.getByRole("checkbox", { name: /^Shortlist / });
      const n = await boxes.count();
      for (let i = 2; i < n; i++) if (await boxes.nth(i).isChecked()) await s.click(boxes.nth(i));
      s.mark("top two kept");
      await s.click(s.page.getByRole("button", { name: /Approve shortlist/ }));
      await s.page.waitForURL(/\/jobs\//);
      s.mark("shortlist approved");
      // Outreach drafts are written on the server; checked in the database without leaving the job page on camera.
      const { db } = await import("@/lib/db");
      await s.waitFor("outreach drafts", async () => (await db.message.count({ where: { jobId: state.jobId, kind: "first", status: "awaiting_approval" } })) >= 2, 180_000);
      await s.pause(1500);
    },
  },
  {
    id: "05",
    name: "05-outreach",
    run: async (s) => {
      await s.goto(`/approvals/outreach/${state.jobId}`);
      await s.pause(2000);
      s.mark("drafts page shown");
      await s.scrollTo(s.page.locator("textarea").first(), 3500);
      s.mark("draft shown");
      await s.scrollTo(s.page.getByText("Personalized with").first(), 2500);
      // Hover over the button only: in the video the recruiter is about to approve. Nothing is sent.
      await s.moveTo(s.page.getByRole("button", { name: /^Approve and send$/ }).first());
      await s.pause(1800);
    },
  },
  {
    id: "06",
    name: "06-reply",
    run: async (s) => {
      await kestrelBohdan(s);
      await s.click(s.tab(/^Candidate · \d+$/));
      await s.click(s.page.getByText(/\d+ earlier messages?/).first());
      await s.scrollTo(s.page.getByText("Yes, I'm interested").first(), 3000);
      s.mark("interested reply shown");
    },
  },
  {
    id: "07",
    name: "07-prescreen",
    run: async (s) => {
      await kestrelBohdan(s);
      await s.click(s.tab("Pre-screen"));
      await s.scrollTo(s.page.getByText("The agent suggests submitting them to the client.").first(), 3200);
      s.mark("pre-screen shown");
    },
  },
  {
    id: "08",
    name: "08-submission",
    run: async (s) => {
      await s.goto(`/submissions/${KESTREL.submissionId}`);
      await s.pause(2500);
      await s.scrollBy(420, 2200);
    },
  },
  {
    id: "09",
    name: "09-client-reply",
    run: async (s) => {
      await kestrelBohdan(s);
      await s.click(s.tab(/^Client · \d+$/));
      await s.click(s.page.getByText(/\d+ earlier messages?/).first());
      await s.scrollTo(s.page.getByText(/Bohdan looks great/).first(), 3000);
      s.mark("client reply shown");
    },
  },
  {
    id: "10",
    name: "10-interview",
    run: async (s) => {
      await kestrelBohdan(s);
      await s.click(s.tab("Interview"));
      await s.scrollTo(s.page.getByText("In both calendars.").first(), 1200);
      await s.moveTo(s.page.getByRole("link", { name: /Google Meet/ }).first());
      await s.pause(2200);
    },
  },
  {
    id: "11",
    name: "11-hired",
    run: async (s) => {
      await s.goto(`/jobs/${KESTREL.jobId}`);
      await s.pause(2500);
      s.mark("headline shown");
      await s.moveTo(s.page.getByText(/^\$0\.35 of \$1\.50$/).first());
      await s.pause(1200);
      await s.scrollTo(s.page.getByText("Hired", { exact: true }).last(), 3000);
      s.mark("hired tile shown");
    },
  },
  {
    id: "12",
    name: "12-runs",
    zoom: 1, // the runs table is wide: cost, budget and % of budget sit on the right
    run: async (s) => {
      await s.goto("/runs");
      await s.pause(2500);
      s.mark("headline shown");
      await s.scrollBy(560, 2200);
      await s.moveTo(s.page.getByRole("link", { name: "Langfuse" }).nth(1));
      await s.pause(1500);
    },
  },
];

// ---------- live setup ----------

// A fresh copy of the Kestrel brief, so the live part starts from the same messy email. Not filmed.
async function createLiveBrief() {
  const { db } = await import("@/lib/db");
  const src = await db.clientBrief.findUniqueOrThrow({ where: { id: KESTREL.sourceBriefId } });
  const id = `brief-video-${Date.now().toString(36)}`;
  await db.clientBrief.create({
    data: { id, clientId: src.clientId, fromName: src.fromName, fromEmail: src.fromEmail, subject: src.subject, body: src.body, receivedAt: new Date(), source: "manual" },
  });
  state = { briefId: id };
  saveState();
  console.log(`Live brief created: ${id} (copy of ${KESTREL.sourceBriefId})`);
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes("--headed");
  const picked = args.filter((a) => /^\d\d$/.test(a));
  const todo = picked.length ? scenes.filter((s) => picked.includes(s.id)) : scenes;

  fs.mkdirSync(OUT, { recursive: true });
  const ping = await fetch(BASE).catch(() => null);
  if (!ping?.ok) throw new Error(`The app isn't answering at ${BASE}. Start it with: npm run dev`);
  if (todo.some((s) => s.id === "01")) await createLiveBrief();

  const markers = readJson<Marker[]>(markersPath, []).filter((m) => !todo.some((s) => s.name === m.scene));
  const browser = await chromium.launch({ headless: !headed });
  const newCtx = (zoom: number) => async () => {
    const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: SCALE });
    await ctx.addInitScript({ content: pageSetup(zoom) });
    return ctx;
  };
  const encodes: (() => void)[] = [];
  try {
    for (const s of todo) {
      await record(newCtx(s.zoom ?? ZOOM), s.name, markers, s.run, encodes);
      fs.writeFileSync(markersPath, JSON.stringify(markers, null, 2));
    }
  } finally {
    await browser.close();
    console.log("Encoding clips…");
    encodes.forEach((encode) => encode());
  }
  console.log(`\nDone: ${todo.length} clip(s) in video/raw/`);
  if (todo.some((s) => s.id === "05"))
    console.log(`Note: the live job ${state.jobId} has 2 unsent outreach drafts. Reject or stop that job when you're done.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
