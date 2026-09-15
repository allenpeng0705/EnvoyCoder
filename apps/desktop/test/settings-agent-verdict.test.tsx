/**
 * **One verdict per row, no press to learn it, and a way out of every Not ready.**
 *
 * This is the file the mandate's hard requirements land in, so each `it` names the requirement it is the test
 * for and the mutation it fails on. Read top to bottom, the list is the design:
 *
 * | requirement (the owner's words) | the test |
 * |---|---|
 * | *"I don't want user to guess, to check if we can do that"* | `every row has a verdict, with nothing pressed` |
 * | *"'Not checked' must essentially disappear"* | `no row, and no control, offers to find out a state` |
 * | *"If the agent cannot be used - 'Not Ready', we should clearly know what the problem is"* | one test per Not-ready case, below |
 * | *"and guide user to resolve it"* | `clicking Not ready reveals the guide` |
 * | *"Distinguish "there is a fix" from "there is nothing you can do""* | `the "our gap" case offers no install step` |
 * | caveats are **properties**, not chips | `a row renders at most one chip, and it is one of two verdicts` |
 * | *"an `npx` recipe → it is not a problem"* | `an npx row is ready, and says how it is obtained` |
 * | deep facts are a property with a time, never a state to trigger | `the deep facts carry the time they were observed` |
 * | *"assert that loading the page spawns no process"* | `rendering the page performs no action at all` |
 *
 * ## What these legs are, and what they are not
 *
 * Everything here is jsdom over the real pane with the real English catalogue: the *wording*, the *structure*
 * (which element holds what, and which elements are absent) and the *interaction* (one press reveals the
 * guide) are all DOM facts and all assertable. What is **not** assertable here is geometry — jsdom has no
 * layout engine — so the pixels are `settings-row-anatomy.e2e.test.ts`'s job, and the process count is
 * `catalog-rpc.test.ts`'s, where a spawn would actually happen. A leg here that claimed either would be a
 * green light for something it never looked at.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentProviderSummary,
  CatalogEntry,
  HarnessSummary,
} from "@envoycoder/protocol";

import { SettingsPane } from "../src/components/SettingsPane.js";
import { VERDICT_CHIP, rowVerdict, verdictFacts } from "../src/components/settings/agent-verdict.js";
import { en } from "../src/i18n/messages/en.js";
import { I18nProvider } from "../src/i18n/context.js";
import { SOURCE_LOCALE } from "../src/i18n/locales.js";
import { createTranslator } from "../src/i18n/translate.js";
import { wiredBindings } from "../src/input/shortcuts.js";
import { appScope } from "../src/state/settings-scope.js";
import type { CoderState } from "../src/state/coderStore.js";

afterEach(cleanup);

const { t: tEn } = createTranslator(SOURCE_LOCALE);
const ADAPTER = "npm install -g @agentclientprotocol/codex-acp";
const INSTALL_GOOSE = "npm install -g @block/goose";

/* ────────────────────────────── fixtures ────────────────────────────── */

function harness(over: Partial<HarnessSummary> & { id: HarnessSummary["id"] }): HarnessSummary {
  return {
    label: over.id,
    tier: "built-in",
    summary: "A sentence about this agent, which a row is not allowed to print.",
    modes: [{ id: "default", label: "Default" }],
    models: { kind: "listed", options: [{ id: "a/b", label: "b", provider: "a", model: "b" }], source: "…" },
    thinking: { kind: "listed", options: [{ value: "low", label: "Low" }], source: "…" },
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
    availability: { state: "ready", binary: "/usr/local/bin/agent" },
    auth: { state: "ready", methodId: "login" },
    evidence: "…",
    ...over,
  } as HarnessSummary;
}

function provider(over: Partial<AgentProviderSummary> = {}): AgentProviderSummary {
  return {
    id: "mine",
    label: "My Agent",
    command: "my-agent",
    args: ["acp"],
    env: [],
    transport: "acp",
    availability: { state: "ready", binary: "/usr/local/bin/my-agent" },
    detail: "Ready to run (/usr/local/bin/my-agent).",
    ...over,
  };
}

function entry(over: Partial<CatalogEntry> & { id: string }): CatalogEntry {
  return {
    title: over.id,
    description: "What the vendor says it is.",
    version: "1.0.0",
    installLink: "https://example.test/install",
    command: over.id,
    args: ["acp"],
    transport: "acp",
    env: [],
    install: { kind: "binary", binary: over.id },
    builtIn: false,
    availability: { state: "not-installed", fix: [{ command: `npm install -g ${over.id}` }] },
    ...over,
  } as CatalogEntry;
}

