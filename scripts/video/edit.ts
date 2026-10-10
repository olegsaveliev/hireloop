// Edits the recorded clips into the LinkedIn video (1080x1350, 30 fps, with music).
//
//   npm run video:edit                 the full video -> video/hireloop-demo.mp4
//   npm run video:edit -- --preview    every 3rd frame at half size, fast, for checking the cut -> video/preview.mp4
//   npm run video:edit -- --from 14 --to 20   only part of the timeline (seconds), for checking one moment
//
// Needs: video/raw/*.mp4 (npm run video:record), the Higgsfield clips and sounds in video/hf2/ and video/higgsfield/
// (intro.mp4, outro.mp4, music-a.m4a, sfx-whoosh.wav, sfx-impact.wav, sfx-click.wav).
//
// How it works: ffmpeg cuts each shot's frames out of the 2x recordings (sped up to fit the shot); then a Chromium
// page composes every output frame: the camera (smooth push-ins with eased keyframes), transitions (whip, zoom,
// flash, lime circle), the floating 3D card, captions in the app's style, the real-time counter and the end card.
// ffmpeg turns the frames into the video and mixes the music (cuts sit on its 120 BPM beat; the drop lands on the
// outreach screen) with whooshes, hits and clicks.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "video");
const BUILD = path.join(ROOT, "build");
const W = 1080;
const H = 1350;
const FPS = 30;
const MUSIC_START = 0.29; // the track's beats then fall on every 0.5 s of the video

const STEPS = ["Brief", "Spec", "Source", "Screen", "Outreach", "Pre-screen", "Submit", "Interview", "Outcome"];

// ---------- the cut ----------

type Rect = { x: number; y: number; w: number }; // camera window in the recording, 1080x1350 coordinates (h = w * 1.25)
type Key = [number, Rect]; // [0..1 through the shot, window]
type Trans = "cut" | "fade" | "whip" | "zoom" | "flash" | "circle";
type Shot = {
  src?: string; // file in video/, none for the end card
  from: number; // seconds in the source
  to: number;
  len: number; // seconds on screen (beats of 0.5 s); speed = (to - from) / len
  cam?: Key[];
  in?: Trans; // how this shot enters
  card?: boolean; // the page floats as a tilted card on a dark stage
  hf?: boolean; // Higgsfield clip (3:4, cropped to 4:5)
  endCard?: boolean;
  clicks?: number[]; // source seconds of mouse clicks (click sound)
};

const FULL: Rect = { x: 0, y: 0, w: 1080 };
const raw = (n: string) => `raw/${n}.mp4`;

