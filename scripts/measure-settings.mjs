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
 * | **verdict census** (`verdicts`) | whether every row resolved itself — rows, how many carry one of the two verdicts, the Ready/Not-ready split, any *third* word a row is using, rows carrying more than one chip, and any button on the page that asks the user to find out a state. It exists because the page used to open with thirty-eight rows reading "Not checked yet" and a *Check* button on each, and that is a property no pixel number can see |
 * | **row anatomy** (`anatomy`) | the agent row's own geometry — the name's size and weight, the left edge it shares with its line, and the **spread** of the chip column's right edge and the controls column's right edge across every row. It exists because the round before this one optimised a *character count* and made the page worse to read: "the name leads" and "the chips line up" are claims about pixels, and a character budget cannot falsify either |
 *
 * A row is defined as an element carrying one of the row classes this pane draws — see `ROW_SELECTOR`.
 * "Above the fold" counts rows whose *top* is inside the scrolling body's viewport, which is the honest
 * reading of "a user sees this without scrolling". `anatomy` measures the agent rows specifically (the
 * `settings__agent` class, which every row of all three lists carries) and reports the columns as a spread,
 * because an average would hide the one row that is out of line.
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
import { execFileSync, spawn } from "node:child_process";
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
    // **`ENVOYCODER_WARM_AGENTS=0`: the instrument must not pull the trigger.**
    //
    // This tool drives the *production* entry point, which by default looks at what each ready agent publishes
    // in the background — a pass that starts the owner's own coding agents, one at a time, and is right for a
    // product and wrong for a measurement. Measuring pixels must not launch anybody's CLI, and the roster this
    // page renders is complete either way: the deep facts are *properties* with a time, not the verdicts this
    // tool counts. The switch and its reasoning are `warmAgents()` in `apps/desktop/src/daemon/main.ts`.
    env: {
      ...process.env,
      ENVOYMESH_HOME: home,
      ENVOYCODER_DAEMON_PORT: String(daemonPort),
      ENVOYCODER_WARM_AGENTS: "0",
    },
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

/**
 * **How many processes the daemon has as children, right now** — the measurement of *"loading the page spawns
 * nothing"*, taken on the real thing rather than in a test double.
 *
 * The daemon is the process that would start an agent: `spawn` for a launch, `execFile` for a login shell, and
 * an ACP session either way. So its child list is the honest instrument, and it is read twice — once before a
 * single request has been made for this page, and once after the page has settled — so the answer is a
 * *difference* rather than a snapshot that some unrelated earlier work could satisfy.
 *
 * `pgrep -P` rather than `ps`: it is one call, it exits non-zero when there are none (which is the answer we
 * want), and it needs no parsing of a table whose columns differ between platforms.
 *
 * **What this cannot see, printed rather than implied:** the daemon is started with `ENVOYCODER_WARM_AGENTS=0`
 * (see the spawn above), because this tool drives the production entry point and the production entry point
 * looks at what every ready agent publishes in the background. That pass starts real agents on the owner's
 * machine, one at a time, on purpose — and a *measurement* must not pull that trigger. So what this number
 * measures is the page's own behaviour: the requests it makes on load, and what they cost.
 */
function daemonChildren() {
  try {
    const out = execFileSync("pgrep", ["-P", String(daemon.pid)], { encoding: "utf8" });
    return out.split("\n").filter((line) => line.trim() !== "").length;
  } catch {
    // `pgrep` exits 1 when nothing matched, which is the common and correct case.
    return 0;
  }
}
const childrenBeforePage = daemonChildren();

console.log(`walk: Settings → ${section}`);
console.log(`  Settings: ${await press("Settings")}`);
console.log(`  ${sectionTitle[section] ?? section}: ${await press(sectionTitle[section] ?? section)}`);
await sleep(1200);
const childrenAfterPage = daemonChildren();
console.log(`  daemon child processes: ${childrenBeforePage} before the page, ${childrenAfterPage} after`);

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
 * `--open-aria "<prefix>"` — press **every** control whose accessible name starts with the prefix.
 *
 * The Agents page needs this one too, and for the reason the fix block exists: a Not-ready row's way out is
 * *inside* its disclosure, and eight rows' worth of disclosures is a different page from the one that opens.
 * Matching on the accessible name is what makes it precise — every Not-ready chip carries
 * `Not ready for <agent>`, so the prefix picks the rows that have a fix and leaves the Ready rows closed.
 */
