/**
 * **Measure the Settings pages in a real window** — the numbers the redesign is judged by.
 *
 * ## Why this is a script and not an assertion
 *
 * `docs/settings-parity.md` §7.13 established the rule this file follows: the claims about this pane are
 * about a *rendered* page, and the harness runs on a text model that cannot see one. So the numbers are
 * produced by driving the real thing — a daemon on an isolated home, Vite serving the real UI against it,
 * headless Chrome over CDP with the target matched **by URL** (<- the rule `audit-ui.mjs` records, and the
 * reason a previous measurement silently reported some other application's numbers) — and printed, so a
 * reader can compare two runs rather than trust a sentence in a commit message.
 *
 * ## The five numbers, and what each one is for
 *
 * | measurement | the question it answers |
 * |---|---|
 * | **visible characters** | the owner's actual complaint: *"too many texts … don't want to read so many texts"*. A page is a wall of prose or it is not, and this is the count that says which |
 * | **page height** | how many screens of scrolling the body is, at a named viewport |
 * | **rows above the fold** | whether a user meets the content or the preamble |
 * | **longest row** (characters *and* pixels) | the one row that makes the rest look ragged, and whether anything overflows its column |
 * | **contrast** | the family's 4.5:1 floor on every chip and piece of small print on the page |
 *
 * A row is defined as an element carrying one of the row classes this pane draws — see `ROW_SELECTOR`.
 * "Above the fold" counts rows whose *top* is inside the scrolling body's viewport, which is the honest
 * reading of "a user sees this without scrolling".
 *
 * ## What this script cannot see, printed rather than hidden
 *
 *   * **It does not press anything except the walk into the page.** A count of the catalogue is a count of
 *     what is rendered *closed*; open the catalogue first if you want the other number.
 *   * **It reports one machine's probe results.** Eight of the nine agents are `not-installed` here, and a
 *     row's height depends on whether it carries an install command. The same script on a machine with
 *     every agent installed gives different row heights — which is why the row count and the character
 *     count are reported separately from the heights.
 *   * **Contrast is computed the way WCAG computes it**, from the element's own computed colour and the
 *     nearest painted background. It cannot see a background image or a gradient, and this pane has
 *     neither — asserted in the output rather than assumed (`gradients: 0`).
 *
 * ```
 * node scripts/measure-settings.mjs --section agents
 * node scripts/measure-settings.mjs --section agents --open "Browse the catalogue"
 * node scripts/measure-settings.mjs --section general --out /tmp/envoycoder-measure
 * ```
 *
 * `--open "<label>"` presses one more thing before measuring, by the words a user reads. The Agents page needs
 * it: the page as it *opens* and the page with a group unfolded are two different and equally honest numbers,
 * and a tool that could only report one of them would have its output quoted as if it were the other.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const DAEMON_ENTRY = join(root, "apps/desktop/src/daemon/main.ts");

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name) => process.argv.includes(`--${name}`);

/** Which settings page to walk into. The sections bar's own labels are what the walk presses. */
const section = flag("section") ?? "agents";
/** The window the picture and the numbers are taken in. */
const size = flag("size") ?? "1440,900";
const keep = has("keep");
const outDir = resolve(flag("out") ?? join(tmpdir(), "envoycoder-measure"));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const probe = createServer();
    probe.on("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => res(port));
    });
  });
}

const children = [];
const track = (child) => {
  children.push(child);
  return child;
};
const stopAll = () => {
  for (const child of children.splice(0)) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
};
process.on("exit", stopAll);

const home = keep
  ? join(outDir, "home")
  : mkdtempSync(join(tmpdir(), "envoycoder-measure-home-"));
if (keep) mkdirSync(home, { recursive: true });
const daemonPort = await freePort();
const vitePort = await freePort();
const debugPort = await freePort();
const daemonLog = join(outDir, "daemon.log");