/**
 * The pane over a state, and **the record of what the page did to get there**.
 *
 * `agents` is a proxy rather than a plain object of `vi.fn()`s: it records *every property the page touches*,
 * not only the calls a test remembered to spy on, which is what makes "rendering performs no action" a real
 * assertion rather than a list of the methods somebody thought of.
 */
function show(
  over: Partial<CoderState> = {},
  /**
   * What this daemon advertises, when a leg is about the *build-skew* half of a control rather than about the
   * data. Defaults to the base list; a leg that needs the new method (or must prove the absence of one) passes
   * its own instead of restating a fifteen-line `hello`.
   */
  methods?: readonly string[],
): { container: HTMLElement; touched: string[] } {
  const touched: string[] = [];
  const agents = new Proxy(
    {},
    {
      get: (_target, name) => {
        touched.push(String(name));
        return vi.fn(async () => ({ ok: true as const, detail: "done" }));
      },
    },
  ) as never;

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
      methods: [
        "coder.hello",
        "coder.listHarnesses",
        "coder.listProviders",
        "coder.listCatalog",
        "coder.signInAgent",
        ...(methods ?? []),
      ],
      mesh: { kind: "no-node", reason: "" },
      notes: [],
    },
    projects: [],
    tasks: [],
    tasksKnown: true,
    settings: {
      defaults: { harness: "envoy-harness" },
      requireApprovalForDestructive: true,
      keepTranscripts: true,
      language: "en",
    },
    harnesses: [],
    providers: [],
    catalog: [],
    mesh: { kind: "no-node", reason: "" },
    runs: {},
    loaded: true,
    error: undefined,
    notes: [],
    ...over,
  };

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
        agents={agents}
      />
    </I18nProvider>,
  );
  return { container, touched };
}

const textOf = (node: Element | null): string => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

