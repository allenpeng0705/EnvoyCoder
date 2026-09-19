/**
 * The settings bar: what it lists, what it says, how a keyboard reaches it, and how it degrades.
 *
 * ## The two questions this file exists to answer
 *
 *   1. **Does every item in the bar lead to something?** The owner's brief names eleven sections from the
 *      reference product and the failure mode in the same breath — *"an eleven-item bar of empty pages is
 *      the failure mode, not the goal."* So the bar's contents are compared with the registry, the
 *      registry's own citations are re-read against the files they name, and **every section is rendered
 *      and refused if its body has no row in it.** Three ways to fail, none of them a reviewer's memory.
 *   2. **Is the bar one navigation or two?** A section is a scope: pressing an item hands a scope to the
 *      shell, the item is marked because the scope says so (`scopeSection`), and the same registry is what
 *      a narrow window renders as its page. The keyboard assertions are the part a screenshot cannot
 *      check: one tab stop for the whole bar, arrows inside it, and real `<button>`s — Enter and Space
 *      activate them because the browser does that for a button, not because jsdom synthesises a click.
 *
 * ## What each mutation is, stated so the test can be trusted
 *
 * Each case below was checked against a deliberate break, and the break is named in the test:
 *
 * | test | the mutation that fails it |
 * |---|---|
 * | "lists the registry, in order" | a hardcoded item, or an item rendered out of registry order |
 * | "every section it lists renders something" | a registry entry whose page renders `<></>` |
 * | "re-reads every citation" | a citation pointing at a file or a line that moved |
 * | "switching sections changes the content" | a bar item that navigates to the same scope |
 * | "marks the current section" | a mark taken from a local selection rather than the scope |
 * | "one tab stop, arrow keys inside it" | `tabIndex` on every item, or no arrow handling |
 * | "the bar is not rendered / the list is the page" | rendering the bar at 900px, or the list with one |
 * | "lists only the bindings the shell mounted" | the table rendered instead of `wiredBindings` |
 */

/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { JSX } from "react";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings, Project } from "@envoydev/protocol";

import { CoderApp } from "../src/components/CoderApp.js";
import { stubAgentActions } from "./fixtures/agent-actions.js";
import { SettingsPane } from "../src/components/SettingsPane.js";
import { WIDE_LAYOUT_QUERY } from "../src/components/SettingsNav.js";
import { en } from "../src/i18n/messages/en.js";
import { I18nProvider } from "../src/i18n/context.js";
import { SHELL_BINDINGS, wiredBindings, type ShortcutActions } from "../src/input/shortcuts.js";
import type { AgentActions } from "../src/state/agent-actions.js";
import type { CoderState, CoderStore } from "../src/state/coderStore.js";
import {
  PROJECTS_SCOPE,
  SECTIONS_SCOPE,
  appScope,
  scopeForSection,
  type SettingsLayout,
  type SettingsScope,
} from "../src/state/settings-scope.js";
import {
  DEFAULT_SECTION_ID,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "../src/state/settings-sections.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

afterEach(cleanup);

/* ────────────────────────── the fixture ────────────────────────── */

const settings: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "en",
};

const project: Project = {
  id: "local::/work/api",
  path: "/work/api",
  label: "api",
  hostId: "local",
  addedAt: "2026-09-01T09:00:00.000Z",
};

/** The four ids the shell mounts actions for — see `WIRED` below. */
const WIRED: ShortcutActions = {
  "commandCenter.open": () => {},
  "search.find": () => {},
  newTask: () => {},
  "settings.open": () => {},
};

const harnesses: CoderState["harnesses"] = (["envoy-harness", "deepseek-harness"] as const).map((id) => ({
  id,
  // The preference and the auth fact, at their shipped values: nothing is hidden until the user says so, and
  // nothing has been probed yet — see `HarnessSummary` for why neither may be absent.
  hidden: false,
  auth: { state: "unknown" as const },
  label: id === "envoy-harness" ? "Envoy Harness" : "DeepSeek Harness",
  tier: id === "envoy-harness" ? ("built-in" as const) : ("catalogued" as const),
  summary: "…",
  modes: [{ id: "plan", label: "plan" }],
  models: {
    kind: "listed" as const,
    options: [
      { id: "deepseek/deepseek-chat", label: "deepseek-chat", provider: "deepseek", model: "deepseek-chat" },
    ],
    source: "…",
  },
  thinking: { kind: "none" as const, options: [], source: "…" },
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
  availability: { state: "ready" as const, binary: "/usr/local/bin/agent" },
  evidence: "…",
}));

