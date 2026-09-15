/**
 * **What an agent row says, and which of its parts leads** — the two halves of the owner's second and first
 * reports, asserted on the rendered page.
 *
 * ## The two reports this file is about, verbatim
 *
 * 1. *"Some agents I have installed, but still show need to install or need adapter. Eg, codex, claudecode,
 *    deepseek-harness."* For Codex and Claude Code the *measurement* was right and the *row* misled: the state
 *    is `needs-bridge` — the user's own CLI resolved and its ACP adapter did not — and the only sentence on the
 *    row was `npm install -g @agentclientprotocol/codex-acp`. So the row now leads with what is **present**
 *    (`Installed — …`), the state chip names the one missing piece, and the command follows on the same line.
 *    Both sides of the branch are asserted here, because a wording fix that turned a real absence into a
 *    suggestion would be worse than the bug.
 * 2. *"The UI for agents are worse than before, can we give more space to each agent and emphasize the Agent
 *    name, the status or actions are just properties, Align the texts."* The prominence of the name is a claim
 *    about *type*, and the alignment of the columns is a claim about *geometry*.
 *
 * ## What each leg can prove, and what it cannot
 *
 * jsdom applies the stylesheet cascade but has **no layout engine**: `getBoundingClientRect()` is all zeros and
 * a `var(--token)` is not resolved. So:
 *
 *   * this file proves the **contract** — which token the name is set with, what `tokens.css` says that token
 *     is, that the name's size and weight are above every other band in the row, and that every row of every
 *     list has the same column order;
 *   * `test/settings-row-anatomy.e2e.test.ts` proves the **pixels** (a real Chrome, the real page, the measured
 *     spread of each column's edge), and `scripts/measure-settings.mjs` prints them for a reader.
 *
 * A leg that claimed to measure geometry here would be a green light for something it never looked at, which is
 * the failure this repository has already paid for.
 */

/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HarnessSummary } from "@envoycoder/protocol";

import { SettingsPane } from "../src/components/SettingsPane.js";
import { rowVerdict } from "../src/components/settings/agent-verdict.js";
import { en } from "../src/i18n/messages/en.js";
import { SOURCE_LOCALE } from "../src/i18n/locales.js";
import { createTranslator } from "../src/i18n/translate.js";
import { I18nProvider } from "../src/i18n/context.js";
import { wiredBindings } from "../src/input/shortcuts.js";
import { appScope } from "../src/state/settings-scope.js";
import type { CoderState } from "../src/state/coderStore.js";

afterEach(cleanup);

/* ────────────────────────────── fixtures ────────────────────────────── */

const ADAPTER = "npm install -g @agentclientprotocol/codex-acp";

function harness(over: Partial<HarnessSummary> & { id: HarnessSummary["id"] }): HarnessSummary {
  return {
    label: over.id,
    tier: "catalogued",
    summary: "A sentence about this agent, which a row is not allowed to print.",
    modes: [{ id: "default", label: "Default" }],
    models: { kind: "listed", options: [{ id: "a/b", label: "b", provider: "a", model: "b" }], source: "…" },
    thinking: { kind: "listed", options: [{ id: "low", label: "Low" }], source: "…" },
    capabilities: {
      resume: true,
      cancel: true,
      approvals: true,
      structuredTools: true,
      streaming: true,
      images: false,
      agentMode: true,
      model: true,
      thinking: true,
      approvalPolicy: true,
    },
    availability: { state: "ready", binary: "/usr/local/bin/x" },
    auth: { state: "ready", methodId: "login" },
    evidence: "…",
    ...over,
  } as HarnessSummary;
}