function rowOf(container: HTMLElement, label: string): HTMLElement {
  const found = [...container.querySelectorAll(".settings__agent")].find(
    (row) => row.querySelector(".settings__agent-name")?.textContent === label,
  );
  if (!(found instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return found;
}

/** A row's verdict chip, as the words on screen — `undefined` when the row has no chip at all. */
const verdictOf = (row: HTMLElement): string | undefined =>
  row.querySelector(".settings__agent-state")?.textContent ?? undefined;

/**
 * Open a row's disclosure with the control a user has: the row's own `Details` button.
 *
 * Found **by its visible label**, not by position: the controls column's first button is the row's own action,
 * and that action differs by list — *Add* on a catalogue row, *Remove* on a provider, *Sign in* on a shipped
 * agent that wants one. A test that clicked the first button would pass on one list and silently test the
 * wrong thing on the other two.
 */
function openDetails(row: HTMLElement): HTMLElement {
  const details = [...row.querySelectorAll(".settings__agent-actions button")].find(
    (button) => button.textContent === en["settings.agents.row.details"],
  );
  if (!details) throw new Error("no Details button on this row");
  fireEvent.click(details);
  const panel = row.querySelector(".settings__agent-details");
  if (!(panel instanceof HTMLElement)) throw new Error("the disclosure did not open");
  return panel;
}

/** Every catalogued row, with the panel open — the third list is collapsed on open, by design. */
function showCatalog(entries: CatalogEntry[]): { container: HTMLElement; touched: string[] } {
  const shown = show({ catalog: entries });
  const browse = [...shown.container.querySelectorAll("button")].find(
    (button) => button.textContent === en["settings.agents.catalog.browse"],
  );
  if (!browse) throw new Error("no browse button");
  fireEvent.click(browse);
  return shown;
}

const READY = en["settings.agent.verdict.ready"];
const NOT_READY = en["settings.agent.verdict.notReady"];

/* ────────────────────────── the two verdicts ────────────────────────── */

describe("a verdict for every row, with nothing pressed", () => {
  it("gives every row of every list one of exactly two verdicts, on open", () => {
    // **The mutation this fails on:** any row rendering `settings.agent.unchecked` — or rendering no chip at
    // all, which is what a row whose state came from a per-row probe that nobody pressed looks like. Every
    // row here is built from data the daemon already sent, and that is the whole point: nothing is fetched,
    // pressed or waited for between the render and this assertion.
    const { container } = showCatalog([
      entry({ id: "goose", availability: { state: "ready", binary: "/usr/local/bin/goose" } }),
      entry({ id: "cline", install: { kind: "npx", package: "cline@1" }, availability: { state: "ready", binary: "/usr/bin/npx" } }),
      entry({ id: "droid", availability: { state: "unsupported", binary: "/usr/local/bin/droid" } }),
    ]);
    const state = {
      ...show({
        harnesses: [harness({ id: "codex", label: "Codex" })],
        providers: [provider()],
      }).container,
    };
    void state;

    const rows = [...container.querySelectorAll(".settings__agent")].filter((row) =>
      row.querySelector(".settings__agent-head"),
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect([READY, NOT_READY], textOf(row).slice(0, 60)).toContain(verdictOf(row as HTMLElement));
    }
  });

  it("never renders 'not checked', on any page state", () => {
    // The word is deleted from the catalogue and from every row. This asserts the *page*, not the catalogue:
    // a key that came back in one language would fail here.
    for (const key of ["settings.agent.unchecked", "settings.agent.checking", "settings.agent.refused"] as const) {
      expect(Object.keys(en)).not.toContain(key);
    }
    const { container } = showCatalog([entry({ id: "goose" })]);
    expect(textOf(container)).not.toMatch(/not checked/i);
  });

  it("renders the row's one verdict from the daemon's five measured states, two at a time", () => {
    // The projection's own table, driven directly: the five states a machine can be in, and the two words a
    // user reads. A sixth word appearing here is the failure mode this asserts against.
    const cases: [Parameters<typeof rowVerdict>[0]["availability"], string][] = [
      [{ state: "ready", binary: "/usr/local/bin/x" }, READY],
      [{ state: "not-installed", fix: [{ command: INSTALL_GOOSE }] }, NOT_READY],
      [{ state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command: ADAPTER }] }, NOT_READY],
      [{ state: "unsupported", binary: "/usr/local/bin/x" }, NOT_READY],
      [{ state: "unknown" }, NOT_READY],
    ];
    for (const [availability, expected] of cases) {
      const verdict = rowVerdict({ label: "X", availability, readyLine: "Ships with EnvoyCoder" }, tEn, 80);
      expect(tEn(verdict.chipKey), JSON.stringify(availability)).toBe(expected);
    }
    // And the table of chips is closed at two, which is what makes "one of exactly two verdicts" structural.
    expect(Object.keys(VERDICT_CHIP)).toEqual(["ready", "not-ready"]);
  });

  it("rendering the page performs no action at all — nothing is probed, started or added", () => {
    // **The window's half of "loading the page spawns nothing".** The proxy records every member the page
    // touches while it renders, including one it merely reads, so a page that decided to ask the daemon
    // something on mount would show up here whatever it asked. The counterpart at the layer a process would
    // actually start is `catalog-rpc.test.ts`; this one is about the page's own behaviour.
    const catalog = showCatalog([
      entry({ id: "goose", availability: { state: "ready", binary: "/usr/local/bin/goose" } }),
    ]);
    expect(catalog.touched).toEqual([]);

    const plain = show({
      harnesses: [
        harness({
          id: "codex",
          label: "Codex",
          availability: { state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command: ADAPTER }] },
        }),
      ],
      providers: [provider()],
    });
    expect(plain.touched).toEqual([]);
  });

  it("…and the instrument is live: a press does reach the actions", () => {
    // Without this, the zero above is worth nothing — a proxy that was never wired up records nothing for
    // any question. The Sign in button is the one row action in this product, so it is the one that must
    // come through.
    const { container, touched } = show({
      harnesses: [
        harness({ id: "cursor", label: "Cursor", auth: { state: "needs-signin", methodId: "login" } }),
      ],
    });
    fireEvent.click(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === en["settings.agents.signIn"],
      )!,
    );
    expect(touched).toContain("signInAgent");
  });

  it("renders at most one chip per row, and it is one of the two verdicts", () => {
    // **The mandate's own test.** Caveats — `No approvals`, `Cannot be cancelled`, `Temporary copy`,
    // `Needs a sign-in` — were chips beside the state, which is how nine rows carried eighteen of them. They
    // are properties now, and `AgentRow` has no prop through which one could reach a row's face; this asserts
    // the rendered consequence across all three lists at once.
    const { container } = showCatalog([
      entry({ id: "goose", availability: { state: "ready", binary: "/usr/local/bin/goose" } }),
      entry({ id: "droid", availability: { state: "unsupported", binary: "/usr/local/bin/droid" } }),
    ]);
    const rows = [...container.querySelectorAll(".settings__agent")].filter((row) =>
      row.querySelector(".settings__agent-head"),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      const chips = [...row.querySelectorAll(".chip")];
      expect(chips.length, textOf(row).slice(0, 60)).toBeLessThanOrEqual(1);
      expect([READY, NOT_READY]).toContain(chips[0]?.textContent);
    }
  });

  it("keeps the capabilities off a row's face even when they are the caveats a user cares about", () => {
    const { container } = show({
      harnesses: [
        harness({
          id: "codex",
          label: "Codex",
          capabilities: {
            ...harness({ id: "codex" }).capabilities,
            approvals: false,
            cancel: false,
          },
          availability: { state: "ready", binary: "/usr/local/bin/codex", provisional: "npx" },
        }),
      ],
    });
    const row = rowOf(container, "Codex");
    expect([...row.querySelectorAll(".chip")]).toHaveLength(1);
    expect(verdictOf(row)).toBe(READY);
    // …and every one of them is inside the disclosure, as a label and a value.
    const panel = openDetails(row);
    expect(textOf(panel)).toContain(en["settings.agent.fact.asksBefore"]);
    expect(textOf(panel)).toContain(en["settings.agent.fact.no"]);
    expect(textOf(panel)).toContain(en["settings.agent.fact.canBeStopped"]);
    expect(textOf(panel)).toContain(en["settings.agent.provisional.npx"]);
  });
});