const openAria = flag("open-aria");
if (openAria !== undefined) {
  const pressed = await evaluate(`(() => {
    const prefix = ${JSON.stringify(openAria)};
    const hits = [...document.querySelectorAll("button, [role=button]")].filter((node) =>
      (node.getAttribute("aria-label") ?? "").startsWith(prefix));
    for (const hit of hits) hit.click();
    return hits.length;
  })()`);
  console.log(`  panels opened by aria prefix "${openAria}": ${pressed}`);
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

  /**
   * **The fix block, as geometry and contrast** — the numbers behind *"highlight the info on each agent …
   * we want to highlight it and let user know how to resolve it."*
   *
   * Empty when no disclosure is open, which is the honest answer for a closed page rather than a zero that
   * reads like a failure. With --open-aria "Not ready for" it reports what the highlight actually is: the
   * command's contrast on the block's own surface (the composited background, via bgOf), whether
   * any command overflows its block, and the Copy control's rendered size — a 24px target, or a squeezed one.
   */
  const fixBlocks = [...body.querySelectorAll(".settings__agent-fix")];
  const fixParts = fixBlocks.flatMap((block) => [...block.querySelectorAll("*")]);
  const fixContrast = fixParts
    .filter((node) => ownText(node).length > 0 && node.children.length === 0)
    .map((node) => ({
      cls: node.className,
      sample: ownText(node).slice(0, 50),
      size: Math.round(parseFloat(getComputedStyle(node).fontSize) * 10) / 10,
      ratio: ratio(getComputedStyle(node).color, bgOf(node)),
    }));
  const copies = fixBlocks.flatMap((block) => [...block.querySelectorAll(".settings__agent-copy")]);
  // The press that runs the fix. Measured for the same reason the Copy control is: a block that showed a command
  // and offered no way to run it would still measure "6 blocks, 6 commands" and read as complete.
  const runs = fixBlocks.flatMap((block) => [...block.querySelectorAll(".settings__agent-fix-run button")]);
  const fix = {
    blocks: fixBlocks.length,
    commands: fixBlocks.reduce((n, block) => n + block.querySelectorAll(".settings__agent-command").length, 0),
    copyButtons: copies.length,
    runButtons: runs.length,
    commandsOverflowing: fixParts.filter(
      (node) => node.classList.contains("settings__agent-command")
        && node.scrollWidth > Math.ceil(node.getBoundingClientRect().width) + 1,
    ).length,
    // The smallest Copy target on the page, and whether its label is squeezed inside it — the two ways a
    // control in a fixed-height row fails quietly.
    copyHeight: copies.length === 0 ? 0 : Math.min(...copies.map((n) => Math.round(n.getBoundingClientRect().height))),
    copySqueezed: copies.filter(
      (n) => n.scrollWidth > Math.ceil(n.getBoundingClientRect().width) + 1,
    ).length,
    contrast: {
      worst: fixContrast.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 4),
      below45: fixContrast.filter((c) => c.ratio < 4.5).length,
    },
  };

  /**
   * **The row's anatomy, as geometry.** The fifth number this tool did not have, and the reason it exists:
   * "the chips line up down the page" and "the name leads" are claims about *pixels*, and the previous round
   * of this page was judged on a character count — which is a proxy for "crowded" that made the page it
   * proxied worse. So the columns are measured rather than described:
   *
   *   * **the name's left edge against its line's** — they must share one, or the row is not a block;
   *   * **the chips' right edge and the controls' right edge, as a spread across rows** — a chip that is
   *     right-aligned inside its own row only lines up if every row's controls column is the same width, so
   *     this number is what proves the fixed track in the stylesheet is doing its job;
   *   * **the name's own font size and weight**, because "the name leads" is nothing else;
   *   * **wrapping, squeezed buttons and the controls' natural width** — a controls column that is too narrow
   *     for a row's buttons does not overflow, it either stacks them or squeezes a label inside a 24px box,
   *     and both are invisible in a row height.
   *
   * The unit is a CSS pixel of a real layout, and the row list is the settings__agent class — the one class every row
   * of every list on this page carries.
   */
  const agentRows = [...body.querySelectorAll(".settings__agent")];
  const round1 = (v) => Math.round(v * 10) / 10;
  /** min / max / spread / standard deviation of a list of numbers. Null when there is nothing to measure. */
  const spreadOf = (values) => {
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
    return { n: values.length, min: round1(min), max: round1(max), spread: round1(max - min), sd: round1(sd) };
  };
  // Boxes, one per row: null where a row has no such element (an empty state has no name). Filtering the nulls
  // out *inside* the rows array would shift every later row's geometry onto the wrong row — a measurement bug
  // that reads as an alignment finding.
  const boxesOf = (els) => els.map((el) => (el ? el.getBoundingClientRect() : null));
  const some = (boxes) => boxes.filter(Boolean);
  const edges = (boxes, side) => spreadOf(some(boxes).map((b) => b[side]));
  const nameEls = agentRows.map((r) => r.querySelector(".settings__agent-name"));
  const lineEls = agentRows.map((r) => r.querySelector(".settings__agent-line"));
  // The chip column's edge is the **last** chip of the row: the state chip is rendered last, so verdict chips
  // hang inward from it and the state column owns one constant right edge.
  const chipEls = agentRows.map((r) => {
    const chips = [...r.querySelectorAll(".chip")];
    return chips[chips.length - 1] ?? null;
  });
  const actEls = agentRows.map((r) => r.querySelector(".settings__agent-actions"));
  const nameBoxes = boxesOf(nameEls);
  const lineBoxes = boxesOf(lineEls);
  const chipBoxes = boxesOf(chipEls);
  const actBoxes = boxesOf(actEls);
  const nameStyleOf = nameEls.find(Boolean);
  const lineStyleOf = lineEls.find(Boolean);
  const heightsOf = (boxes) => some(boxes).map((b) => Math.round(b.height));
  const tallerThanOneLine = (hs) => hs.filter((h) => h > 28).length;
  /**
   * The buttons of the **controls column** — and the selector is '.settings__agent-actions button' rather than
   * '.settings__agent-head button', which is what it was.
   *
   * The difference is one control and it is not cosmetic: a **Not-ready chip is a '<button>'** (it opens the
   * row's disclosure), and it lives inside the head, so the old selector counted the verdict chip as one of the
   * row's controls. 'actionsNaturalWidth' was therefore the chip plus the buttons — measured at 191px against a
   * 144px track, which reads as "the controls do not fit" and is not true. The E2E test
   * ('settings-row-anatomy.e2e.test.ts') failed on that number, which is how it was found: a metric that
   * silently started measuring a different column.
   */
  const buttonsOf = (row) => [...row.querySelectorAll(".settings__agent-actions button")];
  const anatomy = {
    name: nameStyleOf
      ? {
          fontSize: round1(parseFloat(getComputedStyle(nameStyleOf).fontSize)),
          fontWeight: getComputedStyle(nameStyleOf).fontWeight,
        }
      : null,
    line: lineStyleOf ? { fontSize: round1(parseFloat(getComputedStyle(lineStyleOf).fontSize)) } : null,
    nameLeft: edges(nameBoxes, "left"),
    lineLeft: edges(lineBoxes, "left"),
    /** The largest gap between a name's left edge and its own line's — 0 is the property the page claims. */
    nameVsLine: nameBoxes.length === 0
      ? null
      : round1(Math.max(...nameBoxes.map((b, i) => (b && lineBoxes[i] ? Math.abs(b.left - lineBoxes[i].left) : 0)))),
    chipRight: edges(chipBoxes, "right"),
    actionRight: edges(actBoxes, "right"),
    propsHeight: Math.max(...heightsOf(boxesOf(agentRows.map((r) => r.querySelector(".settings__agent-props")))), 0),
    actionsHeight: Math.max(...heightsOf(actBoxes), 0),
    rowsWithWrappedChips: tallerThanOneLine(
      heightsOf(boxesOf(agentRows.map((r) => r.querySelector(".settings__agent-props")))),
    ),
    rowsWithWrappedButtons: tallerThanOneLine(heightsOf(actBoxes)),
    squeezedButtons: agentRows.reduce(
      (sum, r) => sum + buttonsOf(r).filter((b) => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().height > 26).length,
      0,
    ),
    /** The controls column's widest natural width: what the fixed track has to be, measured rather than guessed. */
    actionsNaturalWidth: agentRows.length === 0
      ? null
      : Math.max(...agentRows.map((r) => {
          const bs = buttonsOf(r);
          return bs.reduce((sum, b) => sum + Math.round(b.getBoundingClientRect().width), 0) + Math.max(0, bs.length - 1) * 8;
        })),
    perRow: agentRows.map((r, i) => ({
      cls: r.className.split(" ").filter((c) => c.startsWith("setting")).join(".") || r.tagName,
      h: Math.round(r.getBoundingClientRect().height),
      chars: ownChars(r).length,
      nameLeft: nameBoxes[i] ? round1(nameBoxes[i].left) : null,
      lineLeft: lineBoxes[i] ? round1(lineBoxes[i].left) : null,
      chipRight: chipBoxes[i] ? round1(chipBoxes[i].right) : null,
      actionRight: actBoxes[i] ? round1(actBoxes[i].right) : null,
      text: ownChars(r).slice(0, 90),
    })),
  };

  /**
   * **The verdict census** — the number that answers the owner's report directly.
   *
   * *"I don't want user to guess, to check if we can do that."* The page used to open with thirty-eight rows
   * reading *"Not checked yet"* and a *Check* button on each, and whether a row knew its own state was
   * therefore not a property any measurement could report. It is one now, and these are its terms:
   *
   *   * 'rows' / 'withChip' / 'withoutChip' — **every row must carry a verdict the moment the page opens**,
   *     with nothing pressed. 'withoutChip' is the number that must be zero, and it is the one a regression
   *     would move first;
   *   * 'ready' / 'notReady' — the two words, counted. The pair is the vocabulary: any third word shows up in
   *     'otherWords' rather than hiding;
   *   * 'multipleChips' — the mandate's *"a row renders at most one chip"*, counted on the page rather than
   *     asserted in a test that might be looking at a different row;
   *   * 'checkControls' — buttons **inside a row** whose label asks the user to find out a state. The old page
   *     had one per catalogue row and each press left that row unknowing; the number that must be zero is this
   *     one.
   *   * 'pageControls' — the same words on a button that is **not** in a row, and the reason the two are counted
   *     apart. The Agents page has one page-level *Check again*: it re-asks the machine where the user's programs
   *     are, after the user installed something in their own terminal, and it changes no row's state from known
   *     to unknown. Folding it into 'checkControls' would report the defect metric as failed by a control that
   *     is not the defect, and excluding label matches from it wholesale would let a real per-row regression
   *     hide — so a reader gets both numbers, and the exception is named rather than silent.
   */
  const verdictWords = ["Ready", "Not ready"];
  const chipsOf = (row) => [...row.querySelectorAll(".chip")];
  /**
   * **A row, not a receptacle.** 'settings__agent' is the class every row of all three lists carries *and* the
   * class the two empty states carry, and an empty state has no name, no chip and nothing to have a verdict
   * about. Counting them in 'withoutChip' would make the headline number report a failure every time a user
   * has not declared an agent yet — a proxy metric that got *worse* as the measurement got more honest, which
   * is the exact lesson this file's own header records. So the two are separated, and the empty states are
   * still reported: they are content on the page, and they are not rows.
   */
  const verdictRows = agentRows.filter((r) => r.querySelector(".settings__agent-head"));
  const emptyStates = agentRows.length - verdictRows.length;
  const verdicts = {
    rows: verdictRows.length,
    withChip: verdictRows.filter((r) => r.querySelector(".settings__agent-state")).length,
    withoutChip: verdictRows.filter((r) => !r.querySelector(".settings__agent-state")).length,
    ready: verdictRows.filter((r) => r.querySelector(".settings__agent-state")?.textContent === verdictWords[0]).length,
    notReady: verdictRows.filter((r) => r.querySelector(".settings__agent-state")?.textContent === verdictWords[1]).length,
    otherWords: [...new Set(
      verdictRows
        .map((r) => r.querySelector(".settings__agent-state")?.textContent ?? "")
        .filter((word) => word !== "" && !verdictWords.includes(word)),
    )],
    multipleChips: verdictRows.filter((r) => chipsOf(r).length > 1).length,
    // Empty states, counted for completeness rather than folded into the row count. Their presence is why
    // 'rows + emptyStates ===' the number of 'settings__agent' elements, which is a check a reader can do.
    emptyStates,
    checkControls: [...body.querySelectorAll("button")]
      .filter((b) => /check/i.test(b.textContent ?? "") && rows.some((row) => row.contains(b)))
      .map((b) => (b.textContent ?? "").trim()),
    pageControls: [...body.querySelectorAll("button")]
      .filter((b) => /check/i.test(b.textContent ?? "") && !rows.some((row) => row.contains(b)))
      .map((b) => (b.textContent ?? "").trim()),
  };

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
    fix,
    anatomy,
    verdicts,
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

const summary = {
  section,
  viewport: size,
  url: uiUrl,
  outDir,
  // The page's own cost, as a difference: what the daemon was running before this page asked for anything,
  // and what it was running once the page had settled. Both zero is the property; the *pair* is what makes it
  // a measurement rather than a coincidence.
  daemonChildren: { before: childrenBeforePage, after: childrenAfterPage },
  ...report,
};
console.log("\n" + JSON.stringify(summary, null, 2));
console.log(`\npictures: ${outDir}/${section}-00.png … (${Math.min(screens, 8)} screenfuls of ${screens})`);
if (!keep) stopAll();