const SHOTS: Shot[] = [
  { src: "hf2/intro.mp4", hf: true, from: 0.04, to: 4.04, len: 4 },
  { src: raw("01-brief-create-spec"), from: 2.6, to: 7.0, len: 2.5, in: "fade", // a focus-pull dissolve hides the small mismatch with the AI frame clicks: [6.6],
    cam: [[0, FULL], [0.3, FULL], [1, { x: 190, y: 320, w: 760 }]] },
  { src: raw("01-brief-create-spec"), from: 7.4, to: 14.8, len: 1,
    cam: [[0, { x: 290, y: 180, w: 760 }], [1, { x: 330, y: 220, w: 700 }]] },
  { src: raw("02-spec-review"), from: 1.2, to: 4.4, len: 2, in: "whip",
    cam: [[0, { x: 110, y: 230, w: 540 }], [0.45, { x: 110, y: 210, w: 560 }], [1, { x: 400, y: 170, w: 680 }]] },
  { src: raw("02-spec-review"), from: 29.5, to: 41.0, len: 1, clicks: [30.6, 32.2, 33.8, 35.4, 37.0, 38.6, 40.2],
    cam: [[0, { x: 400, y: 230, w: 720 }], [1, { x: 420, y: 260, w: 680 }]] },
  { src: raw("02-spec-review"), from: 41.0, to: 45.5, len: 1, clicks: [42.1],
    cam: [[0, { x: 330, y: 420, w: 740 }], [1, { x: 300, y: 450, w: 720 }]] },
  { src: raw("03-pipeline"), from: 1.5, to: 34.5, len: 2.5, in: "zoom",
    cam: [[0, FULL], [1, { x: 60, y: 300, w: 840 }]] },
  { src: raw("04-shortlist"), from: 4.6, to: 9.0, len: 1.5, in: "whip", clicks: [4.8],
    cam: [[0, { x: 100, y: 150, w: 960 }], [0.5, { x: 100, y: 420, w: 780 }], [1, { x: 110, y: 430, w: 760 }]] },
  { src: raw("04-shortlist"), from: 22.0, to: 26.8, len: 1, clicks: [22.6, 23.4, 24.2, 26.2],
    cam: [[0, { x: 100, y: 330, w: 800 }], [0.45, { x: 100, y: 330, w: 800 }], [0.72, { x: 330, y: 450, w: 720 }], [1, { x: 330, y: 450, w: 720 }]] },
  { src: raw("05-outreach"), from: 1.0, to: 3.0, len: 1, in: "flash",
    cam: [[0, { x: 100, y: 60, w: 720 }], [1, { x: 60, y: 40, w: 900 }]] },
  { src: raw("05-outreach"), from: 3.5, to: 7.0, len: 1,
    cam: [[0, { x: 120, y: 400, w: 620 }], [1, { x: 330, y: 470, w: 700 }]] },
  { src: raw("05-outreach"), from: 10.0, to: 14.0, len: 1,
    cam: [[0, { x: 330, y: 240, w: 720 }], [1, { x: 400, y: 330, w: 620 }]] },
  { src: raw("06-reply"), from: 13.0, to: 16.5, len: 2, in: "whip",
    cam: [[0, { x: 200, y: 300, w: 880 }], [1, { x: 250, y: 370, w: 780 }]] },
  { src: raw("07-prescreen"), from: 5.5, to: 9.0, len: 1.5, in: "whip",
    cam: [[0, { x: 150, y: 300, w: 900 }], [1, { x: 170, y: 330, w: 840 }]] },
  { src: raw("08-submission"), from: 0.5, to: 3.5, len: 2, in: "zoom", card: true,
    cam: [[0, FULL], [1, FULL]] },
  { src: raw("09-client-reply"), from: 8.5, to: 11.5, len: 1.5, in: "whip",
    cam: [[0, { x: 200, y: 300, w: 860 }], [1, { x: 240, y: 350, w: 800 }]] },
  { src: raw("10-interview"), from: 7.0, to: 10.0, len: 2, in: "whip",
    cam: [[0, { x: 120, y: 220, w: 1000 }], [1, { x: 170, y: 250, w: 900 }]] },
  { src: raw("11-hired"), from: 0.5, to: 5.5, len: 2, in: "flash",
    cam: [[0, FULL], [0.15, FULL], [1, { x: 400, y: 240, w: 680 }]] },
  { src: raw("12-runs"), from: 0.5, to: 3.3, len: 1.5, in: "whip",
    cam: [[0, { x: 60, y: 40, w: 760 }], [1, FULL]] },
  { src: "hf2/outro.mp4", hf: true, from: 0.0, to: 4.04, len: 3.5, in: "fade" },
  { from: 0, to: 3, len: 3, endCard: true, in: "circle" },
];

const TRANS_LEN: Record<Trans, number> = { cut: 0, fade: 0.5, whip: 0.32, zoom: 0.4, flash: 0.3, circle: 0.55 };

// Captions: [start, end, step (0 = no step bar), text, "top" when the action is at the bottom of the screen].
// Steps follow the 9-step flow.
const CAPTIONS: [number, number, number, string, ("top" | undefined)?][] = [
  [4.3, 7.5, 1, "A messy client brief comes in."],
  [7.5, 9.5, 2, "AI drafts the spec and flags the gaps."],
  [9.5, 11.5, 2, "You answer. You approve.", "top"],
  [11.5, 14.0, 3, "Agents source, enrich and score."],
  [14.0, 15.5, 4, "Every score comes with reasons."],
  [15.5, 16.5, 4, "You pick the shortlist.", "top"],
  [16.5, 18.5, 5, "Personal outreach for each candidate."],
  [18.5, 19.5, 5, "Nothing is sent without you."],
  [19.5, 21.5, 5, "Candidate: “Yes, I'm interested.”"],
  [21.5, 23.0, 6, "AI pre-screen: proceed."],
  [23.0, 25.0, 7, "A client-ready profile."],
  [25.0, 26.5, 7, "Client: “Exactly the profile we need.”"],
  [26.5, 28.5, 8, "Interview booked in both calendars."],
  [28.5, 30.5, 9, "Hired. Total AI cost: $0.35."],
  [30.5, 32.0, 9, "Every agent run traced and costed."],
];