/* ────────────────────────── the ways out ────────────────────────── */

describe("a Not ready row says what is wrong, and how to fix it", () => {
  it("leads a connector-missing row with what IS installed, before the command", () => {
    // **The reported bug, and the exact sentence the mandate asks for.** The owner wrote *"Some agents I have
    // installed, but still show need to install or need adapter."* The mutation: leading with the install
    // command, which is a row that tells somebody who has Codex installed that they do not.
    const { container } = show({
      harnesses: [
        harness({
          id: "codex",
          label: "Codex",
          availability: { state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command: ADAPTER }] },
        }),
      ],
    });
    const row = rowOf(container, "Codex");
    const line = textOf(row.querySelector(".settings__agent-line"));
    expect(line.startsWith(en["settings.agent.verdict.connector.lead"])).toBe(true);
    expect(line).toContain(ADAPTER);

    const panel = openDetails(row);
    const lead = textOf(panel.querySelector(".settings__agent-fact--lead"));
    expect(lead).toContain("Codex is installed");
    expect(lead).toBe(tEn("settings.agent.verdict.connector.why", { agent: "Codex" }));
    // The fix is the first thing in the panel, and it is the entry's own command, verbatim.
    //
    // Read from the `<code>` rather than from the `<li>`: the list item now also holds the command's Copy
    // control, so `textOf(li)` would be the command followed by the word *Copy* — an assertion about the
    // control dressed up as an assertion about the command. The intent is unchanged and now precise: the fix
    // is this exact command, and there is exactly one step.
    expect([...panel.querySelectorAll(".settings__agent-steps code")].map((code) => textOf(code))).toEqual([
      ADAPTER,
    ]);
    // **The panel *starts* with the fix**, asserted on the panel rather than inside the guide. The first
    // version of this line checked that the lead paragraph sits before the command list — which is true of the
    // guide's internal order and stays true when the whole guide is moved *below* the facts, so it passed on a
    // mutation that put the properties first and the way out last. A test that green-lights the swap is a test
    // about the wrong element.
    expect(panel.firstElementChild?.className).toBe("settings__agent-guide");
    // And nothing tells the user to install the agent they already have.
    expect(textOf(panel)).not.toContain("npm install -g @openai/codex");
  });

  it("leads an absent row with the install steps, in the order to run them, and its link", () => {
    const { container } = showCatalog([entry({ id: "goose" })]);
    const row = rowOf(container, "goose");
    expect(verdictOf(row)).toBe(NOT_READY);
    const panel = openDetails(row);
    expect(textOf(panel.querySelector(".settings__agent-fact--lead"))).toBe(
      tEn("settings.agent.verdict.absent.why", { agent: "goose" }),
    );
    expect([...panel.querySelectorAll(".settings__agent-steps code")].map((c) => textOf(c))).toEqual([
      `npm install -g goose`,
    ]);
    const link = panel.querySelector(".settings__agent-guide a");
    expect(link?.getAttribute("href")).toBe("https://example.test/install");
  });

  it("does not offer an install step when the gap is ours", () => {
    // **The mandate's distinction, in the DOM rather than in the wording:** *"Distinguish 'there is a fix' from
    // 'there is nothing you can do', in the words and in the layout."* An `unsupported` entry has an
    // `installLink` on it, and the mutation this fails on is rendering that link under a sentence about our
    // missing adapter — which turns our gap into an install the user is told to go and do.
    const { container } = show({
      harnesses: [
        harness({
          id: "codex",
          label: "Codex",
          availability: { state: "unsupported", binary: "/usr/local/bin/codex" },
        }),
      ],
    });
    const row = rowOf(container, "Codex");
    expect(verdictOf(row)).toBe(NOT_READY);
    expect(textOf(row.querySelector(".settings__agent-line"))).toBe(
      en["settings.agent.verdict.gap.line"],
    );

    const panel = openDetails(row);
    expect(textOf(panel.querySelector(".settings__agent-fact--lead"))).toBe(
      tEn("settings.agent.verdict.gap.why", { agent: "Codex" }),
    );
    // No steps, no command, no link — the layout half of the distinction.
    expect(panel.querySelectorAll(".settings__agent-steps")).toHaveLength(0);
    expect(panel.querySelectorAll("a").length).toBe(0);
    expect(textOf(panel)).not.toMatch(/npm install/);
    // **And no fix block.** The block is the highlight a user learns to read as *here is what to run*, so
    // drawing it around our own gap would teach them that our missing adapter is a job for them.
    expect(panel.querySelector(".settings__agent-fix")).toBeNull();
  });

  it("names the unset variable on the row and says where the value comes from", () => {
    // The program is present and the daemon cannot start it. The old row said **Ready** and put the unset
    // variable in a disclosure — two facts a user has to join themselves, in the one situation where pressing
    // Run fails in a way that looks like a bug in the app.
    const { container } = show({
      providers: [
        provider({
          env: [{ name: "ANTHROPIC_API_KEY", set: false }],
        }),
      ],
    });
    const row = rowOf(container, "My Agent");
    expect(verdictOf(row)).toBe(NOT_READY);
    expect(textOf(row.querySelector(".settings__agent-line"))).toBe("ANTHROPIC_API_KEY is not set");

    const panel = openDetails(row);
    const lead = textOf(panel.querySelector(".settings__agent-fact--lead"));
    expect(lead).toBe(
      tEn("settings.agent.verdict.env.why", { agent: "My Agent", names: "ANTHROPIC_API_KEY" }),
    );
    // Named as a variable, and the second half of the sentence answers the question naming it raises.
    expect([...panel.querySelectorAll(".settings__agent-steps code")].map((c) => textOf(c))).toEqual([
      "ANTHROPIC_API_KEY",
    ]);
    expect(lead).toMatch(/environment EnvoyCoder's daemon was started in/);
  });

  it("says the daemon is a build behind rather than blaming the machine or offering an install", () => {
    // The legacy wire: a daemon that does not send `availability` at all. It is our gap in the plainest sense,
    // and the fix is a restart — never an install of a program we never established was missing.
    const { container } = show({
      // `as unknown as` because the *point* of this fixture is a field the protocol requires and an older
      // daemon does not send — a cast the type system is right to complain about, made deliberately.
      harnesses: [
        { ...harness({ id: "codex", label: "Codex" }), availability: undefined } as unknown as HarnessSummary,
      ],
    });
    const row = rowOf(container, "Codex");
    expect(verdictOf(row)).toBe(NOT_READY);
    expect(textOf(row.querySelector(".settings__agent-line"))).toBe(
      en["settings.agent.verdict.legacy.line"],
    );
    const panel = openDetails(row);
    expect(textOf(panel)).toContain(en["settings.agent.verdict.app.restart"]);
    expect(panel.querySelectorAll(".settings__agent-steps")).toHaveLength(0);
    expect(textOf(panel)).not.toMatch(/npm install/);
  });

  it("reveals the guide from the Not-ready chip itself, as a real button", () => {
    // *"clicking Not ready reveals how to resolve it"*, in the mandate's words. The chip is a `<button>` with
    // `aria-expanded` and `aria-controls` pointing at the same panel the `Details` button opens; a **Ready**
    // chip is a plain `<span>`, because it has nothing to reveal and a control that does nothing is worse
    // than the absence of one.
    const { container } = show({
      harnesses: [
        harness({
          id: "codex",
          label: "Codex",
          availability: { state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command: ADAPTER }] },
        }),
        harness({ id: "deepseek-harness", label: "DeepSeek Harness" }),
      ],
    });

    const notReady = rowOf(container, "Codex").querySelector(".settings__agent-state");
    expect(notReady?.tagName).toBe("BUTTON");
    expect(notReady?.getAttribute("aria-expanded")).toBe("false");
    const target = notReady?.getAttribute("aria-controls");
    expect(target).toBeTruthy();
    // The accessible name starts with the visible label (WCAG 2.5.3) and names the row, so a screen-reader
    // user can tell eight identical `Not ready` chips apart.
    expect(notReady?.getAttribute("aria-label")).toBe(
      tEn("settings.agent.verdict.notReady.aria", { agent: "Codex" }),
    );

    fireEvent.click(notReady!);
    expect(rowOf(container, "Codex").querySelector(".settings__agent-state")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(rowOf(container, "Codex").querySelector(`#${target}`)).toBeTruthy();

    const ready = rowOf(container, "DeepSeek Harness").querySelector(".settings__agent-state");
    expect(ready?.tagName).toBe("SPAN");
    expect(ready?.getAttribute("aria-expanded")).toBeNull();
  });
});

