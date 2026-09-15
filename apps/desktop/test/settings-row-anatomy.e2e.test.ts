/**
 * **The row anatomy, measured in a real browser** — pixels, not class names.
 *
 * ## Why this is an E2E test and not a DOM assertion
 *
 * The owner's second report was *"can we give more space to each agent and emphasize the Agent name, the status
 * or actions are just properties, Align the texts"*, and the round before it had optimised a **character count**
 * — which is a proxy for "crowded" that made the page *worse to read*. The lesson is not "don't measure"; it is
 * "measure the thing, not a proxy for it". The things here are pixels:
 *
 *   * the **spread** of the name's left edge, of the chips' right edge and of the controls' right edge across
 *     every row on the page — a column is a column only if its edge varies by nothing;
 *   * the name's **rendered font size and weight**, which are what "the name leads" means;
 *   * the **row height**, over every row;
 *   * wrapping and squeezing in the fixed controls track, which a row-height number cannot see.
 *
 * jsdom cannot answer any of them (`getBoundingClientRect()` is all zeros there), so the assertions are made
 * against what `scripts/measure-settings.mjs` reports from headless Chrome over CDP with the target matched
 * **by URL** — the tool the docs quote, driven as a child process so there is one measurement implementation
 * rather than two that can disagree.
 *
 * ## Gated, and loud about it
 *
 * This leg needs `RUN_E2E=1` and a Chrome or Chromium binary, so it is **skipped** in the ordinary suite and
 * prints why. A skipped pixel test is honest; a green one that never looked is exactly the failure this
 * repository keeps paying for. Run it with:
 *
 * ```
 * RUN_E2E=1 npx vitest run apps/desktop/test/settings-row-anatomy.e2e.test.ts
 * ```
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { AGENT_ROW_BUDGET } from "../src/components/settings/density.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
].find((candidate) => existsSync(candidate));

const enabled = process.env.RUN_E2E === "1" && CHROME !== undefined;
if (!enabled) {
  console.log(
    "· settings-row-anatomy: not run — " +
      (process.env.RUN_E2E !== "1"
        ? "set RUN_E2E=1 to drive a real browser"
        : "no Chrome or Chromium on this machine") +
      ". The pixels below are unverified by this run.",
  );
}
const describeWhen = enabled ? describe : describe.skip;

/** The track the stylesheet declares for the controls column: what the buttons have to fit inside. */
const actionsTrack = ((): number => {
  const css = readFileSync(join(root, "apps/desktop/src/styles.css"), "utf8");
  const match = /--settings-agent-actions:\s*(\d+)px/.exec(css);
  if (!match?.[1]) throw new Error("styles.css declares no --settings-agent-actions");
  return Number(match[1]);
})();

const outDir = mkdtempSync(join(tmpdir(), "envoycoder-anatomy-test-"));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

interface Anatomy {
  name: { fontSize: number; fontWeight: string } | null;
  line: { fontSize: number } | null;
  nameLeft: { spread: number; sd: number; n: number } | null;
  lineLeft: { spread: number } | null;
  nameVsLine: number | null;
  chipRight: { spread: number; sd: number } | null;
  actionRight: { spread: number; sd: number } | null;
  propsHeight: number;
  actionsHeight: number;
  rowsWithWrappedChips: number;
  rowsWithWrappedButtons: number;
  squeezedButtons: number;
  actionsNaturalWidth: number | null;
  perRow: readonly {
    h: number;
    chars: number;
    nameLeft: number | null;
    lineLeft: number | null;
    chipRight: number | null;
    actionRight: number | null;
    text: string;
  }[];
}

interface Report {
  visibleChars: number;
  rowsAboveFold: number;
  pageHeight: number;
  screens: number;
  rowsOverflowing: number;
  horizontalOverflow: boolean;
  rowCount: number;
  anatomy: Anatomy;
  contrast: { below45: number; worst: readonly { cls: string; ratio: number }[] };
  /**
   * **The fix block, measured with the disclosures open.** Empty numbers (`blocks: 0`) when nothing was
   * opened, which is the honest reading for a closed page rather than a zero that looks like a failure.
   */
  fix: {
    blocks: number;
    commands: number;
    copyButtons: number;
    commandsOverflowing: number;
    copyHeight: number;
    copySqueezed: number;
    contrast: { below45: number; worst: readonly { cls: string; ratio: number }[] };
  };
}

