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
  /** Which palette these numbers describe — `--theme`. */
  theme: string;
  /**
   * The product mark in the top bar, and **whether it loaded**. An image whose source 404s is still an element,
   * so presence is not the claim worth testing: `naturalWidth` is zero for one the browser could not decode.
   */
  logo: { present: boolean; loaded: boolean; naturalWidth: number; alt: string | null; width: number } | null;
  /**
   * **The composer's prose, as the lines it draws** — the thing the owner complained about, in numbers:
   * *"These texts are usless, but make the chats inputting messy."* Zero lines for a task with nothing running.
   */
  composer: {
    present: boolean;
    notes: readonly string[];
    fieldWidth: number | null;
    cardWidth: number | null;
    chips: readonly { label: string; height: number; border: string }[];
    /** The send action, or `null` when the field is empty — the state in which none is drawn. */
    send: { name: string; visibleText: string; glyph: boolean; width: number; height: number } | null;
    actionsSameRowAsChips: boolean | null;
  };
  /**
   * **Every text-bearing element on the page**, not only the chips and small print the narrower `contrast` list
   * samples. It exists because that list reported zero failures in the light palette while the page still had text
   * nobody could read: the worst elements are the ones a dark-only token sheet takes out — titles, headings, names.
   */
  contrastAll: {
    below45: number;
    sampled: number;
    /**
     * **Which surfaces were on screen when the scan ran.** A zero has to be read for what it covers: a page with
     * no task open has no composer, and "the composer is legible" is not something that run established.
     */
    surfaces: readonly string[];
    worst: readonly { cls: string; ratio: number }[];
  };
  /**
   * **The fix block, measured with the disclosures open.** Empty numbers (`blocks: 0`) when nothing was
   * opened, which is the honest reading for a closed page rather than a zero that looks like a failure.
   */
  fix: {
    blocks: number;
    commands: number;
    copyButtons: number;
    /** Presses that run the command — `coder.runFix`. Measured so a block cannot offer a command and no way out. */
    runButtons: number;
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
function measure(
  extra: readonly string[] = ["--open", "Browse the catalogue"],
  section = "agents",
): Promise<Report> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, "scripts/measure-settings.mjs"), "--section", section, ...extra, "--out", outDir],
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

/**
 * The same page in the **light** palette — the one nobody had measured.
 *
 * `styles.css` owns a second set of colour names (`--bg`, `--text*`, `--ok/--warn/--danger/--live`) beside the token
 * sheet's families, and it defined them once, dark. So the light theme was half-applied: surfaces turned white while
 * the text over them kept dark-mode greys, and the elements drawn with `--foreground` on a `--bg` background landed
 * near 1:1. This measurement is what turned that from a sentence in a doc into a number, and the leg below is what
 * keeps it fixed.
 */
const lightReport: Report = enabled ? await measure(["--theme", "light"]) : (undefined as unknown as Report);

/**
 * **The work surface** — the rail, the title bar, the status bar, the composer and the palette, with a project and
 * a task seeded into the tool's isolated home so the composer is on screen at all.
 *
 * Every number this file produced before this was about one screen, because the walk always pressed *Settings*.
 * The rail, the chrome and the composer had therefore never been measured in either palette — and the light
 * palette, the newest thing in the sheet, was judged on the settings pane alone. Widening the scan found the
 * status bar at 3.48:1 in dark mode and the composer's folder pill at 2.33:1 in light (§7.28); this leg is what
 * keeps them found.
 */
const SEEDED_TASK = "the task the tool measures";
function measureWork(theme: "dark" | "light"): Promise<Report> {
  // The task first (so the composer is on screen), then words in the message field, then the palette — which is
  // left **open**, so its rows are part of the scan. They are the elements that measured 1.04:1 in the light
  // palette: white text on a near-white panel, because the row is a `button` with no `color` of its own and took
  // the platform's `buttontext`.
  //
  // The typing matters for the send action: it is drawn only when there is something to send, which is the state
  // the owner asked about (*"when inputting, the icon button displayed"*), and a measurement of the resting
  // composer could not see it at all.
  return measure(
    ["--seed", "--theme", theme, "--open", SEEDED_TASK, "--type", "Add a health check endpoint", "--open", "Command Center"],
    "work",
  );
}
const workReport: Report = enabled ? await measureWork("dark") : (undefined as unknown as Report);
const workLightReport: Report = enabled ? await measureWork("light") : (undefined as unknown as Report);

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

  it("is legible in the light palette too, which is the half that had never been measured", () => {
    // **The reported bug, as a number.** `data-theme="light"` half-applied the palette: `tokens.css` switched its
    // surfaces while `styles.css` kept `--text` (near-white) for text drawn over them, so a pane title measured
    // about 1.0:1. Both palettes are now measured, on every element that draws text.
    expect(lightReport.theme).toBe("light");
    expect(lightReport.contrastAll.sampled).toBeGreaterThanOrEqual(40);
    expect(
      lightReport.contrastAll.below45,
      JSON.stringify(lightReport.contrastAll.worst.slice(0, 3)),
    ).toBe(0);
    // The same floor on the narrower list of chips and small print, which is what dark mode asserts.
    expect(lightReport.contrast.below45, JSON.stringify(lightReport.contrast.worst.slice(0, 3))).toBe(0);
    // And the light palette is a *palette*, not a cascade accident: the columns still line up and every row still
    // carries the anatomy the dark measurement pins.
    expect(lightReport.anatomy.name?.fontSize).toBeGreaterThanOrEqual(15);
    expect(lightReport.anatomy.chipRight?.spread, "the chips do not line up in light").toBeLessThanOrEqual(1);
    expect(lightReport.anatomy.actionRight?.spread, "the controls do not line up in light").toBeLessThanOrEqual(1);
    console.log(
      `· light palette measured: ${lightReport.contrastAll.sampled} text elements, worst ` +
        `${String(lightReport.contrastAll.worst[0]?.ratio)}:1, ${lightReport.visibleChars} visible chars`,
    );
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
    // **Every command the block shows can be run, and every one can be copied.** A block that listed a command
    // and offered neither would still measure "6 blocks, 6 commands" and read as complete — so the two controls
    // are counted rather than assumed, and the first of them is the feature this measurement was extended for.
    expect(
      fixReport.fix.runButtons,
      "a command is shown with no way to run it",
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
        `${fixReport.fix.copyButtons} Copy control(s) at ${fixReport.fix.copyHeight}px, ` +
        `${fixReport.fix.runButtons} Install press(es), worst contrast ` +
        `${String(fixReport.fix.contrast.worst[0]?.ratio)}:1`,
    );
  });
});