const daemon = track(
  spawn(process.execPath, ["--import", "tsx", DAEMON_ENTRY], {
    cwd: root,
    env: { ...process.env, ENVOYMESH_HOME: home, ENVOYCODER_DAEMON_PORT: String(daemonPort) },
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
let daemonOutput = "";
daemon.stdout.on("data", (c) => (daemonOutput += String(c)));
daemon.stderr.on("data", (c) => (daemonOutput += String(c)));

const claimFile = join(home, "EnvoyCoder", "daemon.json");
let claim = null;
for (let i = 0; i < 160 && claim === null; i += 1) {
  if (existsSync(claimFile)) {
    try {
      const parsed = JSON.parse(readFileSync(claimFile, "utf8"));
      if (parsed.port === daemonPort) claim = parsed;
    } catch {
      /* half-written */
    }
  }
  if (daemon.exitCode !== null) {
    console.error(`daemon exited early:\n${daemonOutput.slice(-2000)}`);
    process.exit(1);
  }
  if (claim === null) await sleep(250);
}
writeFileSync(daemonLog, daemonOutput);
if (claim === null) {
  console.error(`the daemon never published a claim; see ${daemonLog}`);
  process.exit(1);
}

const uiUrl = `http://127.0.0.1:${vitePort}/`;
const vite = track(
  spawn(
    process.execPath,
    [join(root, "node_modules/vite/bin/vite.js"), "--port", String(vitePort), "--strictPort"],
    {
      cwd: join(root, "apps/desktop"),
      env: { ...process.env, VITE_ENVOYCODER_DAEMON_PORT: String(daemonPort) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ),
);
let viteOutput = "";
vite.stdout.on("data", (c) => (viteOutput += String(c)));
vite.stderr.on("data", (c) => (viteOutput += String(c)));
for (let i = 0; i < 120 && !viteOutput.includes("ready in"); i += 1) {
  if (vite.exitCode !== null) {
    console.error(`vite exited early:\n${viteOutput.slice(-2000)}`);
    process.exit(1);
  }
  await sleep(250);
}

const profile = mkdtempSync(join(tmpdir(), "envoycoder-measure-chrome-"));
const chrome = track(
  spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--hide-scrollbars",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      `--window-size=${size}`,
      uiUrl,
    ],
    { stdio: "ignore" },
  ),
);

/** The page we asked for, matched **by URL** — see `audit-ui.mjs` for why that is not optional. */
let wsUrl;
for (let n = 0; n < 80 && !wsUrl; n += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    wsUrl = list.find(
      (t) => t.type === "page" && t.webSocketDebuggerUrl && String(t.url).startsWith(uiUrl),
    )?.webSocketDebuggerUrl;
  } catch {
    /* not up */
  }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) {
  console.error(`no page at ${uiUrl} — refusing to measure a page nobody asked for.`);
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
  new Promise((r) => {
    id += 1;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result
    ?.value;
const shoot = async (file) => {
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  if (shot.result?.data) writeFileSync(join(outDir, file), Buffer.from(shot.result.data, "base64"));
};

await send("Runtime.enable");
await send("Page.enable");
await sleep(4000);

/** Press the rail's Settings, then the section's own bar item or list row — by the words a user reads. */
async function press(wanted) {
  const result = await evaluate(`(() => {
    const wanted = ${JSON.stringify(wanted)};
    const interactive = "button, [role=button], a, input, select, textarea, .task-row";
    const matches = (list) => list.filter((n) =>
      (n.textContent ?? "").trim().includes(wanted)
      || (n.getAttribute?.("aria-label") ?? "") === wanted
      || (n.getAttribute?.("title") ?? "") === wanted);
    const hit = matches([...document.querySelectorAll(interactive)])[0]
      ?? matches([...document.querySelectorAll("li")])[0];
    if (!hit) return "NOT FOUND: " + wanted;
    hit.click();
    return "ok";
  })()`);
  await sleep(1200);
  return result;
}

const sectionTitle = {
  agents: "Agents",
  general: "General",
  tasks: "New tasks",
  safety: "Safety",
  shortcuts: "Keyboard shortcuts",
  machine: "This machine",
  about: "About",
};

console.log(`walk: Settings → ${section}`);
console.log(`  Settings: ${await press("Settings")}`);
console.log(`  ${sectionTitle[section] ?? section}: ${await press(sectionTitle[section] ?? section)}`);
await sleep(1200);

/**
 * `--open "Browse the catalogue"` — press one more thing before measuring, by the words a user reads.
 *
 * **Needed here rather than optional**, because the Agents page has two honest numbers and they answer
 * different questions: the page as it *opens* (what a user meets when they came here for something else) and
 * the page with a group unfolded (what they see when they came here for that group). A single measurement would
 * have to pick one and would then be quoted as if it were the other.
 */
const open = flag("open");
if (open !== undefined) {
  console.log(`  ${open}: ${await press(open)}`);
  await sleep(1400);
}

/**
 * The measurement itself, run inside the page.
 *
 * `ROW_SELECTOR` is the set of classes this pane draws a *row* with. It is deliberately a selector list
 * rather than "every child of the body": a heading and a note are not rows, and counting them would make
 * "rows above the fold" a number about paragraphs.
 */
const ROW_SELECTOR =
  ".setting, .settings__agent, .settings__catalog-row, .settings__project-row, .settings__shortcut-row, .settings__section-row";

const report = await evaluate(`(() => {
  const rgb = (c) => (c.match(/[\\d.]+/g) ?? []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
    return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
  };
  const bgOf = (node) => {
    // **Composited, not "the first opaque ancestor"** — the rule audit-ui.mjs already learned the hard
    // way. A chip's background is a 16%-alpha tint, so reading it as opaque made the blue chip report
    // 1.03:1 against its own blue text while the real ratio over the pane is 5.4:1, and a measurer that
    // raises a false alarm is worse than one that says nothing.
    const parse = (value) => {
      const parts = (String(value).match(/[\\d.]+/g) ?? []).map(Number);
      return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1 };
    };
    const layers = [];
    for (let el = node; el; el = el.parentElement) {
      const colour = parse(getComputedStyle(el).backgroundColor);
      if (colour.a === 0) continue;
      layers.push(colour);
      if (colour.a === 1) break;
    }
    const page = parse(getComputedStyle(document.documentElement).backgroundColor);
    let out = page.a === 1 ? page : { r: 24, g: 27, b: 26, a: 1 };
    for (const layer of layers.reverse()) {
      out = {
        r: layer.r * layer.a + out.r * (1 - layer.a),
        g: layer.g * layer.a + out.g * (1 - layer.a),
        b: layer.b * layer.a + out.b * (1 - layer.a),
      };
    }
    return "rgb(" + Math.round(out.r) + ", " + Math.round(out.g) + ", " + Math.round(out.b) + ")";
  };
  /** A node's own visible text, with runs of whitespace collapsed — what a reader would count. */
  const ownText = (node) => (node.innerText ?? "").replace(/\\s+/g, " ").trim();

  const body = document.querySelector(".settings");
  if (!body) return { error: "no settings body on screen — the walk did not land" };

  const all = [...body.querySelectorAll("*")];
  const rows = [...body.querySelectorAll(${JSON.stringify(ROW_SELECTOR)})];
  // A row's *own* text is the row minus its nested rows — otherwise the page total is counted twice and
  // a long row's number includes its children.
  const ownChars = (node) => {
    const nested = [...node.querySelectorAll(${JSON.stringify(ROW_SELECTOR)})];
    let text = ownText(node);
    for (const inner of nested) text = text.replace(ownText(inner), "");
    return text.replace(/\\s+/g, " ").trim();
  };

  const visibleChars = ownText(body).length;
  const bodyRect = body.getBoundingClientRect();
  const aboveFold = rows.filter((r) => r.getBoundingClientRect().top < bodyRect.bottom).length;

  const measured = rows.map((r) => {
    const rect = r.getBoundingClientRect();
    return {
      cls: r.className.split(" ").filter((c) => c.startsWith("setting")).join(".") || r.tagName,
      chars: ownChars(r).length,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      overflow: r.scrollWidth > r.clientWidth + 1,
      text: ownChars(r).slice(0, 240),
    };
  });
  const longestByChars = measured.slice().sort((a, b) => b.chars - a.chars)[0] ?? null;
  const widest = measured.slice().sort((a, b) => b.width - a.width)[0] ?? null;

  /**
   * **What each group costs**, which is the number the redesign is actually steered by.
   *
   * A page total says "too much"; a per-heading split says *where*, and the group that dominates this page is
   * not the one a reader would guess. Walked in **document order** over headings, rows and the loose paragraphs
   * between them — not over the body's direct children, which was the first attempt and reported 0 characters
   * for a group whose rows sit inside a list element. A grouping that measures the wrappers instead of the
   * content reports exactly the number that makes a crowded page look empty, which is the one answer this
   * script must never give.
   */
  const headings = [...body.querySelectorAll("h2, h3")];
  const groupable = [...body.querySelectorAll(["h2", "h3", ".settings__note", ${JSON.stringify(ROW_SELECTOR)}].join(", "))];
  const groups = [];
  let current = { heading: "(before the first heading)", chars: 0, rows: 0, height: 0 };
  for (const node of groupable) {
    if (headings.includes(node)) {
      groups.push(current);
      current = { heading: ownText(node), chars: 0, rows: 0, height: 0 };
      continue;
    }
    current.chars += ownChars(node).length;
    current.rows += rows.includes(node) ? 1 : 0;
    current.height += Math.round(node.getBoundingClientRect().height);
  }
  groups.push(current);

  /** The chips and small print, with the contrast of their own text on what is actually behind it. */
  const small = [...body.querySelectorAll(".chip, .settings__hint, .settings__catalog-version, .settings__agent-command, .setting__detail, .settings__note")];
  const contrast = small.map((node) => {
    const style = getComputedStyle(node);
    return {
      cls: node.className,
      sample: ownText(node).slice(0, 60),
      // The **length**, not only the colour: the measurement this tool is used for most is "how much text is
      // on this page", and a note is the shape a paragraph takes when it moves into a row.
      chars: ownText(node).length,
      size: Math.round(parseFloat(style.fontSize) * 10) / 10,
      ratio: ratio(style.color, bgOf(node)),
    };
  });
  const worst = contrast.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 6);
  const gradients = all.filter((n) => getComputedStyle(n).backgroundImage !== "none").length;

  return {
    viewport: { w: innerWidth, h: innerHeight },
    bodyViewportHeight: Math.round(body.clientHeight),
    visibleChars,
    charsAboveFold: ownText(body).length === 0 ? 0 : rows
      .filter((r) => r.getBoundingClientRect().top < bodyRect.bottom)
      .reduce((sum, r) => sum + ownChars(r).length, 0),
    pageHeight: Math.round(body.scrollHeight),
    screens: Math.round((body.scrollHeight / Math.max(body.clientHeight, 1)) * 100) / 100,
    rowCount: rows.length,
    rowsAboveFold: aboveFold,
    rowsBeyondFold: rows.length - aboveFold,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    rowsOverflowing: measured.filter((m) => m.overflow).length,
    longestByChars,
    widest,
    rowHeights: measured.map((m) => m.height),
    headings: headings.map((h) => ownText(h)),
    groups,
    contrast: { worst, below45: contrast.filter((c) => c.ratio < 4.5).length, gradients },
  };
})()`);

/**
 * Pictures, at the top of the body and then at each further screenful.
 *
 * **`captureBeyondViewport` does not help here**, and finding that out is why the loop exists: the scrolling
 * element is the pane's *inner* body (`.settings`), not the document, so a "full page" capture returns the
 * viewport and nothing more. A one-picture handover of a thirteen-screen page would therefore have been a
 * picture of the fold, presented as the page. So the body is scrolled and photographed screen by screen —
 * the same thing the owner would see — and `scrollHeight - clientHeight` bounds the loop so a page that
 * grows cannot make this run forever.
 */
const bodyScrollHeight = report.pageHeight ?? 0;
const bodyViewport = report.bodyViewportHeight ?? 0;
const screens = Math.max(1, Math.ceil(bodyScrollHeight / Math.max(bodyViewport, 1)));
await shoot(`${section}-00.png`);
for (let n = 1; n < Math.min(screens, 8); n += 1) {
  await evaluate(`(() => { const b = document.querySelector(".settings"); if (b) b.scrollTop = ${n} * ${bodyViewport}; return true; })()`);
  await sleep(500);
  await shoot(`${section}-${String(n).padStart(2, "0")}.png`);
}
await evaluate(`(() => { const b = document.querySelector(".settings"); if (b) b.scrollTop = 0; return true; })()`);

const summary = { section, viewport: size, url: uiUrl, outDir, ...report };
console.log("\n" + JSON.stringify(summary, null, 2));
console.log(`\npictures: ${outDir}/${section}-00.png … (${Math.min(screens, 8)} screenfuls of ${screens})`);
if (!keep) stopAll();