/* ────────────────────────── the npx case, and the deep facts ────────────────────────── */

describe("the facts that are not problems, and the ones that cannot be known cheaply", () => {
  it("treats an npx recipe as Ready, and says it is fetched on the first run", () => {
    // **The mandate's fifth bullet:** *"an `npx` recipe → it is not a problem: the program is fetched on first
    // run, and say so."* The mutation: the old `ready-npx` state, a sixth word whose whole job was to warn
    // about something that happens by itself — 14 rows reading "Not downloaded yet" as if that were broken.
    const { container } = showCatalog([
      entry({
        id: "cline",
        install: { kind: "npx", package: "cline@3.0.46" },
        availability: { state: "ready", binary: "/usr/bin/npx" },
      }),
    ]);
    const row = rowOf(container, "cline");
    expect(verdictOf(row)).toBe(READY);
    // Nothing on the face of the row warns, and nothing offers an install for a package that installs itself.
    expect(textOf(row)).not.toContain(en["settings.agent.verdict.notReady"]);
    expect(textOf(row)).not.toMatch(/not downloaded/i);
    // …and the honesty lives in the property, which says how it is obtained and what was measured.
    const panel = openDetails(row);
    expect(textOf(panel)).toContain(
      tEn("settings.agent.fact.obtained.npx", { package: "cline@3.0.46" }),
    );
    expect(panel.querySelectorAll(".settings__agent-steps")).toHaveLength(0);
  });

  it("carries the deep facts as properties with the time they were observed", () => {
    // *"Whether an agent speaks ACP, what it publishes and whether it needs a sign-in require starting it"* —
    // so they are never a row state. `Verified` is a relative time in the user's own language
    // (`Intl.RelativeTimeFormat`), followed by the absolute timestamp, and the row's chip says nothing about
    // them. The mutation: dropping the timestamp leaves a promise where an observation belongs.
    const observedAt = new Date(Date.now() - 4 * 60_000).toISOString();
    const { container } = show({
      harnesses: [
        harness({
          id: "deepseek-harness",
          label: "DeepSeek Harness",
          models: {
            kind: "listed",
            options: [{ id: "x/y", label: "y", provider: "x", model: "y" }],
            source: "session",
            observedAt,
          },
          thinking: { kind: "listed", options: [{ value: "low", label: "Low" }], source: "session", observedAt },
          auth: { state: "needs-signin", methodId: "login", observedAt },
        }),
      ],
    });
    const row = rowOf(container, "DeepSeek Harness");
    // The verdict is about the machine, not about what has been observed: this agent is installed and drivable.
    expect(verdictOf(row)).toBe(READY);
    // A sign-in requirement is a fact, and the Sign in button is still the one row action.
    expect(textOf(row)).not.toContain(en["settings.agent.fact.signIn.needed"]);

    const panel = openDetails(row);
    expect(textOf(panel)).toContain(en["settings.agent.fact.verified"]);
    expect(textOf(panel)).toMatch(/4 minutes ago/);
    expect(textOf(panel)).toContain(en["settings.agent.fact.signIn.needed"]);
    // The published lists are properties too, and the agent's own words are not translated.
    expect(textOf(panel)).toContain(en["settings.agent.models.title"]);
    expect(textOf(panel)).toContain("y");
  });

  it("says why nothing has been observed rather than leaving a blank to hunt through", () => {
    // The one state where a user might be tempted to look for a button. `verified.never` answers the question
    // the absence raises — that learning it means starting the agent — so nobody goes looking for a control
    // that would tell them. This is the honest form of *"we cannot know this without doing something
    // expensive"*: the expense is named, and it is one we pay on a run rather than one we charge to a press.
    const facts = verdictFacts(
      { availability: { state: "ready", binary: "/usr/local/bin/x" }, harness: harness({ id: "codex" }), locale: "en" },
      tEn,
    );
    const verified = facts.find((fact) => fact.label === en["settings.agent.fact.verified"]);
    expect(verified?.value).toBe(en["settings.agent.fact.verified.never"]);
    expect(verified?.value).toMatch(/starts an agent/);
  });

  it("answers a row whose capability list is absent without inventing one", () => {
    // The legacy daemon again, one field further in: `models` and `thinking` are required by the protocol and
    // a build behind does not send them. The properties say so instead of the page crashing, and the
    // sentence is the same one for both.
    const legacy = { ...harness({ id: "codex", label: "Codex" }) } as Record<string, unknown>;
    delete legacy.models;
    delete legacy.thinking;
    const facts = verdictFacts(
      {
        availability: { state: "ready", binary: "/usr/local/bin/codex" },
        harness: legacy as unknown as HarnessSummary,
        locale: "en",
      },
      tEn,
    );
    const publishes = facts.find((fact) => fact.label === en["settings.agent.fact.publishes"]);
    expect(publishes?.value).toBe(tEn("settings.agent.notDeclared", { agent: "Codex" }));
  });
});