describeWhen("the work surface, measured in a real window", () => {
  it("actually looked at the rail, the chrome and the composer, in both palettes", () => {
    // **The assertion that keeps the others honest.** A walk that failed to open the task would measure the empty
    // work area and report `below45: 0` — a true number about a screen nobody was asking about. Naming the
    // surfaces is what makes the measurement a claim about the surface it is for.
    for (const [label, report_] of [
      ["dark", workReport],
      ["light", workLightReport],
    ] as const) {
      for (const surface of ["rail", "titlebar", "statusbar", "composer", "palette"]) {
        expect(
          report_.contrastAll.surfaces,
          `the ${label} run did not measure the ${surface}: ${report_.contrastAll.surfaces.join(", ")}`,
        ).toContain(surface);
      }
    }
  });

  it("holds the 4.5:1 floor on every surface outside Settings, in both palettes", () => {
    // The measured defects this leg exists for: the status bar's detail line at 3.48:1 in dark mode, and the
    // composer's folder pill at 2.33:1 in light, both invisible to a scan rooted at `.settings`.
    expect(workReport.contrastAll.below45, JSON.stringify(workReport.contrastAll.worst.slice(0, 3))).toBe(0);
    expect(
      workLightReport.contrastAll.below45,
      JSON.stringify(workLightReport.contrastAll.worst.slice(0, 3)),
    ).toBe(0);
    console.log(
      `· work surface measured: ${workReport.contrastAll.sampled} text elements in dark, ` +
        `${workLightReport.contrastAll.sampled} in light, across ${workReport.contrastAll.surfaces.join("/")}`,
    );
  });
});

describeWhen("the chrome, measured in a real window", () => {
  it("shows the product's own mark in the top bar, and the file really loads", () => {
    // The logo is imported through Vite, so the claim has two halves and only a browser can check either: the
    // element is in the bar, and the bundler carried a file the webview could decode. A broken path renders a
    // broken-image glyph, which is invisible to a DOM query and to a contrast scan.
    expect(workReport.logo).not.toBeNull();
    expect(workReport.logo?.loaded).toBe(true);
    expect(workReport.logo?.naturalWidth).toBeGreaterThan(0);
    // Decorative: the name is right beside it, so a screen reader must not read the product twice.
    expect(workReport.logo?.alt).toBe("");
    expect(workReport.logo?.width).toBe(18);
  });
});

describeWhen("the composer, measured in a real window", () => {
  it("is a 28px toolbar under the field, with no prose of its own", () => {
    // The measurement boots its own daemon with a seeded project and task, opens it, and counts the lines the
    // composer draws under its controls. Before §7.30 this page had two — a window with no folder chooser, and Envoy
    // Harness's missing thinking level, 126 characters in all — and the owner's own window had four while a turn was
    // running, one per control, each saying the same thing.
    expect(workReport.composer.present).toBe(true);
    expect(workReport.composer.notes).toEqual([]);
    // **And that it is Paseo's shape rather than a form.** The field owns the row, the chips are 28px with no
    // border at all (a border per control is what made the old row read as furniture), and they sit on the same
    // line as the send button. These are the numbers behind *"can the others fields use the same style with
    // paseo"*; the compositor's own doc in `styles.css` argues the rest.
    expect(workReport.composer.fieldWidth).toBeGreaterThan((workReport.composer.cardWidth ?? 0) - 40);
    expect(workReport.composer.chips.length).toBeGreaterThanOrEqual(3);
    for (const chip of workReport.composer.chips) {
      expect(chip.height, `${chip.label} is not a 28px chip`).toBe(28);
      expect(chip.border, `${chip.label} draws a border`).toBe("0px");
    }
    expect(workReport.composer.actionsSameRowAsChips).toBe(true);
    // **The send action: a glyph, no words, and only because the field has something in it.** A mutation that puts
    // the visible label back reddens `visibleText`; one that draws it with an empty field cannot be seen from here
    // (that state is `task-pane.test.tsx`'s), which is why both exist.
    const send = workReport.composer.send;
    expect(send).not.toBeNull();
    expect(send?.visibleText).toBe("");
    expect(send?.glyph).toBe(true);
    expect(send?.width).toBe(28);
    expect(send?.height).toBe(28);
    console.log(
      `· composer measured: ${String(workReport.composer.notes.length)} note line(s) above the field, ` +
        `${String(workReport.composer.notes.reduce((n, line) => n + line.length, 0))} characters`,
    );
  });
});
