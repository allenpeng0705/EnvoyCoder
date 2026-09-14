/**
 * Measure the rendered chat surface in a real browser: the claims `docs/design-tokens.md` makes.
 *
 * `npm run ui:audit -- <url> [--click "text"]` (needs Chrome and a running window).
 *
 * Why this exists: this project cannot check its own appearance by looking at it — the harness runs on a
 * text model, and "it looked fine in the diff" is not a check. What it *can* do is measure the things the
 * design document states as numbers: the 820px content measure and its centring, the content type size
 * and leading, the composer card's radius, whether the window overflows horizontally, and — computed the
 * way WCAG computes it — the contrast of every piece of small text on the surface behind it. That last
 * one is how the hints and chips in this surface were found at 3.5:1 and 3.8:1 rather than shipped.
 *
 * It is a dev tool, not a gate: it needs Chrome, a dev server and a daemon, so it prints and exits.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

/** Where Chrome lives, on the three platforms this product ships to. */
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const CHROME = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!CHROME) {
  console.error("No Chrome or Chromium found — this tool drives a real browser.\nLooked in:\n  " + CHROME_CANDIDATES.join("\n  "));
  process.exit(2);
}
const url = process.argv[2];
const i = process.argv.indexOf("--click");
const click = i >= 0 ? process.argv[i + 1] : undefined;
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), "envoycoder-audit-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,900", url],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl;
for (let n = 0; n < 60 && !wsUrl; n += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
  } catch { /* not up */ }
  if (!wsUrl) await sleep(250);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
});
const send = (method, params = {}) =>
  new Promise((r) => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }))
    .result?.result?.value;

await send("Runtime.enable");
await sleep(3500);
if (click) {
  await evaluate(`(() => { const n=[...document.querySelectorAll("button,li,.task-row")].find(e=>(e.textContent||"").includes(${JSON.stringify(click)})); n&&n.click(); })()`);
  await sleep(900);
}

const audit = await evaluate(`(() => {
  const rgb = (c) => (c.match(/[\\d.]+/g) ?? []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (fg, bg) => {
    const a = lum(rgb(fg)), b = lum(rgb(bg));
    return ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
  };
  /** Walk up for the first non-transparent background, which is what a reader actually sees. */
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !c.includes("rgba(0, 0, 0, 0)")) return c;
    }
    return "rgb(255,255,255)";
  };
  const probe = (sel, label) => {
    const el = document.querySelector(sel);
    if (!el) return { label, missing: true };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      label,
      box: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), right: Math.round(r.right) },
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      radius: cs.borderRadius,
      bg: cs.backgroundColor,
      color: cs.color,
      contrast: contrast(cs.color, bgOf(el)),
    };
  };
  const text = document.querySelector(".row__text") ?? document.querySelector(".transcript__empty-body");
  return {
    theme: document.documentElement.dataset.theme,
    viewport: { w: innerWidth, h: innerHeight },
    horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    measure: probe(".transcript__empty, .transcript__list", "content measure"),
    card: probe(".composer__card", "composer card"),
    field: probe(".composer__input", "field"),
    hint: probe(".composer__hint", "hint"),
    title: probe(".pane__title", "pane title"),
    chip: probe(".suggestion, .chip", "chip / suggestion"),
    body: text ? { contrast: contrast(getComputedStyle(text).color, bgOf(text)), fontSize: getComputedStyle(text).fontSize, lineHeight: getComputedStyle(text).lineHeight } : { missing: true },
  };
})()`);

console.log(JSON.stringify(audit, null, 2));
ws.close();
chrome.kill();
process.exit(0);
