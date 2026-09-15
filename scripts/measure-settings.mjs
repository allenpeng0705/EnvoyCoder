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
 * node scripts/measure-settings.mjs --section agents --theme light
 * node scripts/measure-settings.mjs --section tasks --select "The agent new tasks start with"
 * node scripts/measure-settings.mjs --section general --open "Command Center" --open "Pair a phone"
 * ```
 *
 * `--open "<label>"` presses one more thing before measuring, by the words a user reads, and **may be repeated**:
 * one value per press, in the order given, so a control that lives inside something else can be reached (the
 * titlebar's *Command Center*, then a row inside the palette). The Agents page needs the first form: the page as
 * it *opens* and the page with a group unfolded are two different and equally honest numbers, and a tool that
 * could only report one of them would have its output quoted as if it were the other. And when the presses leave
 * the palette open, the palette's own status line is printed — the place a refused command is read.
 *
 * `--select "<aria-label>"` prints one picker's option texts and which option is selected — the words a user
 * reads in a dropdown, which no pixel number and no verdict census can see.
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

/** Every value given for a flag that may be **repeated** — `--open A --open B` — in the order given. */
const flags = (name) => {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1] !== undefined) values.push(process.argv[i + 1]);
  }
  return values;
};

/** Which settings page to walk into. The sections bar's own labels are what the walk presses. */
const section = flag("section") ?? "agents";

/**
 * `--section work` — **do not walk into Settings at all.**
 *
 * Every number this tool produces was about one screen, because the walk always pressed *Settings* and then a
 * section. The rail, the title bar, the status bar, the palette and the composer were therefore never measured
 * in either palette — and the light palette, which is the newest thing in this sheet, was judged on the settings
 * pane alone. The work surface is what a user looks at while a task runs, and this is how it gets measured: no
 * Settings press, the measure root falls back to the pane (see the report below), and `--open "<task title>"`
 * selects a task so the composer is on screen.
 */
const WORK_SURFACE = "work";

/**
 * `--seed` — put a project and a task in the **isolated** home before the daemon starts.
 *
 * Without it the rail has nothing in it and the work surface has no task to open, which is the honest reason the
 * composer was never measured. Two files, written where the daemon's own store keeps them (`projects.json`,
 * `tasks.json`), so this is the same state a user's own machine has rather than a fixture the window is told
 * about: nothing about the app is stubbed, and the daemon reads them exactly as it reads a real home.
 */
const seed = has("seed");

/**
 * `--theme light` — measure the **light palette**, which is the one nobody has measured.
 *
 * The app sets `document.documentElement.dataset.theme` at boot (`main.tsx`, currently `"dark"`), and every rule
 * that changes with the palette is keyed on that attribute. Setting it here is therefore the same thing the app
 * does, one line earlier — and without this flag the light theme could only ever be *looked* at, which is how it
 * came to render text at a contrast of about 1.0 in places while every dark-mode number stayed green.
 */
const theme = flag("theme") ?? "dark";
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

if (seed) {
  const stateDir = join(home, "EnvoyCoder");
  mkdirSync(stateDir, { recursive: true });
  const projectId = "local::/tmp/envoycoder-measure-repo";
  const at = "2026-09-01T09:00:00.000Z";
  writeFileSync(
    join(stateDir, "projects.json"),
    JSON.stringify(
      [
        {
          id: projectId,
          path: "/tmp/envoycoder-measure-repo",
          label: "measure-repo",
          hostId: "local",
          addedAt: at,
          defaults: { harness: "envoy-harness" },
        },
      ],
      null,
      2,
    ),
  );
  writeFileSync(
    join(stateDir, "tasks.json"),
    JSON.stringify(
      [
        {
          id: `${projectId}::task::1`,
          projectId,
          cwd: "/tmp/envoycoder-measure-repo",
          title: "the task the tool measures",
          harness: "envoy-harness",
          status: "idle",
          createdAt: at,
          updatedAt: at,
        },
      ],
      null,
      2,
    ),
  );
}

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
    // **A task row is a container, and its control is inside it.** The row class is in the interactive list
    // because that is what a user aims at, but the element that *does* something is the select button within
    // it: clicking the container returns "ok" and changes nothing, which is the one outcome a walker must never
    // report. So the innermost control is what gets pressed.
    const target = hit.classList?.contains("task-row") ? (hit.querySelector(".task-row__select") ?? hit) : hit;
    target.click();
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

/**
 * **The theme, applied before anything is pressed.**
 *
 * The walk into Settings does not reload the page, so one assignment is enough — and it is asserted from the page
 * rather than assumed, because a flag that silently did nothing would produce a *dark* measurement labelled light.
 */
if (theme !== "dark") {
  const applied = await evaluate(`(() => {
    document.documentElement.dataset.theme = ${JSON.stringify(theme)};
    return document.documentElement.dataset.theme;
  })()`);
  if (applied !== theme) {
    console.error(`asked for the ${theme} palette and the page reports ${String(applied)} — refusing to measure`);
    process.exit(2);
  }
  await sleep(300);
}

/**
 * `--os-theme light|dark` — **the desktop's preference, which is not the app's theme.**
 *
 * This app forces its own palette (`main.tsx` sets `data-theme`), so the interesting configuration is the one
 * where the two disagree — and it is the common one: a light desktop with this app in its dark palette. A form
 * control that does not inherit `color` takes the *platform's* `buttontext`/`fieldtext` for the platform's
 * scheme, so on a light desktop every control this sheet forgot to colour would draw near-black text on the
 * app's dark fill. Emulated rather than assumed, and asserted from the page, because an emulation that silently
 * did nothing would produce a *dark* measurement labelled light.
 */
const osTheme = flag("os-theme");
if (osTheme !== undefined) {
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: osTheme }],
  });
  await sleep(300);
  const seen = await evaluate(
    `(() => (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"))()`,
  );
  if (seen !== osTheme) {
    console.error(`asked for a ${osTheme} desktop and the page reports ${String(seen)} — refusing to measure`);
    process.exit(2);
  }
  console.log(`  desktop preference: ${seen}`);
}