/* ────────────────────────── looking at the machine again ────────────────────────── */

/**
 * **The owner's question, on the page it was asked about:** *"After I run
 * `npm install -g @agentclientprotocol/codex-acp`, how do we let EnvoyCoder know that without restarting?"*
 *
 * The daemon re-measures on every read, so the answer to *"does the page know?"* is entirely about whether
 * something makes it read again. This is that something: one page-level press, rendered beside the count it
 * invalidates, and gated on the method the daemon actually serves — the build-skew rule this whole pane
 * follows, because the shell attaches to whichever daemon owns the port.
 */
describe("checking this machine again", () => {
  it("offers the press, and it reaches the daemon exactly once", async () => {
    const { container, touched } = show({}, ["coder.recheckAgents"]);
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === en["settings.agents.recheck"],
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("no Check again control");

    // It says what it does before it is pressed, including what it does *not* do — nothing is started.
    expect(button.getAttribute("title")).toBe(en["settings.agents.recheck.title"]);
    fireEvent.click(button);
    await waitFor(() => expect(touched).toContain("recheckAgents"));
    expect(touched.filter((name) => name === "recheckAgents")).toHaveLength(1);
    // And it comes back to its resting label, so the control is usable a second time — which is the point of
    // the flag the page clears in a `finally`.
    await waitFor(() => expect(button.textContent).toBe(en["settings.agents.recheck"]));
  });

  it("is not rendered at all when the daemon is a build behind", () => {
    // The other half of the same rule: no control whose press would come back "Method not found". A page that
    // drew it anyway would be offering a gesture with nothing behind it, which is the one thing this pane's
    // laws forbid outright.
    const { container } = show();
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === en["settings.agents.recheck"],
    );
    expect(button).toBeUndefined();
  });
});