const state: CoderState = {
  connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
  resolved: undefined,
  hello: {
    product: "EnvoyCoder",
    version: "0.1.0",
    instanceId: "test",
    home: "/home/you",
    stateDir: "/home/you/.envoycoder",
    startedAt: "2026-09-14T00:00:00.000Z",
    windowCount: 1,
    methods: ["coder.hello", "coder.listHarnesses", "coder.listProviders", "coder.listCatalog", "coder.signInAgent"],
    mesh: { kind: "no-node", reason: "" },
    notes: [],
  },
  projects: [],
  tasks: [],
  tasksKnown: true,
  settings: { defaults: { harness: "envoy-harness" }, requireApprovalForDestructive: true, keepTranscripts: true, language: "en" },
  harnesses: [
    // The reported shape: the agent's own CLI resolved, the adapter did not.
    harness({
      id: "codex",
      label: "Codex",
      availability: { state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command: ADAPTER }] },
    }),
    // A real absence, which must not be dressed up as anything else.
    harness({
      id: "copilot",
      label: "GitHub Copilot",
      availability: { state: "not-installed", fix: [{ command: "npm install -g @github/copilot" }] },
    }),
    // Present, driven, and found in somebody else's cache — the `dsh` case.
    harness({
      id: "deepseek-harness",
      label: "DeepSeek Harness",
      availability: {
        state: "ready",
        binary: "/Users/you/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh",
        provisional: "npx",
      },
    }),
  ],
  providers: [],
  catalog: [],
  mesh: { kind: "no-node", reason: "" },
  runs: {},
  loaded: true,
  error: undefined,
  notes: [],
};

const noActions = {
  addProvider: vi.fn(),
  removeProvider: vi.fn(),
  signInAgent: vi.fn(),
} as never;

/** The source translator, so a pure-function assertion reads the same English a row renders. */
const { t: tEn } = createTranslator(SOURCE_LOCALE);

function show(): HTMLElement {
  const { container } = render(
    <I18nProvider preference="en">
      <SettingsPane
        state={state}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        scope={appScope("agents")}
        layout="wide"
        shortcuts={wiredBindings({
          commandCenter: vi.fn(),
          newTask: vi.fn(),
          search: vi.fn(),
          windowNew: vi.fn(),
          sidebar: vi.fn(),
          settings: vi.fn(),
          help: vi.fn(),
          interrupt: vi.fn(),
        })}
        onNavigate={vi.fn()}
        agents={noActions}
      />
    </I18nProvider>,
  );
  return container;
}

/** One row, by the agent's own name — never by index, which would pass on a reordered list. */
function rowOf(container: HTMLElement, label: string): HTMLElement {
  const found = [...container.querySelectorAll(".settings__agent")].find(
    (row) => row.querySelector(".settings__agent-name")?.textContent === label,
  );
  if (!(found instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return found;
}

const textOf = (node: Element): string => (node.textContent ?? "").replace(/\s+/g, " ").trim();

/* ────────────────────────── what a row says ────────────────────────── */

describe("a row for an agent that is here without its adapter", () => {
  it("leads with what is present, names the one missing piece, and still shows the command", () => {
    const container = show();
    const row = rowOf(container, "Codex");
    const line = row.querySelector(".settings__agent-line");
    if (!(line instanceof HTMLElement)) throw new Error("no line on the Codex row");

    // **What is present leads.** This is the sentence the report asked for: the reader's first word is
    // `Installed`, not a package they have never heard of.
    expect(textOf(line).startsWith("Installed")).toBe(true);
    // **The verdict is one word**, and it is the second of the two — not a five-word state vocabulary.
    expect(row.querySelector(".settings__agent-state")?.textContent).toBe(en["settings.agent.verdict.notReady"]);
    // **And the command is there, verbatim**, in its own monospaced element on the same line — one line, two
    // faces, because the sentence and the command are different kinds of thing.
    expect(row.querySelector(".settings__agent-cmd")?.textContent).toBe(ADAPTER);
    expect(textOf(line)).toBe(`${en["settings.agent.verdict.connector.lead"]} ${ADAPTER}`);
    // The row carries no install step for the agent itself: it is installed, and telling the user to install it
    // would be the false half of the sentence this fixed.
    expect(textOf(row)).not.toContain("npm install -g @openai/codex");
  });

  it("never says `Installed` about an agent that is absent", () => {
    // **The other side of the branch**, and the reason the wording change is not a softening: a real absence
    // still says so, in the chip and in the line. The mutation this fails on is applying the presence lead to
    // every fix — which would tell a user with no Copilot at all that it is installed.
    const container = show();
    const row = rowOf(container, "GitHub Copilot");
    expect(row.querySelector(".settings__agent-state")?.textContent).toBe(en["settings.agent.verdict.notReady"]);
    const line = row.querySelector(".settings__agent-line");
    expect(textOf(line!)).toBe("npm install -g @github/copilot");
    expect(textOf(line!)).not.toContain("Installed");
  });

  it("falls back to the short phrase when the lead and the command will not share the line", () => {
    // The budget branch, driven from both sides through the one function that now owns it. With today's
    // catalogue both bridged agents fit, so the fallback is reachable only from a longer command — and it
    // exists because a budget nothing can break is a budget that has stopped measuring.
    const bridged = (command: string) =>
      rowVerdict(
        {
          label: "Codex",
          availability: { state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command }] },
          readyLine: "Ships with EnvoyCoder",
        },
        tEn,
        80,
      );

    const short = bridged(ADAPTER);
    expect(short.reason).toBe("connector");
    expect(short.line).toBe(en["settings.agent.verdict.connector.lead"]);
    expect(short.command).toBe(ADAPTER);
    expect(short.lineIsCommand).toBe(false);

    const long = bridged(
      "npm install -g a-very-long-adapter-package-name-for-an-agent-with-a-complicated-bridge",
    );
    // **The fallback keeps the phrase and drops the command, never the other way round.** A shorter fallback
    // string would take `Installed` off the line for the one user this case was written for.
    expect(long.line).toBe(en["settings.agent.verdict.connector.lead"]);
    expect(long.line.startsWith("Installed")).toBe(true);
    expect(long.command).toBeUndefined();
    // The whole of it is one hover away rather than gone.
    expect(long.lineTitle).toContain("a-very-long-adapter-package-name");

    // And a fix with two steps keeps both in the hover, because for a bridged agent the agent and the adapter
    // are two installs.
    const two = rowVerdict(
      {
        label: "Codex",
        availability: {
          state: "needs-bridge",
          agentBinary: "/usr/local/bin/codex",
          fix: [{ command: ADAPTER }, { command: "npm install -g @openai/codex" }],
        },
        readyLine: "Ships with EnvoyCoder",
      },
      tEn,
      80,
    );
    expect(two.lineTitle).toBe(`${ADAPTER}\nnpm install -g @openai/codex`);
  });
});