console.log(
  `walk: ${section === WORK_SURFACE ? "the work surface" : `Settings → ${section}`}` +
    `${theme === "dark" ? "" : ` (${theme} palette)`}`,
);
if (section === WORK_SURFACE) {
  // No Settings press at all: the pane and the rail are what is being measured.
  console.log("  settings: not opened (--section work)");
} else {
  console.log(`  Settings: ${await press("Settings")}`);
  console.log(`  ${sectionTitle[section] ?? section}: ${await press(sectionTitle[section] ?? section)}`);
}
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
for (const step of flags("open")) {
  // **Repeatable, in order**, because a control that only exists inside something else needs two presses: the
  // titlebar's *Command Center*, then a row inside it. One value per press, and each is reported, so a step that
  // silently missed its target is visible in the output rather than implied by what follows.
  console.log(`  ${step}: ${await press(step)}`);
  await sleep(1400);
}

/**
 * **What a command said, when a press left it saying something.**
 *
 * Printed rather than measured: this is the palette's own line, which is where a refused command is read now
 * (the palette stays open for it). Nothing about it is a number — it is the *existence* of a sink that a pixel
 * count cannot see, and a run that presses a command which cannot be honoured is how it is checked in a real
 * window.
 */
const paletteStatus = await evaluate(`(() => {
  const node = document.querySelector(".palette__status");
  const palette = document.querySelector(".palette");
  return {
    text: node ? (node.textContent ?? "") : null,
    open: palette !== null,
  };
})()`);
if (paletteStatus.open) {
  console.log(
    `  palette: still open; status ${paletteStatus.text === null ? "(none)" : JSON.stringify(paletteStatus.text)}`,
  );
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
 * `--select "<aria-label>"` — print **one picker's options**, and which of them is selected.
 *
 * The one thing on this page that no pixel number and no verdict census can see, and the reason it is a flag
 * rather than a one-off: an option's *text* is a claim about the machine — *"(needs installing)"* beside an agent
 * whose bridge is installed — and a claim about the machine cannot be measured by counting rows. §7.26 is the
 * report that made this instrument necessary: five ready catalogued agents read *"(needs installing)"* in a picker
 * while the page behind it called every one of them Ready.
 *
 * It refuses loudly when the label matches nothing, because a flag that silently printed no options is a flag
 * whose next reader reports "the picker is empty" as a fact.
 */
const selectLabel = flag("select");
if (selectLabel !== undefined) {
  const dump = await evaluate(`(() => {
    const wanted = ${JSON.stringify(selectLabel)};
    const node = [...document.querySelectorAll("select")].find(
      (candidate) => (candidate.getAttribute("aria-label") ?? "") === wanted);
    if (!node) {
      return { found: false, labels: [...document.querySelectorAll("select")].map(
        (candidate) => candidate.getAttribute("aria-label") ?? "(no aria-label)") };
    }
    return {
      found: true,
      value: node.value,
      selected: node.selectedIndex,
      options: [...node.options].map((option, at) => ({
        text: option.textContent ?? "",
        value: option.value,
        chosen: at === node.selectedIndex,
      })),
    };
  })()`);
  if (!dump.found) {
    console.error(
      `no select on this page has the aria-label ${JSON.stringify(selectLabel)} — refusing to print an empty ` +
        `picker as a result. Labels here: ${dump.labels.map((label) => JSON.stringify(label)).join(", ") || "(none)"}`,
    );
    process.exit(2);
  }
  // The selection is reported as a **value** as well as a position: `selectedIndex: -1` is the blank control,
  // and a list of option texts cannot show it — a `<select>` whose value matches no option renders nothing
  // selected at all, which is how a stored default agent can silently vanish from the row that states it.
  console.log(
    `\nselect ${JSON.stringify(selectLabel)}: value=${JSON.stringify(dump.value)} selectedIndex=${String(dump.selected)}`,
  );
  for (const option of dump.options) {
    console.log(
      `  ${option.chosen ? "→" : " "} ${JSON.stringify(option.text)}  (value ${JSON.stringify(option.value)})`,
    );
  }
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

  // The settings pane when it is up, the work surface otherwise — section "work" is the second case, and the
  // row-based numbers below are then honest zeros (no settings rows are on screen) while the whole-window
  // contrast scan, which is the point of that walk, covers the rail, the pane, the composer and the palette.
  const body = document.querySelector(".settings") ?? document.querySelector("main.work");
  if (!body) return { error: "neither the settings pane nor the work surface is on screen — the walk did not land" };

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

  /**
   * **Every element that draws text — in the whole window, not in the pane.**
   *
   * Two widenings, both forced by what the earlier scans missed. The narrower list above (chips, hints, commands,
   * details, notes) reported below45: 0 in the light palette while the page still had text nobody could read,
   * because the elements with the worst contrast are the ones a dark-only token sheet takes out: titles, headings,
   * names, labels. And the root of this scan was "the settings pane", so the rail, the title bar, the status bar and the
   * palette had never been measured in either palette at all** — the light theme was judged on one screen out of
   * five, and the surfaces outside it are the ones the owner looks at while a task runs.
   *
   * Each entry carries the surface it was found in, so a failure names *where* rather than only what. surfaceOf
   * is a closed list, and "other" is the honest answer for anything outside it — a fifth surface added later must
   * not be silently unattributed.
   */
  const surfaceOf = (node) => {
    if (node.closest(".palette-backdrop")) return "palette";
    if (node.closest(".titlebar")) return "titlebar";
    if (node.closest(".sidebar")) return "rail";
    if (node.closest(".statusbar")) return "statusbar";
    if (node.closest(".composer")) return "composer";
    if (node.closest(".settings")) return "settings";
    return "other";
  };
  const textOwners = [...document.body.querySelectorAll("*")].filter(
    (node) => node.children.length === 0 && ownText(node).trim().length > 1 && getComputedStyle(node).visibility !== "hidden",
  );
  const contrastAll = textOwners.map((node) => {
    const style = getComputedStyle(node);
    const bg = bgOf(node);
    return {
      cls: typeof node.className === "string" ? node.className : "",
      surface: surfaceOf(node),
      sample: ownText(node).slice(0, 44),
      size: Math.round(parseFloat(style.fontSize) * 10) / 10,
      weight: style.fontWeight,
      // **The pair, not only the number.** A ratio says a reader cannot read something; the two colours say
      // *why*, and whether the fault is the text token or the fill behind it — which is the difference between a
      // one-line fix and a hunt. The pair is what turned a 1.04:1 palette row into "the item inherits its colour
      // from a fill that is not the palette's own".
      color: style.color,
      background: bg,
      ratio: ratio(style.color, bg),
    };
  });
  const worstAll = contrastAll.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 8);
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
    /**
     * **The composer's prose, counted** — because that is the thing the owner complained about, in numbers.
     *
     * *"There are too many texts like … These texts are usless, but make the chats inputting messy."* A character
     * count for the whole pane cannot see four paragraphs appear above the field, so this counts the lines the
     * composer draws under its controls and the characters in them. Zero is the healthy number for a task with
     * nothing running; one is the most a live run is allowed (§7.30).
     */
    composer: {
      present: document.querySelector(".composer") !== null,
      notes: [...document.querySelectorAll(".composer__control-note")].map((node) => ownText(node)),
      /**
       * **The row's geometry**, because "it looks like the reference product" is a claim about boxes.
       *
       * Paseo's composer is a field with one button row under it: the controls at the left, the action at the
       * right, 28px chips with no borders. These numbers say whether this one is that shape — the field's width
       * against the card's, the chips' height, and whether the chips and the send button share a row (their
       * vertical centres within a few pixels).
       */
      fieldWidth: (() => {
        const field = document.querySelector(".composer__input");
        return field === null ? null : Math.round(field.getBoundingClientRect().width);
      })(),
      cardWidth: (() => {
        const card = document.querySelector(".composer__card");
        return card === null ? null : Math.round(card.getBoundingClientRect().width);
      })(),
      chips: [...document.querySelectorAll(".composer__chip")].map((node) => ({
        // **What the chip *shows*, not what is inside it.** A select's text content is every option
        // concatenated — "Default Plan Review" for a mode picker — which is not the value on screen; the
        // instrument would be reporting the wrong fact about a row it is being used to judge.
        label: (() => {
          const select = node.querySelector("select");
          if (select !== null) {
            const shown = (select.selectedOptions?.[0]?.textContent ?? "").trim();
            return (shown === "" ? ownText(node) : shown).slice(0, 24);
          }
          const input = node.querySelector("input");
          if (input !== null) return (input.value !== "" ? input.value : input.placeholder).slice(0, 24);
          return ownText(node).slice(0, 24);
        })(),
        height: Math.round(node.getBoundingClientRect().height),
        // A border is what made the old row read as a form: the reference product draws none.
        border: getComputedStyle(node).borderTopWidth,
      })),
      actionsSameRowAsChips: (() => {
        const chips = [...document.querySelectorAll(".composer__chip")];
        const send = document.querySelector(".composer__toolbar-actions button");
        if (chips.length === 0 || send === null) return null;
        const center = (node) => {
          const box = node.getBoundingClientRect();
          return box.top + box.height / 2;
        };
        return Math.abs(center(chips[0]) - center(send)) <= 4;
      })(),
    },
    // The whole page, in both palettes — see contrastAll for why the narrower list was not enough.
    contrastAll: {
      worst: worstAll,
      below45: contrastAll.filter((c) => c.ratio < 4.5).length,
      sampled: contrastAll.length,
      // **Where the page was looked at**, so a zero can be read for what it covers: a run on a page with no
      // task open has no composer, and "the composer is legible" is not something that run established.
      surfaces: [...new Set(contrastAll.map((c) => c.surface))].sort(),
      below45BySurface: Object.fromEntries(
        [...new Set(contrastAll.map((c) => c.surface))]
          .sort()
          .map((surface) => [surface, contrastAll.filter((c) => c.surface === surface && c.ratio < 4.5).length])
          .filter(([, count]) => count > 0),
      ),
    },
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
  // Which palette these numbers describe — a measurement that does not say is one that gets quoted as the other.
  theme,
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
