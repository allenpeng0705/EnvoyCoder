/**
 * Drive the running UI in headless Chrome over CDP and take a screenshot.
 *
 * `npm run ui:preview -- <url> <out.png> [--click "text"] [--type "..."] [--keys "Enter"] [--wait 1200]`
 *
 * A screenshot tool for a repo that does not depend on Playwright: it drives Chrome over CDP with the
 * `ws` client that is already here. Use it to hand a reviewer a picture of a state — the chat with a run
 * in flight, the new-task screen, the rail after an import — and to click into those states without a
 * human. Its sibling `audit-ui.mjs` measures the same surface, which is the part a text model can read.
 */
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const CHROME = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!CHROME) {
  console.error("No Chrome or Chromium found — this tool drives a real browser.");
  process.exit(2);
}
const [url, out] = process.argv.slice(2, 4);
const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const waitMs = Number(flag("wait") ?? 1500);
/** `--size WxH`: the window the picture is taken in — the settings bar has two layouts. */
const size = flag("size") ?? "1440,900";
/** `--port N` — the Chrome debugging port. See `audit-ui.mjs` for why it is overridable. */
const port = Number(flag("port") ?? 9222);

const profile = mkdtempSync(join(tmpdir(), "envoycoder-shot-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${size}`,
    url,
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  // Matched by URL, for the reason audit-ui.mjs records at length: a debugging port can outlive the
  // browser that opened it, and a picture of another application is worse than no picture.
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl && String(t.url).startsWith(url),
      );
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`chrome never exposed a page at ${url}`);
}

const ws = new WebSocket(await target());
await new Promise((resolve) => ws.once("open", resolve));
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
await sleep(waitMs);

const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return res.result?.result?.value;
};

/**
 * `--click "text"`, or `--clicks "Settings|Projects"` for a walk.
 *
 * The plural form is here because a two-level surface cannot be photographed with one press: the
 * settings bar's sections are one press *below* the button that opens settings, and a picture of the
 * first screen only would be a picture of the screen the owner already knows.
 */
const clickText = flag("click");
const clicks = (flag("clicks") ?? "").split("|").map((part) => part.trim()).filter(Boolean);
if (clickText) clicks.unshift(clickText);
for (const wanted of clicks) {
  const clicked = await evaluate(`(() => {
    const wanted = ${JSON.stringify(wanted)};
    // **Interactive elements first, and a wrapper only as a last resort.** These lists are one button
    // inside one li, and querySelectorAll returns nodes in *document* order — so a selector list that
    // includes li matches the wrapper before the button inside it, and clicking a wrapper does nothing.
    // Measured: three screenshots taken through this function were byte-identical, because every click
    // after the first landed on an li. The fallback stays for a list whose row really is an li.
    const interactive = "button, [role=button], a, input, select, textarea, .task-row, .project__header";
    const matches = (list) => list.filter((n) => (n.textContent ?? "").trim().includes(wanted)
      || (n.getAttribute?.("aria-label") ?? "") === wanted
      || (n.getAttribute?.("title") ?? "") === wanted);
    const hit = matches([...document.querySelectorAll(interactive)])[0]
      ?? matches([...document.querySelectorAll("li")])[0];
    if (!hit) return "NOT FOUND: " + wanted;
    hit.scrollIntoView({ block: "center" });
    hit.click();
    return "clicked <" + hit.tagName + " class=" + (hit.className || hit.getAttribute("aria-label")) + ">";
  })()`);
  console.log(`click "${wanted}": ${clicked}`);
  await sleep(800);
}

const type = flag("type");
if (type) {
  const typed = await evaluate(`(() => {
    const field = document.querySelector("textarea, input");
    if (!field) return "no field";
    const setter = Object.getOwnPropertyDescriptor(
      field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(field, ${JSON.stringify(type)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
    return "typed";
  })()`);
  console.log(`type: ${typed}`);
  await sleep(300);
}

const keys = flag("keys");
if (keys) {
  const key = keys === "Enter" ? { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 } : { key: keys };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  console.log(`key: ${keys}`);
  await sleep(1500);
}

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(`wrote ${out}`);

ws.close();
chrome.kill();
process.exit(0);
