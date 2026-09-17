/**
 * **Drive the Sign-in button in a real window, against a real daemon, with an agent that really refuses.**
 *
 * ## The gap this closes, and why nothing else could
 *
 * `docs/settings-parity.md` §7.13 measured the agents page in a real window and reported **0 sign-in
 * buttons** — honestly, because no agent on that machine reports `needs-signin`: `cursor-agent` is either
 * absent or already signed in, and the control is rendered for that state alone rather than present but
 * dead. So the only evidence for the button was a jsdom test with a fabricated summary, which proves what
 * the *component* does with a state and nothing about whether the state is reachable.
 *
 * It is reachable, deterministically, because the condition is producible on purpose: the scripted agent in
 * `apps/desktop/test/fixtures/fake-acp-agent.mjs` advertises one `authMethods` entry and refuses
 * `session/new` with `-32000 Authentication required … call authenticate() with methodId …` until it is
 * given one — the measured behaviour of `cursor-agent acp`, on demand. What was missing was not a fixture
 * but a *window*: every existing use of the fixture injects a launch resolver into `startCoderDaemon`, which
 * a real browser cannot do.
 *
 * ## What this script does instead, and the three things it refuses to fake
 *
 *   1. **Real daemon, real search path.** It boots `apps/desktop/src/daemon/main.ts` as a child process on an
 *      isolated `ENVOYMESH_HOME` and a distinct port, with a directory holding an executable named
 *      `claude-agent-acp` **prepended to `PATH`**. That is the whole mechanism and it fakes nothing: the
 *      daemon finds the program the way it finds any program (`findBinary` over the resolved search path),
 *      the probe starts it the way it starts any agent (`AcpClient.start`), and `claudecode`'s row reports
 *      `needs-signin` because an agent really refused a session.
 *      `claude-agent-acp` is chosen because it is absent on a normal machine, so the fixture cannot be
 *      shadowed by a real install the way a fixture named `cursor-agent` would be.
 *   2. **Real window.** Vite serves the app on its own port with `VITE_ENVOYDEV_DAEMON_PORT` pointing at the
 *      isolated daemon, and headless Chrome is driven over CDP with the target matched **by URL** — the rule
 *      `audit-ui.mjs` records, and the reason a previous measurement silently reported another app's numbers.
 *   3. **The press is the window's, not ours.** The probe that plants the state is a socket call
 *      (`coder.probeSessionOptions`, the same frame the composer sends); the **sign-in** is a real click on
 *      the rendered button, and what this reads back afterwards is the sentence the window rendered in its
 *      own `role="status"` element. The daemon is then asked what it recorded, which is how "the click did
 *      the work" is a fact rather than an inference from the button disappearing.
 *
 * ## What it leaves behind
 *
 * Two PNGs — before the press and after it — in `--out`, which defaults to a **stable** path
 * (`<tmp>/envoydev-signin-window`) rather than a fresh random directory, because the picture is for a
 * human and a path nobody can guess is a picture nobody opens. The run directory is created fresh each time
 * so a stale picture cannot be mistaken for this run's. Nothing is written inside the repository: a PNG
 * committed by accident is worse than one in the temp directory, and `daemon.log` lives beside the pictures
 * for the case where a check fails.
 *
 * One JSON summary goes to stdout. Exit code 0 means every assertion below held; anything else means the
 * feature is not reachable on this machine and the reason is printed.
 *
 * ```
 * npm run signin:window
 * npm run signin:window -- --out /tmp/pictures --keep   # keep the temp home and the daemon's scratch state
 * ```
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const FIXTURE = join(root, "apps/desktop/test/fixtures/fake-acp-agent.mjs");
const DAEMON_ENTRY = join(root, "apps/desktop/src/daemon/main.ts");

/** The method this script's fixture advertises, and the one the press should therefore send. */
const METHOD_ID = "fake_login";

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name) => process.argv.includes(`--${name}`);
const keep = has("keep");
/**
 * **A stable default, wiped at the start of every run.**
 *
 * `mkdtempSync` would be the obvious default and it is wrong here: the whole point of the pictures is that
 * a human opens them, and a random path per run is a path nobody can find twice. Cleaning first is what
 * makes it safe — a stale picture left from a previous run cannot be mistaken for this one's evidence.
 */
const outDir = resolve(flag("out") ?? join(tmpdir(), "envoydev-signin-window"));
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