// The timelapse chip on the agents' shots: real seconds the agents took.
const COUNTERS = [
  { at: 6.5, until: 7.5, label: "SPEC AGENT", real: 7, speed: "×7" },
  { at: 11.5, until: 14.0, label: "AGENTS WORKING", real: 33, speed: "×13" },
];

const TITLE = { at: 0.45, until: 2.45, lines: ["Buried in", "busywork."] };

// ---------- timeline ----------

type Placed = Shot & { i: number; start: number; end: number; speed: number; dIn: number; dOut: number; dir: string; t0: number; n: number };

function place(): Placed[] {
  let t = 0;
  const placed = SHOTS.map((s, i) => {
    const p = { ...s, i, start: t, end: t + s.len, speed: (s.to - s.from) / s.len, dIn: TRANS_LEN[s.in ?? "cut"], dOut: 0, dir: "", t0: 0, n: 0 };
    t += s.len;
    return p;
  });
  placed.forEach((p, i) => (p.dOut = placed[i + 1]?.dIn ?? 0));
  return placed;
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const easeIn = (u: number) => u * u * u;
const expoOut = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

function camAt(s: Placed, t: number): Rect {
  const keys = s.cam ?? [[0, FULL], [1, FULL]];
  const u = clamp((t - s.start) / s.len);
  let k = 0;
  while (k < keys.length - 1 && u > keys[k + 1][0]) k++;
  const [ua, ra] = keys[k];
  const [ub, rb] = keys[Math.min(k + 1, keys.length - 1)];
  const v = ub > ua ? ease(clamp((u - ua) / (ub - ua))) : 0;
  const w = lerp(ra.w, rb.w, v);
  const h = w * 1.25;
  return { x: clamp(lerp(ra.x, rb.x, v), 0, W - w), y: clamp(lerp(ra.y, rb.y, v), 0, H - h), w };
}

// ---------- frames out of the recordings ----------

const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
const duration = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

function extract(s: Placed, scale: number) {
  if (s.endCard) return;
  const src = path.join(ROOT, s.src!);
  const srcLen = duration(src);
  const a = Math.max(0, s.from - (s.dIn / 2) * s.speed);
  const b = Math.min(srcLen - 0.02, s.to + (s.dOut / 2) * s.speed);
  s.t0 = s.start - (s.from - a) / s.speed; // timeline time of the first extracted frame
  s.dir = path.join(BUILD, `shot-${String(s.i).padStart(2, "0")}`);
  fs.rmSync(s.dir, { recursive: true, force: true });
  fs.mkdirSync(s.dir, { recursive: true });
  const size = `${Math.round(2 * W * scale)}:${Math.round(2 * H * scale)}`;
  const fit = s.hf ? `crop=iw:iw*1.25:0:(ih-iw*1.25)/2,scale=${size}:flags=lanczos` : `scale=${size}:flags=lanczos`;
  ffmpeg(["-ss", a.toFixed(3), "-t", (b - a).toFixed(3), "-i", src, "-vf", `setpts=(PTS-STARTPTS)/${s.speed.toFixed(5)},fps=${FPS},${fit}`, "-q:v", "3", path.join(s.dir, "%05d.jpg")]);
  s.n = fs.readdirSync(s.dir).length;
}

// ---------- one output frame ----------

type Layer = {
  img?: string;
  cam?: Rect;
  opacity: number;
  blur: number;
  ty: number; // whole-layer move, px
  scale: number;
  card?: { rx: number; ry: number; s: number; ty: number };
  clip?: number; // circle reveal radius, % of the frame
  endCard?: number; // seconds into the end card
  vignette: number;
};

function frameState(shots: Placed[], t: number) {
  const layers: Layer[] = [];
  let flash = 0;
  for (const s of shots) {
    const from = s.start - s.dIn / 2;
    const until = s.end + s.dOut / 2;
    if (t < from || t >= until) continue;
    const L: Layer = { opacity: 1, blur: 0, ty: 0, scale: 1, vignette: s.hf ? 0.3 : 0.12 };
    if (s.endCard) L.endCard = t - s.start;
    else {
      const k = Math.round((t - s.t0) * FPS);
      L.img = path.join(s.dir, `${String(clamp(k + 1, 1, s.n)).padStart(5, "0")}.jpg`);
      L.cam = camAt(s, t);
      // A little motion blur while the camera moves fast.
      const prev = camAt(s, t - 1 / FPS);
      const v = (Math.abs(L.cam.x - prev.x) + Math.abs(L.cam.y - prev.y) + Math.abs(L.cam.w - prev.w)) * (W / L.cam.w);
      L.blur = Math.min(2, v * 0.05);
    }
    if (s.card) {
      const u = ease(clamp((t - s.start) / s.len));
      L.card = { rx: lerp(12, 2, u), ry: lerp(-20, -5, u), s: lerp(0.8, 0.9, u), ty: lerp(30, -40, u) };
    }
    // Entering.
    if (s.dIn > 0 && t < s.start + s.dIn / 2) {
      const p = clamp((t - from) / s.dIn);
      if (s.in === "fade") { L.opacity = ease(p); L.blur += Math.sin(Math.PI * p) * 12; }
      if (s.in === "whip") { L.ty = H * (1 - ease(p)); L.blur += Math.sin(Math.PI * p) * 22; }
      if (s.in === "zoom") { L.scale = lerp(0.82, 1, easeOut(p)); L.opacity = ease(p); L.blur += (1 - p) * 14; }
      if (s.in === "flash") { L.opacity = p < 0.5 ? 0 : 1; flash = Math.max(flash, 1 - Math.abs(2 * p - 1)); }
      if (s.in === "circle") L.clip = 150 * ease(p);
    }
    // Leaving (the next shot's transition decides how).
    const next = shots[s.i + 1];
    if (next && s.dOut > 0 && t >= s.end - s.dOut / 2) {
      const p = clamp((t - (s.end - s.dOut / 2)) / s.dOut);
      if (next.in === "whip") { L.ty = -H * ease(p); L.blur += Math.sin(Math.PI * p) * 22; }
      if (next.in === "zoom") { L.scale = lerp(1, 1.3, easeIn(p)); L.blur += p * 14; }
      if (next.in === "fade") L.blur += Math.sin(Math.PI * p) * 12;
    }
    layers.push(L);
  }

  // Captions: the card stays up while captions follow each other; the text swaps with a quick reveal.
  const ci = CAPTIONS.findIndex(([a, b]) => t >= a && t < b);
  let caption = null;
  if (ci >= 0) {
    const [a, b, step, text] = CAPTIONS[ci];
    // A run = captions back to back in the same place: the card stays, only the text changes.
    const joined = (j: number) => CAPTIONS[j - 1][1] === CAPTIONS[j][0] && CAPTIONS[j - 1][4] === CAPTIONS[j][4];
    let runStart = a;
    for (let j = ci; j > 0 && joined(j); j--) runStart = CAPTIONS[j - 1][0];
    let runEnd = b;
    for (let j = ci + 1; j < CAPTIONS.length && joined(j); j++) runEnd = CAPTIONS[j][1];
    const prev = ci > 0 && joined(ci) ? CAPTIONS[ci - 1] : null;
    caption = {
      key: ci,
      step,
      kicker: step ? `${String(step).padStart(2, "0")}` : "",
      name: step ? STEPS[step - 1].toUpperCase() : "",
      text,
      top: CAPTIONS[ci][4] === "top",
      age: t - a,
      prevText: prev && prev[3] !== text ? prev[3] : null,
      cardIn: expoOut(clamp((t - runStart) / 0.45)),
      cardOut: clamp((runEnd - t) / 0.2),
    };
  }
  const c = COUNTERS.find((k) => t >= k.at && t < k.until);
  const counter = c
    ? { label: c.label, speed: c.speed, secs: Math.round(c.real * clamp((t - c.at) / (c.until - c.at))), opacity: clamp(Math.min((t - c.at) / 0.2, (c.until - t) / 0.15)) }
    : null;
  const title = t >= TITLE.at && t < TITLE.until + 0.4
    ? { lines: TITLE.lines, age: t - TITLE.at, out: clamp((t - TITLE.until) / 0.4) }
    : null;
  return { layers, flash, caption, counter, title, grain: Math.floor(t * FPS) };
}

// ---------- the compositor page ----------

const LOGO = `<svg viewBox="0 0 120 120"><rect width="120" height="120" rx="30" fill="#1f1f1f"/><path d="M81.86 33.95 A34 34 0 1 1 38.14 33.95" fill="none" stroke="#E2F56C" stroke-width="10" stroke-linecap="round"/><path d="M47.3 26.2 L28.65 28.86 L41.51 44.18 Z" fill="#E2F56C" stroke="#E2F56C" stroke-width="3" stroke-linejoin="round"/><path d="M60 42 L65 55 L78 60 L65 65 L60 78 L55 65 L42 60 L55 55 Z" fill="#E2F56C"/></svg>`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@500;600&display=block" rel="stylesheet">
<style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#111;font-family:Geist,sans-serif;-webkit-font-smoothing:antialiased}
  #stage{position:absolute;inset:0;background:radial-gradient(70% 55% at 50% 40%,#2c3114 0%,#151515 60%,#0e0e0e 100%)}
  .layer{position:absolute;inset:0;overflow:hidden;will-change:transform}
  .card{position:absolute;inset:0;overflow:hidden;transform-origin:50% 50%}
  .card.on{border-radius:34px;box-shadow:0 60px 140px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08)}
  .card img{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
  .vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 95% at 50% 45%,transparent 55%,rgba(0,0,0,1) 100%)}
  .end{position:absolute;inset:0;background:#E2F56C;color:#161616;display:none}
  .end .logo{position:absolute;left:50%;top:200px;width:150px;height:150px;margin-left:-75px}
  .end .word{position:absolute;left:0;right:0;top:375px;text-align:center;font:700 54px Geist;letter-spacing:-.03em}
  .end .head{position:absolute;left:68px;right:40px;top:500px;font:800 136px/0.98 Geist;letter-spacing:-.055em}
  .end .sub{position:absolute;left:72px;right:72px;top:820px;font:500 44px/1.25 Geist;letter-spacing:-.01em;color:#2a2a2a}
  .end .chips{position:absolute;left:72px;right:60px;top:990px;display:flex;flex-wrap:wrap;gap:14px}
  .end .chips b{padding:18px 30px;border-radius:999px;background:#161616;color:#E2F56C;font:600 34px Geist;letter-spacing:-.01em}
  .mask{display:block;overflow:hidden;padding-bottom:.08em;margin-bottom:-.08em}
  .mask>span{display:inline-block;will-change:transform}
  #grain{position:absolute;inset:-64px;pointer-events:none;opacity:.07;mix-blend-mode:overlay}
  #flash{position:absolute;inset:0;background:#fbffe6;opacity:0;pointer-events:none}
  .cap{position:absolute;left:44px;right:44px;bottom:60px;padding:26px 34px 32px;border-radius:30px;background:rgba(22,22,22,.95);
    box-shadow:0 24px 70px rgba(0,0,0,.35);display:none}
  .kick{display:flex;align-items:center;gap:14px;font:600 22px 'Geist Mono',monospace;letter-spacing:.16em;color:#E2F56C;height:34px}
  .kick .n{background:#E2F56C;color:#161616;border-radius:8px;padding:3px 9px;letter-spacing:.04em}
  .bars{margin-left:auto;display:flex;gap:6px}
  .bars i{width:24px;height:7px;border-radius:4px;background:rgba(255,255,255,.16)}
  .bars i.d{background:rgba(226,245,108,.45)} .bars i.c{background:#E2F56C}
  .txt{position:relative;margin-top:14px;font:600 54px/1.12 Geist;letter-spacing:-.025em;color:#fff;min-height:61px}
  .txt .old{position:absolute;left:0;top:0;right:0}
  .chip{position:absolute;bottom:262px;right:44px;display:none;align-items:center;gap:14px;padding:14px 22px;border-radius:999px;
    background:rgba(22,22,22,.94);color:#fff;font:600 22px 'Geist Mono',monospace;letter-spacing:.12em;box-shadow:0 14px 40px rgba(0,0,0,.3)}
  .chip .dot{width:12px;height:12px;border-radius:50%;background:#E2F56C;box-shadow:0 0 0 6px rgba(226,245,108,.25)}
  .chip .clk{color:#E2F56C;font-size:26px;letter-spacing:.04em}
  .chip .x{padding:4px 10px;border-radius:8px;background:#E2F56C;color:#161616;letter-spacing:.02em}
  .title{position:absolute;left:64px;right:40px;bottom:230px;font:800 132px/0.98 Geist;letter-spacing:-.055em;color:#fff;
    text-shadow:0 10px 60px rgba(0,0,0,.55);display:none}
  .title .l2{color:#E2F56C}
</style></head><body>
<div id="stage"></div><div id="layers"></div><div id="flash"></div><canvas id="grain" width="${W + 128}" height="${H + 128}"></canvas>
<div class="title" id="title"></div>
<div class="chip" id="chip"><b class="dot"></b><span class="lbl"></span><span class="clk"></span><span class="x"></span></div>
<div class="cap" id="cap"><div class="kick"><span class="n"></span><span class="nm"></span><span class="bars">${STEPS.map(() => "<i></i>").join("")}</span></div><div class="txt"></div></div>
<script>
  const g = document.getElementById('grain'), gc = g.getContext('2d');
  const noise = [];
  for (let k = 0; k < 6; k++) { const c = document.createElement('canvas'); c.width = ${W + 128}; c.height = ${H + 128};
    const x = c.getContext('2d'), d = x.createImageData(c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i+1] = d.data[i+2] = v; d.data[i+3] = 255; }
    x.putImageData(d, 0, 0); noise.push(c); }
  const layersEl = document.getElementById('layers');
  const pool = [];
  function layerEl(i) {
    while (pool.length <= i) {
      const el = document.createElement('div'); el.className = 'layer';
      el.innerHTML = '<div class="card"><img><div class="vig"></div></div><div class="end">' +
        '<div class="logo">${LOGO.replace(/'/g, "\\'")}</div><div class="word">Hireloop</div>' +
        '<div class="head"><span class="mask"><span>Less busywork.</span></span><span class="mask"><span>More hiring.</span></span></div>' +
        '<div class="sub"><span class="mask"><span>AI agents do the busywork.</span></span><span class="mask"><span>Recruiters make the calls.</span></span></div>' +
        '<div class="chips"><b>9 steps</b><b>6 human approvals</b><b>$0.35 AI cost</b></div></div>';
      layersEl.appendChild(el); pool.push(el);
    }
    return pool[i];
  }
  const E = (u) => u >= 1 ? 1 : 1 - Math.pow(2, -10 * u);
  const C = (v) => Math.max(0, Math.min(1, v));
  const back = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
  let lastCap = -1, lastTitle = false;
  window.apply = async (st) => {
    const loads = [];
    st.layers.forEach((L, i) => {
      const el = layerEl(i); el.style.display = 'block';
      el.style.opacity = L.opacity;
      el.style.transform = 'translateY(' + L.ty + 'px) scale(' + L.scale + ')';
      el.style.filter = L.blur > 0.3 ? 'blur(' + L.blur.toFixed(1) + 'px)' : 'none';
      el.style.clipPath = L.clip != null ? 'circle(' + L.clip + '% at 50% 55%)' : 'none';
      const card = el.querySelector('.card'), img = el.querySelector('img'), end = el.querySelector('.end');
      end.style.display = L.endCard != null ? 'block' : 'none';
      card.style.display = L.img ? 'block' : 'none';
      card.querySelector('.vig').style.opacity = L.vignette;
      if (L.img) {
        if (img.dataset.src !== L.img) { img.dataset.src = L.img; img.src = 'file://' + L.img; loads.push(img.decode().catch(() => {})); }
        const s = ${W} / L.cam.w;
        img.style.transform = 'scale(' + s + ') translate(' + (-L.cam.x) + 'px,' + (-L.cam.y) + 'px)';
        if (L.card) { card.classList.add('on');
          card.style.transform = 'perspective(2200px) translateY(' + L.card.ty + 'px) rotateX(' + L.card.rx + 'deg) rotateY(' + L.card.ry + 'deg) scale(' + L.card.s + ')'; }
        else { card.classList.remove('on'); card.style.transform = 'none'; }
      }
      if (L.endCard != null) {
        const e = L.endCard;
        const lg = el.querySelector('.logo'); const u = C((e - 0.15) / 0.55);
        lg.style.transform = 'scale(' + (0.4 + 0.6 * back(u)) + ') rotate(' + (-90 * (1 - E(u))) + 'deg)'; lg.style.opacity = C(u * 3);
        const wd = el.querySelector('.word'); wd.style.opacity = C((e - 0.45) / 0.3); wd.style.transform = 'translateY(' + (20 * (1 - E(C((e - 0.45) / 0.5)))) + 'px)';
        el.querySelectorAll('.head .mask>span').forEach((sp, k) => { sp.style.transform = 'translateY(' + (105 * (1 - E(C((e - 0.35 - 0.12 * k) / 0.6)))) + '%)'; });
        el.querySelectorAll('.sub .mask>span').forEach((sp, k) => { sp.style.transform = 'translateY(' + (105 * (1 - E(C((e - 0.85 - 0.1 * k) / 0.55)))) + '%)'; });
        el.querySelectorAll('.chips b').forEach((b, k) => { const v = C((e - 1.15 - 0.12 * k) / 0.45); b.style.opacity = v; b.style.transform = 'translateY(' + (24 * (1 - E(v))) + 'px) scale(' + (0.9 + 0.1 * E(v)) + ')'; });
      }
    });
    for (let i = st.layers.length; i < pool.length; i++) pool[i].style.display = 'none';
    document.getElementById('stage').style.opacity = 1;
    document.getElementById('flash').style.opacity = st.flash * 0.92;
    gc.clearRect(0, 0, g.width, g.height); gc.drawImage(noise[st.grain % noise.length], 0, 0);
    g.style.transform = 'translate(' + ((st.grain * 37) % 64) + 'px,' + ((st.grain * 53) % 64) + 'px)';

    const ti = document.getElementById('title');
    if (st.title) {
      if (!lastTitle) ti.innerHTML = st.title.lines.map((l, k) => '<span class="mask"><span class="l' + (k + 1) + '">' + l + '</span></span>').join('');
      lastTitle = true; ti.style.display = 'block';
      ti.querySelectorAll('.mask>span').forEach((sp, k) => { sp.style.transform = 'translateY(' + (108 * (1 - E(C((st.title.age - 0.18 * k) / 0.7)))) + '%)'; });
      ti.style.opacity = 1 - st.title.out; ti.style.filter = 'blur(' + (st.title.out * 16) + 'px)';
      ti.style.transform = 'scale(' + (1 + st.title.out * 0.12) + ')';
    } else { ti.style.display = 'none'; lastTitle = false; }

    const ch = document.getElementById('chip');
    if (st.counter) {
      ch.style.display = 'flex'; ch.style.opacity = st.counter.opacity;
      ch.querySelector('.lbl').textContent = st.counter.label;
      const s = st.counter.secs; ch.querySelector('.clk').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      ch.querySelector('.x').textContent = st.counter.speed;
      ch.querySelector('.dot').style.opacity = 0.55 + 0.45 * Math.abs(Math.sin(st.grain / 5));
    } else ch.style.display = 'none';

    const cap = document.getElementById('cap');
    if (st.caption) {
      const c = st.caption;
      cap.style.display = 'block';
      cap.style.opacity = Math.min(c.cardIn, c.cardOut);
      cap.style.top = c.top ? '44px' : 'auto'; cap.style.bottom = c.top ? 'auto' : '60px';
      cap.style.transform = 'translateY(' + ((c.top ? -40 : 40) * (1 - c.cardIn) - 10 * (1 - c.cardOut)) + 'px)';
      if (lastCap !== c.key) {
        lastCap = c.key;
        cap.querySelector('.n').textContent = c.kicker; cap.querySelector('.n').style.display = c.kicker ? 'inline' : 'none';
        cap.querySelector('.nm').textContent = c.name;
        cap.querySelectorAll('.bars i').forEach((b, k) => b.className = k + 1 < c.step ? 'd' : k + 1 === c.step ? 'c' : '');
        cap.querySelector('.bars').style.display = c.step ? 'flex' : 'none';
        const tx = cap.querySelector('.txt');
        tx.innerHTML = '<span class="mask new"><span>' + c.text + '</span></span>' + (c.prevText ? '<span class="mask old"><span>' + c.prevText + '</span></span>' : '');
      }
      const nw = cap.querySelector('.new>span'), od = cap.querySelector('.old>span');
      nw.style.transform = 'translateY(' + (110 * (1 - E(C((c.age - (od ? 0.12 : 0.08)) / 0.5)))) + '%)';
      if (od) od.style.transform = 'translateY(' + (-110 * E(C(c.age / 0.22))) + '%)';
    } else { cap.style.display = 'none'; lastCap = -1; }
    await Promise.all(loads);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  };
</script></body></html>`;

// ---------- sound ----------

function mix(shots: Placed[], total: number, out: string) {
  const H2 = path.join(ROOT, "higgsfield");
  const events: { file: string; at: number; vol: number }[] = [];
  for (const s of shots) {
    if (s.in === "whip" || s.in === "zoom") events.push({ file: "sfx-whoosh.wav", at: s.start - 0.22, vol: 0.55 });
    if (s.in === "flash" || s.in === "circle") events.push({ file: "sfx-impact.wav", at: s.start - 0.04, vol: 0.8 });
    for (const c of s.clicks ?? []) events.push({ file: "sfx-click.wav", at: s.start + (c - s.from) / s.speed, vol: 0.4 });
  }
  const inputs = ["-i", path.join(H2, "music-a.m4a"), ...events.flatMap((e) => ["-i", path.join(H2, e.file)])];
  const parts = [`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(MUSIC_START * 1000)}:all=1,afade=t=out:st=${(total - 1.6).toFixed(2)}:d=1.6,volume=0.9[m]`];
  events.forEach((e, k) => parts.push(`[${k + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${e.vol},adelay=${Math.max(0, Math.round(e.at * 1000))}:all=1[e${k}]`));
  parts.push(`[m]${events.map((_, k) => `[e${k}]`).join("")}amix=inputs=${events.length + 1}:normalize=0,atrim=0:${total.toFixed(2)},loudnorm=I=-14:TP=-1.5:LRA=11[a]`);
  ffmpeg([...inputs, "-filter_complex", parts.join(";"), "-map", "[a]", "-ar", "48000", "-c:a", "pcm_s16le", out]);
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  const preview = args.includes("--preview");
  const arg = (k: string) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : undefined);
  const shots = place();
  const total = shots[shots.length - 1].end;
  const from = arg("--from") ?? 0;
  const to = Math.min(total, arg("--to") ?? total);
  const scale = preview ? 0.5 : 1;
  const step = preview ? 3 : 1;

  for (const s of shots) if (s.src && !fs.existsSync(path.join(ROOT, s.src))) throw new Error(`Missing video/${s.src}. Record or download it first.`);
  fs.mkdirSync(BUILD, { recursive: true });
  console.log(`Timeline ${total}s. Cutting frames out of ${shots.length} shots…`);
  shots.forEach((s) => (s.end + s.dOut / 2 > from && s.start - s.dIn / 2 < to ? extract(s, scale) : null));

  const framesDir = path.join(BUILD, "frames");
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir);
  const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  fs.writeFileSync(path.join(BUILD, "compositor.html"), PAGE);
  await page.goto("file://" + path.join(BUILD, "compositor.html"), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const n0 = Math.round(from * FPS);
  const n1 = Math.round(to * FPS);
  let k = 0;
  for (let f = n0; f < n1; f += step) {
    const st = frameState(shots, f / FPS);
    await page.evaluate(`window.apply(${JSON.stringify(st)})`);
    await page.screenshot({ path: path.join(framesDir, `${String(k++).padStart(5, "0")}.jpg`), type: "jpeg", quality: 94 });
    if (k % 60 === 0) console.log(`  ${(f / FPS).toFixed(1)}s`);
  }
  await browser.close();

  const out = preview || from > 0 || to < total ? path.join(ROOT, "preview.mp4") : path.join(ROOT, "hireloop-demo.mp4");
  const audio = path.join(BUILD, "audio.wav");
  console.log("Mixing sound…");
  mix(shots, total, audio);
  ffmpeg([
    "-framerate", String(FPS / step), "-i", path.join(framesDir, "%05d.jpg"),
    "-ss", from.toFixed(3), "-t", (to - from).toFixed(3), "-i", audio,
    "-map", "0:v", "-map", "1:a", "-vf", `scale=${W * scale}:-2,format=yuv420p`, "-r", String(FPS),
    "-c:v", "libx264", "-preset", preview ? "veryfast" : "slow", "-crf", preview ? "23" : "16",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out,
  ]);
  console.log(`Done: ${path.relative(process.cwd(), out)} (${(to - from).toFixed(1)}s)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