function stateWith(over: Partial<CoderState> = {}): CoderState {
  return {
    connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
    resolved: undefined,
    hello: {
      product: "EnvoyDev",
      version: "0.1.0",
      instanceId: "test",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyDev",
      startedAt: "2026-09-14T00:00:00.000Z",
      windowCount: 2,
      methods: [],
      mesh: { kind: "no-node" },
      notes: [],
    },
    projects: [project],
    tasks: [],
    tasksKnown: true,
    settings,
    harnesses,
    // A window with no agents the user declared: the list the daemon serves when none exist.
    providers: [],
  catalog: [],
    mesh: { kind: "no-node", reason: "" },
    runs: {},
    loaded: true,
    error: undefined,
    notes: [],
    ...over,
  };
}

/** The pane on its own, with the layout spelled out — the two lines the shell resolves. */
function showPane(
  scope: SettingsScope,
  layout: SettingsLayout = "wide",
  over: Partial<CoderState> = {},
): { container: HTMLElement } {
  const { container } = render(
    <I18nProvider preference="en">
      <SettingsPane
        state={stateWith(over)}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        scope={scope}
        layout={layout}
        shortcuts={wiredBindings(WIRED)}
        onNavigate={vi.fn()}
        agents={noAgentActions}
      />
    </I18nProvider>,
  );
  return { container };
}

/**
 * The agents page's actions, for panes that never reach them.
 *
 * `SettingsPaneProps.agents` is **required**, because a caller that could render the agents page with no way
 * to act would render four controls that do nothing — the defect this pane was rebuilt to remove. These tests
 * assert the bar, the pages and the citations, so their bundle answers nothing; the tests that press the
 * buttons are in `settings-agents-catalog.test.tsx`, against a fake that records what was sent. The stub
 * comes from the shared fixture rather than a local object cast `as unknown as AgentActions`, because
 * that cast is how `listPairedDevices` went missing here and turned an unwired actions bundle into an
 * unhandled `TypeError` beside a passing test.
 */
const noAgentActions: AgentActions = stubAgentActions();

/** The bar, as a landmark. Its accessible name is the catalogue's, not a string in this file. */
const nav = (): HTMLElement => screen.getByRole("navigation", { name: en["settings.nav.aria"] });

/** The bar's items, in document order. */
const items = (): HTMLElement[] => within(nav()).getAllByRole("button");

/** The body — the scrolling region the page is rendered into, as opposed to the bar beside it. */
const body = (container: HTMLElement): HTMLElement => {
  const found = container.querySelector(".settings");
  if (!(found instanceof HTMLElement)) throw new Error("the pane rendered no body");
  return found;
};

/* ────────────────────────── the gate on the registry ────────────────────────── */

/**
 * Everything wrong with a registry, from the files it cites.
 *
 * Written as a function over a registry rather than as a loop over the real one so that **the negative
 * case can be tested**: a fabricated section with no content, or with a citation that no longer resolves,
 * has to be reported, or the check is a check nobody has seen fail.
 */
function sectionProblems(sections: readonly SettingsSection[]): string[] {
  const problems: string[] = [];
  for (const section of sections) {
    if (section.content.length === 0) {
      problems.push(`${section.id}: names no content at all`);
      continue;
    }
    for (const entry of section.content) {
      let text: string | undefined;
      try {
        text = readFileSync(join(ROOT, entry.file), "utf8");
      } catch {
        problems.push(`${section.id}: ${entry.file} does not exist`);
        continue;
      }
      if (!text.includes(entry.needle)) {
        problems.push(`${section.id}: ${entry.file} no longer contains ${JSON.stringify(entry.needle)}`);
      }
    }
  }
  return problems;
}

