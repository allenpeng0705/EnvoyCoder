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
/**
 * `--size WxH` — the window the surface is measured in.
 *
 * Added for the settings bar, whose whole layout is a question about width: the bar is a column beside
 * the content while there is room for two, and the sections become the page when there is not. A tool
 * that could only measure one window size could not check the decision at all.
 */
const sizeFlag = process.argv.indexOf("--size");
const size = sizeFlag >= 0 ? process.argv[sizeFlag + 1] : "1440,900";
/**
 * `--port N` — the Chrome debugging port.
 *
 * Overridable because a port can be **held by a browser this run did not start** (a leftover from a
 * killed run, or another tool on the machine), and two tools fighting over 9333 would leave one of them
 * measuring whatever the other had open. The default stays, so the documented invocation is unchanged.
 */
const portFlag = process.argv.indexOf("--port");
const port = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : 9333;
const profile = mkdtempSync(join(tmpdir(), "envoycoder-audit-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${size}`, url],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * **The page we asked for, not just any page.**
 *
 * A debugging port outlives the browser that opened it often enough for this to matter: an earlier run
 * that was killed before its cleanup, or another tool on the machine, leaves a target list behind — and
 * a measurer that attaches to the first page it finds then reports numbers about a different application
 * entirely, which is worse than reporting nothing. So the target is matched by **URL**, and its absence
 * is a hard failure.
 */
let wsUrl;
for (let n = 0; n < 60 && !wsUrl; n += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && String(t.url).startsWith(url))
      ?.webSocketDebuggerUrl;
  } catch { /* not up */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) {
  console.error(`no page at ${url} on the debugging port ${port} — refusing to measure a page nobody asked for.`);
  chrome.kill();
  process.exit(2);
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
  // **By the words a user reads, or by the name a screen reader reads.** The rail's footer buttons carry
  // an icon glyph and an `aria-label`, so a text-only search found nothing and every measurement after
  // `--click "Settings"` reported the settings pane as absent — which is how this was found.
  const clicked = await evaluate(`(() => {
    const wanted = ${JSON.stringify(click)};
    // Interactive elements first, wrapper second — see the note in preview-ui.mjs: an \`li\` before its own
    // button is what made three screenshots identical.
    const interactive = "button, [role=button], a, input, select, textarea, .task-row";
    const matches = (list) => list.filter((n) => (n.textContent ?? "").trim().includes(wanted)
      || (n.getAttribute?.("aria-label") ?? "") === wanted
      || (n.getAttribute?.("title") ?? "") === wanted);
    const hit = matches([...document.querySelectorAll(interactive)])[0]
      ?? matches([...document.querySelectorAll("li")])[0];
    if (!hit) return "NOT FOUND: " + wanted;
    hit.click();
    return "clicked <" + hit.tagName + ">";
  })()`);
  console.log(`click "${click}": ${clicked}`);
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
  /**
   * **The settings pane, measured rather than described.**
   *
   * Three claims the settings work makes in prose and cannot check by looking: that the bar is a column
   * beside the content while there is room for one, that a settings row keeps its sentence and its
   * control on one line at that width (the reason the breakpoint is where it is), and that the focus ring
   * is the token sheet's own ring actually painted.
   */
  const settingsProbe = () => {
    const layout = document.querySelector(".settings-layout");
    const navEl = document.querySelector(".settings-nav");
    const paneBody = document.querySelector(".settings");
    if (!layout || !paneBody) return { present: false };
    const item = document.querySelector(".settings-nav__item--current") ?? document.querySelector(".settings-nav__item");
    let ring = null;
    if (item) {
      // Focus it the way a keyboard user would, then read what the browser painted: :focus-visible
      // needs a real focus, which element.focus() gives.
      item.focus();
      const cs = getComputedStyle(item);
      ring = { item: cs.outlineWidth + " " + cs.outlineStyle + " " + cs.outlineColor, offset: cs.outlineOffset, active: document.activeElement === item };
    }
    const itemRect = item ? item.getBoundingClientRect() : null;
    // A row whose control sits *below* its text has wrapped: the text band and the control cannot both
    // fit, which is the measurement the breakpoint is chosen by. Counting them is what turns "squeezed"
    // into a number.
    let wrapped = 0;
    let tallest = 0;
    for (const row of document.querySelectorAll(".settings .setting")) {
      const textBand = row.querySelector(".setting__text");
      const control = row.querySelector(".setting__control");
      const height = row.getBoundingClientRect().height;
      tallest = Math.max(tallest, Math.round(height));
      if (textBand && control && control.getBoundingClientRect().top > textBand.getBoundingClientRect().top + 4) wrapped += 1;
    }
    return {
      present: true,
      columns: getComputedStyle(layout).gridTemplateColumns,
      nav: navEl ? { w: Math.round(navEl.getBoundingClientRect().width), items: navEl.querySelectorAll(".settings-nav__item").length } : null,
      current: item ? item.getAttribute("aria-label") : null,
      itemWidth: itemRect ? Math.round(itemRect.width) : null,
      ring,
      bodyWidth: Math.round(paneBody.getBoundingClientRect().width),
      bodyScroll: { scrollHeight: paneBody.scrollHeight, clientHeight: paneBody.clientHeight },
      rowsTotal: document.querySelectorAll(".settings .setting").length,
      rowsWrapped: wrapped,
      tallestRow: tallest,
    };
  };

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
    settings: settingsProbe(),
  };
})()`);

console.log(JSON.stringify(audit, null, 2));
ws.close();
chrome.kill();
process.exit(0);