/** A free TCP port, asked of the OS rather than guessed — two runs must not collide. */
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

/** Everything this script started, so one exit path stops all of it. */
const children = [];
function track(child, label) {
  children.push({ child, label });
  return child;
}
function stopAll() {
  for (const { child } of children.splice(0)) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** Fail loudly and leave nothing running. */
function fail(message, extra = {}) {
  console.error(`\n✗ ${message}`);
  for (const [key, value] of Object.entries(extra)) console.error(`  ${key}: ${JSON.stringify(value)}`);
  stopAll();
  process.exit(1);
}

const checks = [];
/** Record one assertion with what it measured, so the report is evidence rather than a claim. */
function check(name, ok, measured) {
  checks.push({ check: name, ok, measured });
  console.log(`${ok ? "✓" : "✗"} ${name}${measured === undefined ? "" : ` — ${JSON.stringify(measured)}`}`);
  return ok;
}

process.on("exit", stopAll);

/* ────────────────────── the isolated home, the fixture, and the daemon ────────────────────── */

const home = mkdtempSync(join(tmpdir(), "envoydev-signin-home-"));
const binDir = join(home, "bin");
mkdirSync(binDir, { recursive: true });
const daemonPort = await freePort();
const vitePort = await freePort();
const debugPort = await freePort();
const daemonLog = join(outDir, "daemon.log");

/**
 * The program the daemon will find under the name `claude-agent-acp`.
 *
 * A shell wrapper rather than a copy, so the fixture stays the one the tests use and this script cannot
 * drift from it. `FAKE_ACP_REQUIRE_AUTH` is exported **here** rather than set on the daemon's environment,
 * which is the point: the daemon hands every child its own environment, so a variable set on the wrapper is
 * the fixture's own condition and nothing about the daemon's launch path is bent to arrange it.
 */
const wrapper = join(binDir, "claude-agent-acp");
writeFileSync(
  wrapper,
  `#!/bin/sh\nFAKE_ACP_REQUIRE_AUTH=${METHOD_ID} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(FIXTURE)} "$@"\n`,
);
chmodSync(wrapper, 0o755);

const daemon = track(
  spawn(process.execPath, ["--import", "tsx", DAEMON_ENTRY], {
    cwd: root,
    env: {
      ...process.env,
      ENVOYMESH_HOME: home,
      ENVOYDEV_DAEMON_PORT: String(daemonPort),
      // The one line that makes a real daemon find a scripted agent. Prepended, so it wins over anything a
      // login shell answers with — and the name is one no real install occupies.
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  }),
  "daemon",
);
let daemonOutput = "";
daemon.stdout.on("data", (chunk) => {
  daemonOutput += String(chunk);
});
daemon.stderr.on("data", (chunk) => {
  daemonOutput += String(chunk);
});
writeFileSync(daemonLog, "");

/** The daemon's claim file is written **after** it is listening, which is what makes it a readiness signal. */
const claimFile = join(home, "EnvoyDev", "daemon.json");
async function waitForClaim() {
  for (let i = 0; i < 120; i += 1) {
    if (existsSync(claimFile)) {
      try {
        const claim = JSON.parse(readFileSync(claimFile, "utf8"));
        if (claim.port === daemonPort) return claim;
      } catch {
        /* half-written */
      }
    }
    if (daemon.exitCode !== null) fail("the daemon exited before it served", { output: daemonOutput.slice(-2000) });
    await sleep(250);
  }
  return null;
}
const claim = await waitForClaim();
writeFileSync(daemonLog, daemonOutput);
if (!claim) fail("the daemon never published a claim", { daemonLog });
console.log(`daemon: ws://127.0.0.1:${daemonPort}/ws (home ${home})`);

/* ────────────────────── a real socket client, the way a window talks ────────────────────── */

let rpcId = 0;
const rpcPending = new Map();
let rpcSocket;
async function connectRpc() {
  rpcSocket = new WebSocket(`ws://127.0.0.1:${daemonPort}/ws`);
  await new Promise((res, rej) => {
    rpcSocket.once("open", res);
    rpcSocket.once("error", rej);
  });
  rpcSocket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.id && rpcPending.has(message.id)) rpcPending.get(message.id)(message);
  });
}
async function call(method, params = {}) {
  rpcId += 1;
  const id = `s${rpcId}`;
  const answer = await new Promise((res, rej) => {
    rpcPending.set(id, res);
    rpcSocket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => rej(new Error(`${method} did not answer within 120s`)), 120_000);
  });
  if (answer.error) throw new Error(`${method} refused: ${answer.error.message}`);
  return answer.result;
}
await connectRpc();