describe("the registry is the bar's own list, and it is checkable", () => {
  it("lists the registry, in order, and nothing else", () => {
    // **The mutation this fails on:** a ninth item hardcoded into the bar, or a list rendered in a
    // different order from the registry. Both are the "someone added a section by editing the JSX" path,
    // and both are caught by comparing the rendered names with the registry's own keys.
    showPane(appScope("general"));
    const rendered = items().map((item) => item.getAttribute("aria-label"));
    expect(rendered).toEqual(SETTINGS_SECTIONS.map((section) => en[section.titleKey]));
    expect(rendered).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it("re-reads every citation in the registry against the file it names", () => {
    // The registry claims what is in each section. This is the half a test can prove: the file is there,
    // and the source text it cites is still in it.
    expect(sectionProblems(SETTINGS_SECTIONS)).toEqual([]);
    // And it bites, proved on a fabricated registry rather than on the real one: no content, a missing
    // file, and a moved line are each reported.
    const base = SETTINGS_SECTIONS[0]!;
    expect(sectionProblems([{ ...base, content: [] }])).toEqual(["general: names no content at all"]);
    expect(
      sectionProblems([{ ...base, content: [{ file: "apps/desktop/src/nope.tsx", needle: "x", because: "…" }] }]),
    ).toEqual(["general: apps/desktop/src/nope.tsx does not exist"]);
    expect(
      sectionProblems([
        { ...base, content: [{ file: base.content[0]!.file, needle: "no-such-text-anywhere", because: "…" }] },
      ]),
    ).toEqual([
      `general: ${base.content[0]!.file} no longer contains "no-such-text-anywhere"`,
    ]);
  });

  it("renders every section it lists, and refuses one whose page is empty", () => {
    // **The mutation this fails on:** a registry entry whose page renders `<></>`. Each section is
    // rendered on its own, and its body must hold at least one row — a control, a list item or a
    // definition row. A page that renders nothing is a bar item that leads to nothing, which is the
    // failure mode the whole restructure is against.
    for (const section of SETTINGS_SECTIONS) {
      cleanup();
      const { container } = showPane(scopeForSection(section.id));
      const pane = body(container);
      const rows = pane.querySelectorAll("button, select, input, textarea, li, .setting");
      expect(rows.length, `${section.id} renders no row at all`).toBeGreaterThan(0);
      // And the rows are the page's, not the bar's: the body is a sibling of the column, never a parent
      // of it — a `body` that contained the nav would make every count above true for the wrong reason.
      expect(pane.contains(nav()), `${section.id}: the body contains the bar`).toBe(false);
      // …and the page says which section it is, in the same words as the item that opened it.
      expect(screen.getByRole("heading", { name: en[section.titleKey] })).toBeTruthy();
    }
  });
});

/* ────────────────────────── switching, and the mark ────────────────────────── */

describe("the bar, as navigation", () => {
  /**
   * The pane with **real** navigation: `onNavigate` stores the scope in a `useState`, exactly as the
   * shell does, so a press actually changes the page. A stubbed callback would let every assertion below
   * pass on a bar that navigates nowhere.
   */
  function Navigable(props: { layout?: SettingsLayout; initial?: SettingsScope }): JSX.Element {
    const [scope, setScope] = useState<SettingsScope>(props.initial ?? appScope(DEFAULT_SECTION_ID));
    return (
      <I18nProvider preference="en">
        <SettingsPane
          state={stateWith()}
          onClose={vi.fn()}
          onUpdate={vi.fn()}
          scope={scope}
          layout={props.layout ?? "wide"}
          shortcuts={wiredBindings(WIRED)}
          agents={noAgentActions}
          onNavigate={setScope}
        />
      </I18nProvider>
    );
  }

  it("switching sections changes the content", () => {
    // **The mutation this fails on:** an item whose handler navigates to the scope it is already on.
    // Asserted as a difference between two sections' content, not as "a page appeared".
    render(<Navigable />);
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
    expect(screen.getByLabelText("Language")).toBeTruthy();

    fireEvent.click(within(nav()).getByRole("button", { name: "Safety" }));

    expect(screen.getByRole("heading", { name: "Safety" })).toBeTruthy();
    expect(screen.getByLabelText("Ask before anything destructive")).toBeTruthy();
    // The section that was on screen is gone, all of it: not only its heading.
    expect(screen.queryByRole("heading", { name: "General" })).toBeNull();
    expect(screen.queryByLabelText("Language")).toBeNull();
  });

  it("marks the current section, and only that one", () => {
    // **The mutation this fails on:** a mark kept as local state in the bar instead of read from the
    // scope. Every item is asserted, so a bar that marked the first item — or marked two — fails.
    render(<Navigable />);
    fireEvent.click(within(nav()).getByRole("button", { name: "This machine" }));

    const marked = items().filter((item) => item.getAttribute("aria-current") === "page");
    expect(marked).toHaveLength(1);
    expect(marked[0]?.getAttribute("aria-label")).toBe("This machine");
    // The page agrees with the mark: one value is behind both.
    expect(screen.getByRole("heading", { name: "This machine" })).toBeTruthy();
  });

  it("marks Projects while a project's own settings are open, because that is where they belong", () => {
    // A project's scope is reached from the Projects page (or the rail's menu), and its back control
    // returns there — so the bar marks the page it came from, not the project's own name, which is not a
    // section at all.
    cleanup();
    showPane(PROJECTS_SCOPE);
    expect(within(nav()).getByRole("button", { name: "Projects", current: "page" })).toBeTruthy();
    expect(items().filter((item) => item.getAttribute("aria-current") === "page")).toHaveLength(1);
  });
});

/* ────────────────────────── the keyboard ────────────────────────── */

describe("reaching the bar from the keyboard", () => {
  it("is one tab stop, with every item a real button", () => {
    // **Why a `<button>` rather than a `tabindex`ed `<div>`:** a real button is activated by Enter and
    // Space by the browser. jsdom does not synthesise the click a real Enter produces, so asserting a
    // keydown handler here would prove nothing about the browser; asserting the element is what does.
    showPane(appScope("safety"));
    const all = items();
    expect(all.length).toBe(SETTINGS_SECTIONS.length);
    for (const item of all) {
      expect(item.tagName, item.getAttribute("aria-label") ?? "?").toBe("BUTTON");
    }
    // One tab stop for the whole bar, and it is the section the pane is on — a tab stop per item would
    // put eight stops between the rail and the page a user asked for.
    const tabbable = all.filter((item) => item.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]?.getAttribute("aria-label")).toBe("Safety");
    for (const item of all) {
      if (item !== tabbable[0]) expect(item.tabIndex).toBe(-1);
    }
  });

  it("moves focus with the arrow keys, and wraps at both ends", () => {
    // **The mutation this fails on:** no `onKeyDown` (the arrows would scroll the page instead), or a
    // `move` that forgets the wrap. Focus is asserted on `document.activeElement`, which is the only
    // thing an arrow key is allowed to change here: it must not open the section it lands on.
    showPane(appScope("general"));
    const all = items();
    all[0]!.focus();
    expect(document.activeElement).toBe(all[0]);

    fireEvent.keyDown(all[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(all[1]);
    // Still on General: moving focus is not navigating.
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
    expect(all[1]!.getAttribute("aria-current")).toBeNull();

    fireEvent.keyDown(all[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(all[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(all[all.length - 1]);

    fireEvent.keyDown(all[all.length - 1]!, { key: "Home" });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(all[0]!, { key: "End" });
    expect(document.activeElement).toBe(all[all.length - 1]);
  });

  it("activates the focused item — because it is a button, and its press navigates", () => {
    // The two halves of "Enter works": the element is a button (above), and pressing it goes somewhere.
    // `onNavigate` is asserted with the *scope* the shell stores, not with a callback firing.
    const navigated: SettingsScope[] = [];
    render(
      <I18nProvider preference="en">
        <SettingsPane
          state={stateWith()}
          onClose={vi.fn()}
          onUpdate={vi.fn()}
          scope={appScope("general")}
          layout="wide"
          shortcuts={wiredBindings(WIRED)}
          agents={noAgentActions}
          onNavigate={(next) => navigated.push(next)}
        />
      </I18nProvider>,
    );
    const safety = within(nav()).getByRole("button", { name: "Safety" });
    safety.focus();
    expect(document.activeElement).toBe(safety);
    fireEvent.click(safety);
    expect(navigated).toEqual([appScope("safety")]);
  });
});

/* ────────────────────────── the narrow window ────────────────────────── */

describe("what the bar does when there is no room for it", () => {
  /** The viewport query, stubbed — the hook reads `matchMedia` and jsdom has none. */
  function stubViewport(matches: boolean): string[] {
    const queries: string[] = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => {
        queries.push(query);
        return {
          matches,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        };
      },
    });
    return queries;
  }

  beforeEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  function showShell(): void {
    const actions = {
      createTask: vi.fn(),
      startRun: vi.fn(),
      updateTask: vi.fn(),
      addProject: vi.fn(),
      removeProject: vi.fn(),
      archiveTask: vi.fn(),
      updateProject: vi.fn(),
      openTask: vi.fn(),
      sendToRun: vi.fn(),
      cancelRun: vi.fn(),
      answerApproval: vi.fn(),
      updateSettings: vi.fn(),
      clearError: vi.fn(),
    } as unknown as CoderStore;
    render(
      <I18nProvider preference="en">
        <CoderApp state={stateWith()} actions={actions} />
      </I18nProvider>,
    );
    // The rail's footer button, which is where the owner's brief says settings are opened.
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  }

  it("renders the list of sections as the page, with no bar at all", () => {
    // **The mutation this fails on:** rendering the bar at 900px (two columns squeezed into a window
    // that has no room for them), or rendering the list with nothing to press.
    const queries = stubViewport(false);
    showShell();
    expect(queries[0]).toBe(WIDE_LAYOUT_QUERY);
    expect(screen.queryByRole("navigation", { name: en["settings.nav.aria"] })).toBeNull();
    // The list is the page: its own title, its own sentence, and one row per section.
    expect(screen.getByRole("heading", { name: en["settings.title"] })).toBeTruthy();
    expect(screen.getByText(en["settings.sections.note"])).toBeTruthy();
    for (const section of SETTINGS_SECTIONS) {
      expect(screen.getByRole("button", { name: en[section.titleKey] })).toBeTruthy();
    }
  });

  it("opens a section from the list and comes back with the back control", () => {
    // The hierarchy the pane already had, walked: list → page → list. The section page shows the
    // sentence the bar would have carried (so nothing is lost with the bar), and its back control names
    // its destination — the list of every section.
    stubViewport(false);
    showShell();
    fireEvent.click(screen.getByRole("button", { name: "New tasks" }));

    expect(screen.getByRole("heading", { name: "New tasks" })).toBeTruthy();
    expect(screen.getByText(en["settings.section.tasks.detail"])).toBeTruthy();
    expect(screen.getByLabelText("The agent new tasks start with")).toBeTruthy();
    // Nothing of the sections list is left on this page except the way back to it.
    expect(screen.queryByRole("button", { name: "About" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: en["settings.back"] }));

    expect(screen.getByRole("heading", { name: en["settings.title"] })).toBeTruthy();
    expect(screen.getByRole("button", { name: "About" })).toBeTruthy();
  });

  it("still opens on a section, and still shows the bar, when there is room", () => {
    // The other side of the same decision: the window's shape decides where opening lands, and nothing
    // else about the navigation changes.
    stubViewport(true);
    showShell();
    expect(nav()).toBeTruthy();
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
    // On a wide window the section's sentence is the bar item's second band, and the page does not repeat
    // it: one sentence, rendered where it can be read.
    expect(within(items()[0]!).getByText(en["settings.section.general.detail"])).toBeTruthy();
    expect(screen.getAllByText(en["settings.section.general.detail"])).toHaveLength(1);
  });

  it("falls back to the window with the bar when nothing can report a width", () => {
    // jsdom has no `matchMedia`, and neither does any other non-browser renderer. The bar is the
    // *addition* to the layout this pane already had, so the fallback is the richer layout — asserted
    // here so that the fallback is a decision rather than an accident of a missing API.
    showShell();
    expect(nav()).toBeTruthy();
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
  });
});

/* ────────────────────────── the bar's pages, as pages ────────────────────────── */

describe("the pages the bar opens", () => {
  it("lists only the keyboard bindings the shell mounted an action for", () => {
    // **The mutation this fails on:** rendering `SHELL_BINDINGS` instead of `wiredBindings(actions)`.
    // Three of the seven declared bindings have no action in this build, and a page that printed their
    // combos would advertise keys that do nothing — in the pane whose rule is that a row must not do
    // that. Asserted through the shell, because the shell is the only thing that knows which actions
    // exist.
    const wired = wiredBindings(WIRED);
    expect(wired.map((binding) => binding.id)).toEqual([
      "commandCenter.open",
      "newTask",
      "search.find",
      "settings.open",
    ]);
    expect(wired.length).toBeLessThan(SHELL_BINDINGS.length);

    const actions = {
      createTask: vi.fn(),
      startRun: vi.fn(),
      updateTask: vi.fn(),
      addProject: vi.fn(),
      removeProject: vi.fn(),
      archiveTask: vi.fn(),
      updateProject: vi.fn(),
      openTask: vi.fn(),
      sendToRun: vi.fn(),
      cancelRun: vi.fn(),
      answerApproval: vi.fn(),
      updateSettings: vi.fn(),
      clearError: vi.fn(),
    } as unknown as CoderStore;
    render(
      <I18nProvider preference="en">
        <CoderApp state={stateWith()} actions={actions} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(within(nav()).getByRole("button", { name: "Keyboard shortcuts" }));

    expect(screen.getByText("New task")).toBeTruthy();
    expect(screen.getByText("Open the command center")).toBeTruthy();
    // The declared-but-unmounted three, absent with their combos.
    expect(screen.queryByText("New window")).toBeNull();
    expect(screen.queryByText("Keyboard shortcuts", { selector: ".setting__title" })).toBeNull();
    expect(screen.queryByText("Stop the agent")).toBeNull();
  });

  it("says what the daemon told it, and where it leaves its files", () => {
    // The page is a read-out of `coder.hello`, so the values are the daemon's own — asserted as values
    // rather than as wording, because the wording is the catalogue's business.
    showPane(appScope("machine"));
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("…/.envoymesh/EnvoyDev")).toBeTruthy();
    expect(screen.getByText("2 windows")).toBeTruthy();
  });

  it("compares the two builds, and says nothing it cannot know", () => {
    // About's whole content is the comparison; with a daemon that answered, the row is a sentence.
    showPane(appScope("about"));
    expect(screen.getAllByText("0.1.0")).toHaveLength(2);
    expect(screen.getByText(en["settings.about.match"])).toBeTruthy();
    // A window with no daemon at all has no second version, and says so rather than comparing to a guess.
    cleanup();
    showPane(appScope("about"), "wide", { hello: undefined });
    expect(screen.getByText(en["settings.about.unknown"])).toBeTruthy();
  });

  it("says the daemon did not answer, instead of crashing, when the answer is from an older build", () => {
    // **The crash this test exists for, and how it was found.** `models` and `thinking` are required by
    // `HarnessSummary`, so every daemon that follows this protocol sends them — but the daemon that was
    // already running on this machine while the page was being written is a build behind and does not. The
    // page threw on the missing field, React unmounted the window (there is no boundary above the shell
    // here) and the user got an empty pane. Found by driving the real window against that daemon, not by a
    // test, which is the reason this test now exists.
    const older = harnesses.map((harness) => {
      const { models, thinking, ...rest } = harness;
      void models;
      void thinking;
      return rest as unknown as (typeof harnesses)[number];
    });
    showPane(appScope("agents"), "wide", { harnesses: older });
    // The window is still a window: the pane, its title, the bar, and — for each agent — the four words the row
    // can still say.
    expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: en["settings.nav.aria"] })).toBeTruthy();
    // **The whole sentence is one press in, and the row's own line carries the action.** That split is this
    // slice's change: the sentence was four lines of prose per row on the page, and the fact a user acts on is
    // "restart EnvoyDev". Both are asserted, because asserting only the disclosed half would pass on a page
    // that told a user nothing until they opened a disclosure they had no reason to open.
    expect(screen.getAllByText(en["settings.agents.row.restart"])).toHaveLength(older.length);
    for (const name of screen.getAllByRole("button", { name: /^Details for / })) {
      fireEvent.click(name);
    }
    expect(
      screen.getAllByText(/did not send what .* publishes about itself/),
    ).toHaveLength(older.length);
    // And it still explains what it does know: the agent's name, its availability, and the warning that
    // its agent cannot be asked for permission — the facts that *were* in the older answer.
    expect(screen.getByText("Envoy Harness")).toBeTruthy();
    expect(screen.getAllByText(en["settings.agent.verdict.ready"]).length).toBeGreaterThan(0);
  });

  /**
   * **Five measured states, two verdicts — and the words that must never be wrong.**
   *
   * This is the row the user was reading when they wrote *"why all of them shown 'Not Installed'"*. The chip
   * used to be one of two words for every false, so a machine with Claude Code, Codex and DeepSeek Harness
   * installed reported all three as absent — once because the *bridge* was missing and once because a
   * GUI-launched daemon's `PATH` did not contain the directory they were installed in.
   *
   * The five states are still what the daemon measures, and they are now the *evidence* for a verdict plus the
   * **line** that names the specific problem. So this test asserts by association rather than by counting: it
   * is not enough that the words appear, it matters which row they landed on.
   */
  it("names the missing thing in each of the five states, and never says 'not installed' when it does not know", () => {
    // Distinct ids as well as labels: React keys off the id, and five rows sharing one would let the renderer
    // drop or duplicate a row — which would make every assertion below unreliable in a way that looks green.
    const installed = (id: string, label: string, over: Record<string, unknown>) =>
      ({
        id,
        label,
        tier: "catalogued" as const,
        summary: "…",
        modes: [],
        models: { kind: "none" as const, options: [], source: "…" },
        thinking: { kind: "none" as const, options: [], source: "…" },
        capabilities: {
          resume: true,
          cancel: true,
          approvals: true,
          structuredTools: true,
          streaming: true,
          images: true,
          agentMode: true,
          model: true,
          thinking: true,
          approvalPolicy: true,
        },
        auth: { state: "unknown" as const },
        evidence: "…",
        ...over,
      }) as unknown as (typeof harnesses)[number];

    showPane(appScope("agents"), "wide", {
      harnesses: [
        installed("envoy-harness", "Ready Agent", {
          availability: { state: "ready", binary: "/Users/you/.local/bin/ready" },
        }),
        installed("deepseek-harness", "Ready Agent 2", {
          availability: { state: "ready", binary: "/Users/you/.local/bin/dsh" },
        }),
        installed("claudecode", "Bridged Agent", {
          availability: {
            state: "needs-bridge",
            agentBinary: "/Users/you/.local/bin/claude",
            fix: [{ command: "npm install -g @agentclientprotocol/claude-agent-acp" }],
          },
        }),
        installed("codex", "Absent Agent", {
          availability: { state: "not-installed", fix: [{ command: "npm install -g @openai/codex" }] },
        }),
        installed("cursor", "Unchecked Agent", { availability: { state: "unknown" } }),
        installed("copilot", "Undrivable Agent", {
          availability: { state: "unsupported", binary: "/usr/local/bin/copilot" },
        }),
      ],
    });

    const rowOf = (label: string): HTMLElement => {
      const row = screen.getByText(label).closest("li");
      if (!(row instanceof HTMLElement)) throw new Error(`no row for ${label}`);
      return row;
    };
    const chipOf = (label: string): string =>
      rowOf(label).querySelector(".settings__agent-state")?.textContent ?? "";
    const lineOf = (label: string): string =>
      rowOf(label).querySelector(".settings__agent-line")?.textContent ?? "";
    /** Open a row's disclosure — the third place an explanation is allowed to live. */
    const details = (label: string): HTMLElement => {
      const button = [...rowOf(label).querySelectorAll("button")].find(
        (candidate) => candidate.textContent === en["settings.agents.row.details"],
      );
      if (button === undefined) throw new Error(`no Details button on ${label}`);
      fireEvent.click(button);
      return rowOf(label);
    };

    // **Two verdicts and no third word.** Counting them is the cheap half; the association below is the real
    // one. `settings.agent.ready` is gone from the catalogue entirely — the word a user reads is the verdict.
    expect(screen.getAllByText(en["settings.agent.verdict.ready"])).toHaveLength(2);
    expect(screen.getAllByText(en["settings.agent.verdict.notReady"])).toHaveLength(4);
    for (const gone of ["settings.agent.ready", "settings.agent.needsBridge", "settings.agent.notInstalled",
                        "settings.agent.unknown", "settings.agent.unsupported"] as const) {
      expect(Object.keys(en), gone).not.toContain(gone);
    }

    /**
     * **The rule the whole vocabulary exists for**, asserted by *association*: what matters is which words
     * ended up on which row. The bridged agent — the shape of the bug report, an installed agent with no
     * adapter — must lead with **what is present** and must not say the agent is missing; the row that does
     * say so is the one whose search actually came up empty.
     */
    expect(chipOf("Bridged Agent")).toBe(en["settings.agent.verdict.notReady"]);
    // **The lead survives even when the command will not fit on the line** — `claude-agent-acp`'s install
    // command is 51 characters and the lead is 31, so 83 against a budget of 80. The half that must never be
    // dropped is `Installed`, so the fallback keeps the phrase and moves the command one press in.
    expect(lineOf("Bridged Agent")).toBe(en["settings.agent.verdict.connector.lead"]);
    expect(lineOf("Bridged Agent")).not.toMatch(/not installed/i);
    expect(details("Bridged Agent").textContent).toContain(
      "npm install -g @agentclientprotocol/claude-agent-acp",
    );

    expect(chipOf("Absent Agent")).toBe(en["settings.agent.verdict.notReady"]);
    expect(lineOf("Absent Agent")).toBe("npm install -g @openai/codex");
    expect(details("Absent Agent").textContent).toContain(
      `Absent Agent is not installed on this machine`,
    );

    // **The sentence a user must never read as "it is not there".** We could not look, so the row says that —
    // and it offers no install command, because telling somebody to install something we never established was
    // missing is the old `available: false` bug wearing a new field.
    expect(chipOf("Unchecked Agent")).toBe(en["settings.agent.verdict.notReady"]);
    expect(lineOf("Unchecked Agent")).toBe(en["settings.agent.verdict.unlooked.line"]);
    const unchecked = details("Unchecked Agent");
    expect(unchecked.querySelectorAll(".settings__agent-steps")).toHaveLength(0);
    expect(unchecked.textContent).not.toMatch(/npm install/);

    // And the agent this build has no adapter for: our gap, said as ours, with nothing to install.
    expect(chipOf("Undrivable Agent")).toBe(en["settings.agent.verdict.notReady"]);
    expect(lineOf("Undrivable Agent")).toBe(en["settings.agent.verdict.gap.line"]);
    const undrivable = details("Undrivable Agent");
    expect(undrivable.querySelectorAll(".settings__agent-steps")).toHaveLength(0);
    expect(undrivable.textContent).not.toMatch(/npm install/);

    // The two rows that are simply working say so, and neither carries an install command anywhere.
    expect(chipOf("Ready Agent")).toBe(en["settings.agent.verdict.ready"]);
    expect(chipOf("Ready Agent 2")).toBe(en["settings.agent.verdict.ready"]);
    for (const label of ["Ready Agent", "Ready Agent 2"]) {
      expect(details(label).textContent).not.toMatch(/npm install/);
    }
  });

  it("says a program found in npx's cache is a temporary copy, and still shows it as ready", () => {
    // The `dsh` case: it resolves out of `~/.npm/_npx/<hash>/node_modules/.bin` — somebody else's cache — and it
    // really runs, so it is ready; but `npm cache clean` removes it, so the row says where it came from rather
    // than implying the user installed it properly.
    //
    // **The provenance is a property now.** It used to be a warn chip beside the state chip, which is how nine
    // rows came to carry eighteen chips; the mandate's vocabulary is that a caveat is a fact about the row and
    // not a second verdict on it.
    const npx = harnesses[1] as unknown as Record<string, unknown>;
    showPane(appScope("agents"), "wide", {
      harnesses: [
        {
          ...npx,
          label: "DeepSeek Harness",
          availability: {
            state: "ready",
            binary: "/Users/you/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh",
            provisional: "npx",
          },
        } as unknown as (typeof harnesses)[number],
      ],
    });
    expect(screen.getByText(en["settings.agent.verdict.ready"])).toBeTruthy();
    // One chip, and it is the verdict.
    expect(document.querySelectorAll(".settings__agent .chip")).toHaveLength(1);
    // The caveat is not on the row's face: the word *Temporary copy* — which was a chip — is gone from the
    // catalogue altogether, and the only thing that says it now is the cache's own sentence, inside.
    expect(Object.keys(en)).not.toContain("settings.agent.provisional");
    expect(screen.queryByText(/temporary copy/i)).toBeNull();
    // …it is one press in, with the cache named, and no install command anywhere: nothing is missing.
    fireEvent.click(screen.getByRole("button", { name: en["settings.agents.row.details.aria"].replace("{agent}", "DeepSeek Harness") }));
    expect(screen.getByText(en["settings.agent.provisional.npx"])).toBeTruthy();
    expect(screen.queryAllByText(/^npm install/)).toHaveLength(0);
  });

  it("keeps the Projects item's band a count, and the page below it a list", () => {
    // The one section whose second band is data rather than a sentence: asserted from the item, and then
    // from the page it opens — one project in this fixture, and its own path on its row.
    showPane(appScope("general"));
    const projectsItem = within(nav()).getByRole("button", { name: "Projects" });
    expect(within(projectsItem).getByText("1 project")).toBeTruthy();
    expect(projectsItem.getAttribute("title")).toBe("1 project");

    cleanup();
    showPane(PROJECTS_SCOPE);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Project settings for api" })).toBeTruthy();
    expect(screen.getByText("/work/api")).toBeTruthy();
  });
});