/* ─────────────────────── which part of the row leads ─────────────────────── */

/** One rule's body from a stylesheet, by selector, as text. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match?.[1]) throw new Error(`no rule for ${selector}`);
  return match[1];
}

/** One declaration's value out of a rule body. */
function declared(body: string, property: string): string {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
  if (!match?.[1]) throw new Error(`no ${property} in ${body}`);
  return match[1].trim();
}

/** A token's value out of the token sheet. */
function token(name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+)`).exec(TOKENS);
  if (!match?.[1]) throw new Error(`no token ${name}`);
  return match[1].trim();
}

const STYLES = readFileSync("apps/desktop/src/styles.css", "utf8");
const TOKENS = readFileSync("apps/desktop/src/design/tokens.css", "utf8");
const px = (value: string): number => Number.parseFloat(value);

describe("the name is the row's most prominent text", () => {
  it("is set one full step larger and one weight step heavier than every other band in the row", () => {
    // **The owner's ask, as a comparison rather than an adjective.** Each value is read twice: which token the
    // rule names (from `styles.css`), and what the token is worth (from `tokens.css`). That two-step is the
    // honest one — jsdom resolves the cascade but not a `var(--token)`, so a test that read a computed size
    // here would compare the string "var(--font-size-content)" with itself.
    const nameSize = px(token(declared(ruleBody(STYLES, ".settings__agent-name"), "font-size").slice(4, -1)));
    const nameWeight = Number(
      token(declared(ruleBody(STYLES, ".settings__agent-name"), "font-weight").slice(4, -1)),
    );
    const lineSize = px(token(declared(ruleBody(STYLES, ".settings__agent-line"), "font-size").slice(4, -1)));
    const chipSize = px(token(declared(ruleBody(STYLES, ".chip"), "font-size").slice(4, -1)));
    const bodySize = px(declared(ruleBody(STYLES, "body"), "font-size"));
    const labelWeight = Number(
      token(declared(ruleBody(STYLES, ".settings-nav__label"), "font-weight").slice(4, -1)),
    );

    expect(nameSize).toBe(15);
    expect(nameWeight).toBe(600);
    // Larger than the page's own body text, than the row's secondary line, and than a chip's word.
    expect(nameSize).toBeGreaterThan(bodySize);
    expect(nameSize).toBeGreaterThan(lineSize);
    expect(nameSize).toBeGreaterThan(chipSize);
    // Heavier than an ordinary UI label (a nav item, a button), which is what "leads" means in weight.
    expect(nameWeight).toBeGreaterThan(labelWeight);
    // And nothing else in the row claims either: the line and the chips are the small size, and no other rule in
    // the row's own block sets the name's size.
    const agentBlock = STYLES.slice(
      STYLES.indexOf(".settings__agent {"),
      STYLES.indexOf(".settings__agent-declared {"),
    );
    const bigInRow = [...agentBlock.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]?.trim());
    expect(bigInRow.filter((value) => value?.includes("--font-size-content"))).toHaveLength(1);
  });

  it("is the first thing a reader meets on the row, before the state chip and the controls", () => {
    const container = show();
    const row = rowOf(container, "Codex");
    const text = textOf(row);
    // Reading order, which is what a screen reader gets and what an eye follows: the name, then its line, then
    // the state, then the controls. A chip first — the layout this replaced — fails here.
    expect(text.indexOf("Codex")).toBeLessThan(text.indexOf(en["settings.agent.verdict.notReady"]));
    expect(text.indexOf(en["settings.agent.verdict.notReady"])).toBeLessThan(
      text.indexOf(en["settings.agents.row.details"]),
    );
  });

  it("gives every row of every list the same three columns, in the same order", () => {
    // The page has three lists and one component drawing them (`AgentRow`), so the anatomy is a property of the
    // page rather than of whichever list was written last. The *alignment* of those columns is measured in a real
    // window (`settings-row-anatomy.e2e.test.ts`); what is assertable here is that there is one shape.
    const container = show();
    const rows = [...container.querySelectorAll(".settings__agent")].filter((row) =>
      row.querySelector(".settings__agent-head"),
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      const head = row.querySelector(".settings__agent-head");
      const columns = [...head!.children].map((child) => child.className);
      expect(columns, textOf(row).slice(0, 40)).toEqual([
        "settings__agent-id",
        "settings__agent-props",
        "settings__agent-actions",
      ]);
      // The name and its line share one block, which is what gives them one left edge.
      const block = row.querySelector(".settings__agent-id");
      expect(block?.querySelector(".settings__agent-name")).toBeTruthy();
      expect(block?.querySelector(".settings__agent-line")).toBeTruthy();
      // **At most one chip, and it is the verdict.** The mandate's vocabulary is that caveats are
      // *properties*, and the structure now enforces it: `AgentRow` has no prop through which a caveat chip
      // could reach a row's face, so a second chip here is a compile-level impossibility rather than a
      // convention somebody might forget.
      const chips = [...row.querySelectorAll(".chip")];
      expect(chips.length, textOf(row).slice(0, 40)).toBeLessThanOrEqual(1);
      expect(chips[0]?.classList.contains("settings__agent-state")).toBe(true);
      expect([en["settings.agent.verdict.ready"], en["settings.agent.verdict.notReady"]]).toContain(
        chips[0]?.textContent,
      );
    }
  });

  it("says where a program came from as a property, not as a second chip", () => {
    // The `dsh` half of the report. It is `ready` — it works — and it is *also* a temporary copy, because
    // `npm cache clean` removes it. **The caveat is a property**: it lives inside the disclosure, where the
    // mandate puts facts like this, and the row's face carries one chip. Before this slice it was a warn chip
    // beside the state chip, which is how nine rows carried eighteen chips.
    const container = show();
    const row = rowOf(container, "DeepSeek Harness");
    expect(row.querySelector(".settings__agent-state")?.textContent).toBe(en["settings.agent.verdict.ready"]);
    expect([...row.querySelectorAll(".chip")]).toHaveLength(1);
    // Nothing on the face of the row says "Temporary copy" — the word is gone from the catalogue entirely,
    // because it was a chip and a caveat is a property.
    expect(Object.keys(en)).not.toContain("settings.agent.provisional");
    expect(textOf(row)).not.toMatch(/temporary copy/i);
    // …and nothing offers an install for a program that is present.
    expect(textOf(row)).not.toMatch(/npm install/);
    // Open the disclosure: the property is there, with the cache named.
    fireEvent.click(row.querySelector(".settings__agent-actions button")!);
    const details = container.querySelector(".settings__agent-details");
    expect(textOf(details!)).toContain(en["settings.agent.provisional.npx"]);
  });
});