/* ────────────────────── the probe, which is what makes the state reachable ────────────────────── */

/**
 * `coder.probeSessionOptions` is the **production** trigger, not a test hook: it is the method the composer
 * sends when it needs to know what an agent publishes, and it is what writes `AgentAuthObservation`. Sent
 * over a real socket, against the real fixture process, it is the same frame any client would send.
 *
 * **Its `outcome` is about session *options*, not about authentication**, and for this agent the honest
 * outcome is a failure — an agent that will not open a session has told us nothing about what it offers.
 * What it did establish is the *auth* record, which is a separate fact and the one the button reads; the
 * assertion below is on that, through `coder.listHarnesses`, and the probe's own sentence is checked only
 * for the fixture's refusal travelling through it verbatim.
 */
const probe = await call("coder.probeSessionOptions", { harness: "claudecode", force: true });
check(
  "the daemon started the fixture, and its refusal travelled back in the agent's own words",
  String(probe.detail).includes("Authentication required") && String(probe.detail).includes(METHOD_ID),
  { outcome: probe.outcome, detail: String(probe.detail).split(" [envoydev.key]")[0] },
);

const listed = await call("coder.listHarnesses");
const claude = listed.harnesses.find((harness) => harness.id === "claudecode");
if (
  !check(
    "`coder.listHarnesses` reports needs-signin, with the method the fixture advertised",
    claude?.auth?.state === "needs-signin" && claude?.auth?.methodId === METHOD_ID,
    claude?.auth,
  )
) {
  fail("the daemon did not record `needs-signin`, so the button cannot be rendered", {
    auth: claude?.auth,
    daemonLog,
  });
}
check(
  "and the agent's program is `ready`, so the two facts are separate rather than one",
  claude?.availability?.state === "ready",
  claude?.availability,
);

/* ────────────────────── vite, serving the real UI at the isolated daemon ────────────────────── */

const uiUrl = `http://127.0.0.1:${vitePort}/`;
const vite = track(
  spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--port", String(vitePort), "--strictPort"], {
    cwd: join(root, "apps/desktop"),
    env: { ...process.env, VITE_ENVOYDEV_DAEMON_PORT: String(daemonPort) },
    stdio: ["ignore", "pipe", "pipe"],
  }),
  "vite",
);
let viteOutput = "";
vite.stdout.on("data", (chunk) => {
  viteOutput += String(chunk);
});
vite.stderr.on("data", (chunk) => {
  viteOutput += String(chunk);
});
async function waitForUi() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(uiUrl);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    if (vite.exitCode !== null) fail("vite exited before it served", { output: viteOutput.slice(-2000) });
    await sleep(250);
  }
  return false;
}
if (!(await waitForUi())) fail("vite never answered", { viteOutput: viteOutput.slice(-2000) });
console.log(`window: ${uiUrl} (dashboard against daemon ${daemonPort})`);

/* ────────────────────── headless Chrome, matched by URL ────────────────────── */

const profile = mkdtempSync(join(tmpdir(), "envoydev-signin-chrome-"));
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
      "--window-size=1440,900",
      uiUrl,
    ],
    { stdio: "ignore" },
  ),
  "chrome",
);

async function chromeTarget() {
  // Matched **by URL**, the rule `audit-ui.mjs` documents at length: a debugging port can outlive the
  // browser that opened it, and a measurement of another application is worse than no measurement.
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const list = await res.json();
      const page = list.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl && String(t.url).startsWith(uiUrl),
      );
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return null;
}
const cdpUrl = await chromeTarget();
if (!cdpUrl) fail("chrome never exposed a page at this URL — refusing to measure another application", { uiUrl });

const cdp = new WebSocket(cdpUrl);
await new Promise((res) => cdp.once("open", res));
let cdpId = 0;
const cdpPending = new Map();
cdp.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.id && cdpPending.has(message.id)) cdpPending.get(message.id)(message);
});
const send = (method, params = {}) =>
  new Promise((res) => {
    cdpId += 1;
    cdpPending.set(cdpId, res);
    cdp.send(JSON.stringify({ id: cdpId, method, params }));
  });