/* ────────────────────────── the fix, highlighted and copyable ────────────────────────── */

/**
 * **The owner's second report on this page:** *"can we highlight the info on each agent … we want to highlight
 * it and let user know how to resolve it."* Three facts, and each is a DOM fact rather than an adjective:
 *
 *   1. the fix is a **block** (`settings__agent-fix`), and it is drawn **exactly when** there is something for
 *      the user to do — never around our own gap, which is what the earlier slice's "our gap is not your
 *      install" rule would otherwise lose to a pretty callout;
 *   2. the command inside it is the command, verbatim, in the element the stylesheet sets apart;
 *   3. **Copy** is offered, and it tells the truth in both directions — the label says *Copied* only when the
 *      clipboard actually received the text, and says so plainly when it did not. A tick over a command that
 *      is not on the clipboard is the mutation the failure leg exists to fail.
 */
describe("the fix is highlighted, and it can be copied", () => {
  /** Put a clipboard on `navigator`, and record what was written. Removed after each leg. */
  function stubClipboard(write: (text: string) => Promise<void>): { written: string[] } {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          written.push(text);
          return write(text);
        },
      },
    });
    return { written };
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("draws the block exactly when there is something to do, and never for our own gap", () => {
    // The invariant, driven from both sides in one place: a callout that says *here is what to run* must not be
    // drawn around our own gap, or the layout stops distinguishing "there is a fix" from "there is nothing you
    // can do" — the distinction the earlier slice bought with words and lost the moment it was a matter of taste.
    const cases: { what: string; availability: HarnessSummary["availability"]; block: boolean }[] = [
      { what: "ready", availability: { state: "ready", binary: "/usr/local/bin/codex" }, block: false },
      {
        what: "needs its connector",
        availability: { state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command: ADAPTER }] },
        block: true,
      },
      {
        what: "not installed",
        availability: { state: "not-installed", fix: [{ command: INSTALL_GOOSE }] },
        block: true,
      },
      {
        what: "undrivable by us",
        availability: { state: "unsupported", binary: "/usr/local/bin/codex" },
        block: false,
      },
      { what: "unchecked", availability: { state: "unknown" }, block: false },
    ];

    for (const one of cases) {
      const { container } = show({
        harnesses: [harness({ id: "codex", label: "Codex", availability: one.availability })],
      });
      const panel = openDetails(rowOf(container, "Codex"));
      expect(panel.querySelector(".settings__agent-fix") !== null, `the ${one.what} case`).toBe(one.block);
      cleanup();
    }
  });

  it("puts the lead, the verbatim command and Copy inside one highlighted block", () => {
    const { container } = show({
      harnesses: [
        harness({
          id: "codex",
          label: "Codex",
          availability: { state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command: ADAPTER }] },
        }),
      ],
    });
    const panel = openDetails(rowOf(container, "Codex"));
    const block = panel.querySelector(".settings__agent-fix");
    if (!(block instanceof HTMLElement)) throw new Error("no fix block");

    // The sentence that explains the state is the block's headline, not a footnote beside it.
    expect(textOf(block.querySelector(".settings__agent-fact--lead"))).toBe(
      tEn("settings.agent.verdict.connector.why", { agent: "Codex" }),
    );
    // The command, verbatim, in the element the sheet sets apart.
    const command = block.querySelector(".settings__agent-fix .settings__agent-command");
    expect(textOf(command)).toBe(ADAPTER);
    // And the block sits before the properties: the way out first, the facts second, which is the order the
    // panel was already built in and the one a reader needs.
    expect(panel.firstElementChild?.className).toBe("settings__agent-guide");
  });

  it("copies the command, and says Copied only once the clipboard has it", async () => {
    const { written } = stubClipboard(async () => undefined);
    const { container } = show({
      harnesses: [
        harness({
          id: "codex",
          label: "Codex",
          availability: { state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command: ADAPTER }] },
        }),
      ],
    });
    const panel = openDetails(rowOf(container, "Codex"));
    const copy = panel.querySelector(".settings__agent-copy");
    if (!(copy instanceof HTMLButtonElement)) throw new Error("no Copy control");

    // The accessible name begins with the printed word (WCAG 2.5.3) and names exactly what will be copied —
    // eight buttons all called *Copy* is a list a voice-control user cannot navigate.
    expect(copy.textContent).toBe(en["settings.agents.fix.copy"]);
    expect(copy.getAttribute("aria-label")).toBe(tEn("settings.agents.fix.copy.aria", { command: ADAPTER }));

    fireEvent.click(copy);
    await waitFor(() => expect(copy.textContent).toBe(en["settings.agents.fix.copied"]));
    expect(written).toEqual([ADAPTER]);
  });

  it("says the copy failed rather than showing a tick over a command that is not on the clipboard", async () => {
    // The mutation: `void navigator.clipboard.writeText(…)` with an unconditional *Copied* label. On a machine
    // where the write is refused — an insecure context, a denied permission — that is a control telling the
    // user something untrue about their own machine, which is the one thing this product's rules forbid
    // everywhere else.
    const { written } = stubClipboard(async () => {
      throw new Error("clipboard refused");
    });
    const { container } = show({
      harnesses: [
        harness({
          id: "codex",
          label: "Codex",
          availability: { state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command: ADAPTER }] },
        }),
      ],
    });
    const panel = openDetails(rowOf(container, "Codex"));
    const copy = panel.querySelector(".settings__agent-copy");
    if (!(copy instanceof HTMLButtonElement)) throw new Error("no Copy control");

    fireEvent.click(copy);
    await waitFor(() => expect(copy.textContent).toBe(en["settings.agents.fix.failed"]));
    expect(copy.textContent).not.toBe(en["settings.agents.fix.copied"]);
    expect(written).toEqual([ADAPTER]);
    // The command is still on screen and still selectable — the fallback a user has when a copy fails.
    expect(textOf(panel.querySelector(".settings__agent-command"))).toBe(ADAPTER);
  });

  it("offers no Copy where copying cannot work, and still shows the command", () => {
    // jsdom has neither `navigator.clipboard` nor `execCommand`, which is exactly the state this leg needs:
    // the control is not rendered rather than rendered dead, and the command a user would type is still there.
    const { container } = show({
      harnesses: [
        harness({
          id: "codex",
          label: "Codex",
          availability: { state: "needs-bridge", agentBinary: "/usr/local/bin/codex", fix: [{ command: ADAPTER }] },
        }),
      ],
    });
    const panel = openDetails(rowOf(container, "Codex"));
    const block = panel.querySelector(".settings__agent-fix");
    if (!(block instanceof HTMLElement)) throw new Error("no fix block");
    expect(block.querySelectorAll("button")).toHaveLength(0);
    expect(textOf(block.querySelector(".settings__agent-command"))).toBe(ADAPTER);
  });
});