/**
 * Run the measurement tool on the real Settings page.
 *
 * The arguments are the *state* being measured, and there are two of them here for the reason the tool's own doc
 * gives: the page as it opens and the page with a group unfolded are two different and equally honest numbers.
 * `extra: []` is the second state — the agents list with every Not-ready row's way-out panel open — and it is the
 * only place the **fix block** exists to be measured at all.
 */
function measure(extra: readonly string[] = ["--open", "Browse the catalogue"]): Promise<Report> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, "scripts/measure-settings.mjs"), "--section", "agents", ...extra, "--out", outDir],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`measure-settings exited ${String(code)}\n${stderr.slice(-2000)}`));
        return;
      }
      // The report is the **last** JSON object it prints: the walk's own lines come first, and the pictures
      // line comes after it. Bounded by the last brace rather than by the first, so a stray line of prose cannot
      // truncate the report.
      const start = stdout.lastIndexOf("\n{");
      const end = stdout.lastIndexOf("}");
      if (start < 0 || end <= start) {
        reject(new Error(`measure-settings printed no report:\n${stdout.slice(-2000)}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout.slice(start, end + 1)) as Report);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

/**
 * The measurement itself, taken **once** at module scope: five assertions about one page should not drive five
 * browsers, and a measurement that fails should fail the file rather than four tests that depend on a variable.
 * Only taken when the leg is enabled, so the skipped case costs nothing.
 */
const report: Report = enabled ? await measure() : (undefined as unknown as Report);

/**
 * The same page, with **every Not-ready row's panel open** — the state in which the fix block exists.
 *
 * Opening them by the accessible name (`Not ready — …`) rather than by position is what makes this precise: the
 * Ready rows have nothing to open, and a click by index would open whatever happened to be first.
 */
const fixReport: Report = enabled
  ? await measure(["--open-aria", "Not ready —"])
  : (undefined as unknown as Report);

describeWhen("the agent rows, measured in a real window", () => {
  it("is measured on this machine's real page, with the counts the page claims", () => {
    // The measurement has to have landed on the page: 9 shipped agents, an empty state and 38 recipes. A page
    // that measured something else would make every assertion below vacuous.
    expect(report.rowCount).toBeGreaterThanOrEqual(40);
    expect(report.anatomy.nameLeft?.n).toBeGreaterThanOrEqual(40);
    // Printed rather than only asserted: these are the numbers a reader compares two runs by.
    console.log(
      `· anatomy measured: name ${String(report.anatomy.name?.fontSize)}px/${String(report.anatomy.name?.fontWeight)}` +
        `, chip right spread ${String(report.anatomy.chipRight?.spread)}px, actions right spread ` +
        `${String(report.anatomy.actionRight?.spread)}px, ${report.visibleChars} visible chars, ` +
        `${report.rowsAboveFold} rows above the fold of ${report.rowCount}`,
    );
  });

  it("lines up every column: one left edge for the text, one right edge for the chips, one for the controls", () => {
    // **The number the report asked for.** A chip that is right-aligned inside its own row does not line up down
    // a page; only a fixed controls track makes `row right − controls − gap` the same on every row. The mutation
    // this fails on is `grid-template-columns: … auto auto` — which looks identical in the markup and measures a
    // spread of hundreds of pixels here.
    expect(report.anatomy.nameLeft?.spread, "the name column is not a column").toBeLessThanOrEqual(1);
    expect(report.anatomy.lineLeft?.spread, "the line column is not a column").toBeLessThanOrEqual(1);
    expect(report.anatomy.nameVsLine, "the name and its line do not share a left edge").toBeLessThanOrEqual(1);
    expect(report.anatomy.chipRight?.spread, "the chips do not line up").toBeLessThanOrEqual(1);
    expect(report.anatomy.actionRight?.spread, "the controls do not line up").toBeLessThanOrEqual(1);
  });

  it("gives the name the size and the weight that make it the row's title", () => {
    // The stylesheet's *contract* is asserted in `settings-agent-row.test.tsx`; this is the rendered result,
    // which is the only place a cascade, a fallback font or a later rule could take it away.
    expect(report.anatomy.name?.fontSize).toBeGreaterThanOrEqual(15);
    expect(Number(report.anatomy.name?.fontWeight)).toBeGreaterThanOrEqual(600);
    expect(report.anatomy.name?.fontSize).toBeGreaterThan(report.anatomy.line?.fontSize ?? 0);
  });

  it("gives every row the same height, none of them pinched by the controls", () => {
    const contentRows = report.anatomy.perRow.filter((row) => row.nameLeft !== null);
    expect(contentRows.length).toBeGreaterThanOrEqual(40);
    for (const row of contentRows) {
      expect(row.h, `"${row.text.slice(0, 40)}" is ${row.h}px tall`).toBeGreaterThanOrEqual(80);
    }
    // One height for all of them: a row that grew would be a row whose controls wrapped or whose name broke.
    expect(new Set(contentRows.map((row) => row.h)).size).toBe(1);
    // And the controls really do fit the track they are given: no stacked buttons, no label squeezed inside a
    // 24px button — the two ways a fixed column fails silently.
    expect(report.anatomy.rowsWithWrappedButtons).toBe(0);
    expect(report.anatomy.rowsWithWrappedChips).toBe(0);
    expect(report.anatomy.squeezedButtons).toBe(0);
    expect(report.anatomy.actionsNaturalWidth).toBeLessThanOrEqual(actionsTrack);
  });

  it("stays a page of names and one line each: no row carries a paragraph", () => {
    // The character budget did not go away because the layout changed — the previous round's *fix* stays, and
    // this is it, measured on the real page rather than on a fixture.
    for (const row of report.anatomy.perRow) {
      expect(row.chars, `"${row.text.slice(0, 60)}" is ${row.chars} characters`).toBeLessThanOrEqual(
        AGENT_ROW_BUDGET,
      );
    }
    expect(report.rowsOverflowing).toBe(0);
    expect(report.horizontalOverflow).toBe(false);
    // Contrast: the family's 4.5:1 floor, on every chip and piece of small print the row draws.
    expect(report.contrast.below45, JSON.stringify(report.contrast.worst.slice(0, 3))).toBe(0);
  });

  it("sets the fix apart, legibly, in the one place a user goes to resolve a Not-ready row", () => {
    // **The owner's ask, measured rather than described:** *"can we highlight the info on each agent … we want
    // to highlight it and let user know how to resolve it."* The block is only in the DOM once a disclosure is
    // open, so this is the second measurement above — and when a machine has no Not-ready row with a fix there is
    // nothing here to look at, which is said out loud rather than passed quietly.
    if (fixReport.fix.blocks === 0) {
      console.log(
        "· fix block: not measured — this machine has no Not-ready row carrying a fix, so every assertion " +
          "below would have been about an empty page.",
      );
      return;
    }

    // One block per panel opened, with the command in it.
    expect(fixReport.fix.blocks).toBeGreaterThanOrEqual(1);
    expect(fixReport.fix.commands).toBeGreaterThanOrEqual(fixReport.fix.blocks);
    // **Copy is offered where a command is shown.** This is the leg that would have caught a webview without a
    // clipboard path: `canCopyText()` is asked before the control is rendered, so a zero here means a user is
    // looking at a command they must retype — which is a decision for a human, not a silent regression.
    expect(
      fixReport.fix.copyButtons,
      "a command is shown with no Copy control on a browser that can copy",
    ).toBe(fixReport.fix.commands);
    // A real target, and a label that fits inside it.
    expect(fixReport.fix.copyHeight).toBeGreaterThanOrEqual(24);
    expect(fixReport.fix.copySqueezed).toBe(0);
    // A long command wraps inside its block rather than escaping it.
    expect(fixReport.fix.commandsOverflowing).toBe(0);
    // And the highlight is legible: the family's 4.5:1 floor still holds inside the block, whose surface is not
    // the page's own.
    expect(
      fixReport.fix.contrast.below45,
      JSON.stringify(fixReport.fix.contrast.worst),
    ).toBe(0);
    console.log(
      `· fix block measured: ${fixReport.fix.blocks} block(s), ${fixReport.fix.commands} command(s), ` +
        `${fixReport.fix.copyButtons} Copy control(s) at ${fixReport.fix.copyHeight}px, worst contrast ` +
        `${String(fixReport.fix.contrast.worst[0]?.ratio)}:1`,
    );
  });
});