const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) {
    throw new Error(`the page threw: ${res.result.exceptionDetails.text} ${res.result.exceptionDetails.exception?.description ?? ""}`);
  }
  return res.result?.result?.value;
};
const shot = async (name) => {
  const png = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = join(outDir, name);
  writeFileSync(path, Buffer.from(png.result.data, "base64"));
  return path;
};

await send("Page.enable");
await send("Runtime.enable");
// The window attaches to the daemon, learns its methods and paints. Polled for the thing we need rather
// than slept for, because a fixed sleep is how a measurement becomes a flake.
const clickByText = async (wanted) =>
  evaluate(`(() => {
    const wanted = ${JSON.stringify(wanted)};
    // Interactive elements first: these lists are one button inside one li, and a selector list that
    // includes li matches the wrapper before the button inside it (measured — see preview-ui.mjs).
    const interactive = "button, [role=button], a, input, select, textarea, .task-row, .project__header";
    const matches = (list) => list.filter((n) => (n.textContent ?? "").trim().includes(wanted)
      || (n.getAttribute?.("aria-label") ?? "") === wanted
      || (n.getAttribute?.("title") ?? "") === wanted);
    const hit = matches([...document.querySelectorAll(interactive)])[0]
      ?? matches([...document.querySelectorAll("li")])[0];
    if (!hit) return "NOT FOUND: " + wanted;
    hit.scrollIntoView({ block: "center" });
    hit.click();
    return "clicked <" + hit.tagName + ">";
  })()`);

async function openAgentsPage() {
  for (let i = 0; i < 40; i += 1) {
    if (await evaluate(`document.querySelector(".settings__catalog") !== null`)) return true;
    const settings = await evaluate(`!!document.querySelector(".settings-layout")`);
    if (!settings) {
      const opened = await clickByText("Settings");
      if (String(opened).startsWith("NOT FOUND")) {
        await sleep(400);
        continue;
      }
    } else {
      const agents = await clickByText("Agents");
      if (String(agents).startsWith("NOT FOUND")) {
        await sleep(400);
        continue;
      }
    }
    await sleep(500);
  }
  return false;
}

if (!(await openAgentsPage())) fail("the agents page never rendered", { uiUrl });

/** The rendered Sign-in button, as the window drew it — not as our fixtures describe it. */
const buttonBefore = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll("button")];
  const found = buttons.find((b) => (b.textContent ?? "").trim() === "Sign in");
  if (!found) return null;
  const row = found.closest(".settings__agent");
  return {
    label: found.textContent.trim(),
    title: found.getAttribute("title"),
    disabled: found.disabled,
    rowText: (row?.textContent ?? "").slice(0, 400),
    signInButtons: buttons.filter((b) => (b.textContent ?? "").trim() === "Sign in").length,
  };
})()`);

if (!check("a real window renders the Sign-in button for this agent", buttonBefore !== null, buttonBefore)) {
  fail("no Sign-in button in the rendered window — the state did not reach the paint", { uiUrl });
}
check(
  "the row it sits in reads `Needs a sign-in`",
  String(buttonBefore.rowText).includes("Needs a sign-in"),
  buttonBefore.rowText.slice(0, 120),
);
const beforePng = await shot("before-press.png");

/**
 * **The same measurement tool §7.13's numbers came from, on the same page.**
 *
 * `scripts/audit-ui.mjs` reports the agent page's numbers and now counts `Needs a sign-in` chips and
 * Sign-in buttons. It opens its **own** Chrome on its own debugging port, so it sees a fresh page — which is
 * why it runs here, *before* the press: after the press the daemon records `ready` and the control is
 * correctly gone, and measuring a state the press just removed would be measuring the wrong thing. Opt-in
 * (`--audit`), because it costs a second browser and a few seconds.
 */
let audit = null;
if (has("audit")) {
  const auditPort = await freePort();
  const auditRun = spawn(
    process.execPath,
    [join(here, "audit-ui.mjs"), uiUrl, "--clicks", "Settings|Agents", "--port", String(auditPort)],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let auditOut = "";
  let auditErr = "";
  auditRun.stdout.on("data", (chunk) => {
    auditOut += String(chunk);
  });
  auditRun.stderr.on("data", (chunk) => {
    auditErr += String(chunk);
  });
  const auditCode = await new Promise((res) => auditRun.once("exit", res));
  try {
    // `audit-ui.mjs` narrates its click walk on stdout before printing the JSON, so the document starts at
    // the first line that is exactly `{` — the measured numbers must not be lost to a log line, and parsing
    // the whole stream would throw on it.
    const jsonAt = auditOut.split("\n").findIndex((line) => line.trim() === "{");
    if (jsonAt < 0) throw new Error(`no JSON document in ui:audit's output: ${auditOut.slice(0, 200)}`);
    const parsed = JSON.parse(auditOut.split("\n").slice(jsonAt).join("\n"));
    audit = {
      exitCode: auditCode,
      rows: parsed.catalog.rows,
      distinctStates: [...new Set(parsed.catalog.states ?? [])],
      needsSignin: parsed.catalog.needsSignin,
      signInButtons: parsed.catalog.signInButtons,
      needsNoInstall: parsed.catalog.needsNoInstall,
      installSteps: parsed.catalog.installSteps,
      addButtons: parsed.catalog.addButtons,
      horizontalOverflow: parsed.horizontalOverflow,
      rowsPerViewport: parsed.catalog.rowsPerViewport,
    };
  } catch (error) {
    audit = { exitCode: auditCode, failed: String(error), stderr: auditErr.slice(-400) };
  }
  check(
    "`ui:audit` measures one `Needs a sign-in` row and one Sign-in button on this page",
    audit?.needsSignin === 1 && audit?.signInButtons === 1,
    audit,
  );
}

/* ────────────────────── the press, and the sentence it produces ────────────────────── */

const pressed = await evaluate(`(() => {
  const found = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Sign in");
  if (!found) return "NOT FOUND";
  found.scrollIntoView({ block: "center" });
  found.click();
  return "pressed";
})()`);
if (String(pressed).startsWith("NOT FOUND")) fail("the button disappeared between measuring and pressing it");

/**
 * The outcome sentence, read out of the element the **component** renders it in (`role="status"`), polled
 * until it is non-empty. This is the measurement the whole script exists for: a sentence a user reads,
 * produced by a real press, about a real agent's refusal and a real authentication.
 */
let sentence = "";
for (let i = 0; i < 120; i += 1) {
  sentence = await evaluate(`(() => {
    const node = [...document.querySelectorAll('[role="status"]')].map((n) => (n.textContent ?? "").trim())
      .filter((text) => text.includes("Claude Code"));
    return node[0] ?? "";
  })()`);
  if (sentence) break;
  await sleep(500);
}
check(
  "the window renders the daemon's outcome sentence after the press",
  sentence.includes("Claude Code") && sentence.includes("session"),
  sentence,
);
const afterPng = await shot("after-press.png");

// And the button is gone, because the agent now opens sessions — the one thing that proves the press did
// something rather than render a sentence about nothing.
const buttonAfter = await evaluate(
  `[...document.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "Sign in").length`,
);
check("the button is gone afterwards, because the agent opened a session", buttonAfter === 0, buttonAfter);

// **The daemon's own record**, which is what makes "the click did the work" a fact: `coder.signInAgent`
// wrote it, and a window that had only *looked* signed in would leave this untouched.
const after = await call("coder.listHarnesses");
const claudeAfter = after.harnesses.find((harness) => harness.id === "claudecode");
check(
  "the daemon recorded `ready`, so the press really signed the agent in",
  claudeAfter?.auth?.state === "ready",
  claudeAfter?.auth,
);

writeFileSync(daemonLog, daemonOutput);

/* ────────────────────── the report ────────────────────── */

const summary = {
  measured: "a real window + a real daemon + the scripted agent, headless Chrome over CDP, target matched by URL",
  uiUrl,
  daemon: { port: daemonPort, home, entry: DAEMON_ENTRY, log: daemonLog },
  fixture: { program: wrapper, methodId: METHOD_ID, script: FIXTURE },
  probe: { outcome: probe.outcome, reason: probe.reason },
  renderedSentence: sentence,
  audit,
  screenshots: { before: beforePng, after: afterPng },
  checks,
  kept: keep,
  tempHome: home,
};
console.log(`\n${JSON.stringify(summary, null, 2)}`);

cdp.close();
rpcSocket.close();
stopAll();
if (!keep) rmSync(home, { recursive: true, force: true, maxRetries: 5 });
process.exit(checks.every((entry) => entry.ok) ? 0 : 1);
