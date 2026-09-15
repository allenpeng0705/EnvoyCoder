/**
 * **How much the settings pages may say — measured on the rendered DOM, and enforced.**
 *
 * ## Why a test and not a review
 *
 * The owner's brief was *"each page has too many texts and the section is not so clear, feel crowded and don't
 * want to read so many texts"*, and the page it was about measured, before this slice, **15,139 visible
 * characters over 12.97 screens** with a single row of **575**. Numbers like that do not come back in one
 * commit; they come back one clarifying sentence at a time, and every one of those sentences is defensible on
 * its own. `settings/density.ts` is the budget and this file is what makes it a rule: every settings page is
 * rendered, and the three numbers are asserted against the **text a user would read**, taken from the DOM
 * rather than from the catalogue.
 *
 * ## The four properties, and the mutation each one fails on
 *
 * | case | the mutation it fails on |
 * |---|---|
 * | every `.setting__detail` is within `SETTING_DETAIL_BUDGET` | pasting an explanation back into a row — the language row, the extra-args row and the transport field all shipped over 190 characters |
 * | every agent row's one line is within `AGENT_ROW_LINE_BUDGET` | rendering `AvailabilityFix.command` or a description verbatim, which is how a 127-character sentence gets onto a row |
 * | a **closed** agent row is within `AGENT_ROW_BUDGET` | stacking the agent's published facts, its summary and its install hints back onto the row |
 * | the Agents page opens with its counts and entry points on screen and its rows collapsed | replacing the disclosure with a *Hide* — the feature this repository deleted (`docs/settings-parity.md` §5.8) |
 *
 * ## What it deliberately does not check
 *
 * Whether a short sentence is a *good* one. No count can, and a test that pretended to would be the kind of
 * green light this repository has already been burned by. What it checks is the thing that is checkable: that
 * a page cannot grow a paragraph in the position a reader is moving fastest through.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogEntry, HarnessSummary } from "@envoycoder/protocol";

import { SettingsPane } from "../src/components/SettingsPane.js";
import { fixOrPhrase } from "../src/components/settings/AgentRow.js";
import {
  AGENT_ROW_BUDGET,
  AGENT_ROW_LINE_BUDGET,
  SETTING_DETAIL_BUDGET,
  SETTING_NOTE_BUDGET,
} from "../src/components/settings/density.js";
import { en } from "../src/i18n/messages/en.js";
import { I18nProvider } from "../src/i18n/context.js";
import { wiredBindings } from "../src/input/shortcuts.js";
import { appScope, type SettingsScope } from "../src/state/settings-scope.js";
import type { CoderState } from "../src/state/coderStore.js";
import { SETTINGS_SECTIONS } from "../src/state/settings-sections.js";

afterEach(cleanup);

/* ────────────────────────────── the fixtures ────────────────────────────── */

/** One agent, with a long name and long published facts — the worst case a row could face. */
function harness(over: Partial<HarnessSummary> & { id: HarnessSummary["id"] }): HarnessSummary {
  return {
    label: over.id,
    tier: "catalogued",
    // Long on purpose, and at the length real ones are: `AgentProviderSummary.detail` and the catalogue's own
    // entries run to this. A row that printed it would break the **line** budget, which is the rule the summary
    // has to be behind a disclosure to keep.
    summary:
      "A long sentence about this agent, of the length the real ones are — it says what the agent is, and a row is not allowed to print it.",
    modes: [{ id: "default", label: "Default" }],
    models: { kind: "listed", options: [{ id: "a/b", label: "b", provider: "a", model: "b" }], source: "…" },
    thinking: { kind: "listed", options: [{ id: "low", label: "Low" }], source: "…" },
    capabilities: {
      resume: true,
      cancel: false,
      approvals: false,
      structuredTools: true,
      streaming: true,
      images: false,
      agentMode: true,
      model: true,
      thinking: true,
      approvalPolicy: true,
    },
    availability: { state: "needs-bridge", agentBinary: "/usr/bin/x", fix: [{ command: "npm install -g x-adapter" }] },
    auth: { state: "needs-signin", methodId: "login" },
    evidence: "…",
    ...over,
  } as HarnessSummary;
}

/**
 * A catalogue entry with the longest strings the real catalogue has.
 *
 * Built from the measured worst cases rather than invented: 38 entries, descriptions up to 200 characters
 * (`Agoragentic`'s is 116), and the two prose `install` hints that are 127 and 136 characters long.
 */
function entry(over: Partial<CatalogEntry> & { id: string; title: string }): CatalogEntry {
  return {
    description: "Agent marketplace with 174+ AI capabilities. Browse, invoke, and pay for agent services settled in USDC on Base L2.",
    version: "0.179.0",
    installLink: "https://example.test/where-to-get-it",
    command: "npx",
    args: ["-y", "an-agent@0.179.0", "exec", "--output-format", "acp-daemon"],
    env: [],
    transport: "acp",
    install: { kind: "npx", package: "an-agent@0.179.0" },
    builtIn: false,
    ...over,
  };
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
    harness({ id: "envoy-harness", label: "Envoy Harness", tier: "built-in", availability: { state: "ready", binary: "/usr/local/bin/envoy-harness" } }),
    harness({ id: "claudecode", label: "Claude Code" }),
    harness({ id: "codex", label: "Codex", auth: { state: "unknown" }, capabilities: { resume: true, cancel: true, approvals: true, structuredTools: true, streaming: true, images: false, agentMode: true, model: true, thinking: true, approvalPolicy: true }, availability: { state: "not-installed", fix: [{ command: "npm install -g @openai/codex" }] } }),
  ],
  providers: [
    {
      id: "mine",
      label: "An Agent The User Declared",
      command: "my-agent",
      args: ["serve", "--acp"],
      env: [{ name: "MY_AGENT_TOKEN", set: false }, { name: "RECIPE_CONSTANT", set: true, from: "catalogue" }],
      transport: "acp",
      availability: { state: "ready", binary: "/usr/local/bin/my-agent" },
      detail: "Ready to run (/usr/local/bin/my-agent).",
    },
  ],
  catalog: [
    entry({ id: "agoragentic-acp", title: "Agoragentic" }),
    entry({ id: "factory-droid", title: "Factory Droid" }),
    // **The prose fix, from the real catalogue.** Two of its 38 `install` hints are 127 and 136 characters of
    // English in a field named `command`. It is here rather than only in the catalogue test because a row that
    // printed it verbatim would break the *budget*, and this file is where the budget lives.
    entry({ id: "an-npx-recipe", title: "An Npx Recipe" }),
    entry({
      id: "amp-acp",
      title: "Amp",
      command: "amp-acp",
      args: [],
      transport: "acp",
      install: { kind: "binary", binary: "amp-acp" },
    }),
  ],
  mesh: { kind: "no-node", reason: "" },
  runs: {},
  loaded: true,
  error: undefined,
  notes: [],
};

const noActions = {
  addProvider: vi.fn(),
  removeProvider: vi.fn(),
  probeCatalogAgent: vi.fn(),
  signInAgent: vi.fn(),
} as never;

function show(scope: SettingsScope, over: Partial<CoderState> = {}): HTMLElement {
  const { container } = render(
    <I18nProvider preference="en">
      <SettingsPane
        state={{ ...state, ...over }}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        scope={scope}
        layout="wide"
        shortcuts={wiredBindings({ commandCenter: vi.fn(), newTask: vi.fn(), search: vi.fn(), windowNew: vi.fn(), sidebar: vi.fn(), settings: vi.fn(), help: vi.fn(), interrupt: vi.fn() })}
        onNavigate={vi.fn()}
        agents={noActions}
      />
    </I18nProvider>,
  );
  return container;
}

/** A node's own visible text, with runs of whitespace collapsed — what a reader would count. */
const textOf = (node: Element): string => ((node as HTMLElement).innerText ?? node.textContent ?? "").replace(/\s+/g, " ").trim();

/* ────────────────────────────── the budgets ────────────────────────────── */

describe("a row's one sentence: the `.setting__detail` band", () => {
  it("is within the budget on every settings page", () => {
    // **The mutation this fails on:** restoring any of the twelve strings this slice trimmed. They were not
    // wrong, they were long: `settings.language.detail` was 202 characters, `settings.extraArgs.detail` 190,
    // `settings.agents.manual.transport.detail` 203 — each one a paragraph in the position a reader is moving
    // through fastest, on pages whose whole job is to be scanned. The assertion is against the *rendered* text
    // and against the shared constant, so shortening the constant to fit a new paragraph is not a way out.
    const seen: { page: string; detail: string; chars: number }[] = [];
    for (const section of SETTINGS_SECTIONS) {
      const container = show(appScope(section.id));
      for (const node of container.querySelectorAll(".setting__detail")) {
        const text = textOf(node);
        seen.push({ page: section.id, detail: text, chars: text.length });
      }
      cleanup();
    }
    // A page with no details at all would make this vacuous — the failure mode this repository keeps paying
    // for. Five pages carry at least one row, so the check has something to check.
    expect(seen.length).toBeGreaterThanOrEqual(8);
    for (const { page, detail, chars } of seen) {
      expect(chars, `${page}: "${detail}" is ${chars} characters`).toBeLessThanOrEqual(SETTING_DETAIL_BUDGET);
    }
  });

  it("holds on the Projects page and one project's own scope too", () => {
    // The other two levels of the pane, rendered from the same rows — a budget checked on only one level is a
    // budget the second level is free to break.
    const projects = [
      {
        id: "local:/repo",
        path: "/repo",
        label: "api",
        hostId: "local",
        addedAt: "2026-09-14T00:00:00.000Z",
        defaults: { harness: "envoy-harness" as const },
      },
    ];
    const container = show({ kind: "project", id: "local:/repo" }, { projects });
    const details = [...container.querySelectorAll(".setting__detail")].map(textOf);
    expect(details.length).toBeGreaterThanOrEqual(4);
    for (const detail of details) {
      expect(detail.length, `"${detail}" is ${detail.length} characters`).toBeLessThanOrEqual(SETTING_DETAIL_BUDGET);
    }
  });
});

describe("a note under a control: a reason, not a paragraph", () => {
  it("is within the note budget on every settings page", () => {
    // **The shape a paragraph takes when it moves into a row.** A note is allowed to be longer than a
    // `detail` — it is a *reason*, and this pane's oldest law is that a control which cannot be honoured says
    // why on screen — and that allowance is exactly why it needs a number: *"the control cannot be honoured"*
    // slides into *"here is some background"* one clause at a time. The note this slice deleted was 140
    // characters of teaching on the *New tasks* row; the longest honest one left is the approval row's
    // explanation of an agent that cannot be handed a policy.
    // **Two classes, and the selector is where the rule is.** This pane has `.setting__note` (a `SettingRow`'s
    // own note prop) and `.settings__note` (the page's voice, used for preambles and empty states), and the rule
    // is about neither class as such: it is about a note **inside a row**. A page-level note is the page talking
    // — the daemon-is-a-build-behind sentence is 197 characters and has to be, because it names the cause and
    // the one action — while a note inside a row is a paragraph where a reader is moving fastest. Scoping the
    // selector to `.setting` is what makes the budget mean the second thing and not the first.
    //
    // Found by mutation: the check was `.setting__note` alone, and the 140-character note this slice deleted
    // from the *New tasks* row is a `.settings__note` — so the mutation that put it back left this test green.
    const inRow = ".setting .settings__note, .setting__note";
    const over: { page: string; note: string; chars: number }[] = [];
    let seen = 0;
    for (const section of SETTINGS_SECTIONS) {
      const container = show(appScope(section.id));
      for (const node of container.querySelectorAll(inRow)) {
        const text = textOf(node);
        seen += 1;
        if (text.length > SETTING_NOTE_BUDGET) over.push({ page: section.id, note: text, chars: text.length });
      }
      cleanup();
    }
    expect(over, `notes over ${SETTING_NOTE_BUDGET} characters`).toEqual([]);
    // The check has to have seen something: a page set with no notes at all would make this vacuous, which is
    // the failure mode this repository keeps paying for.
    expect(seen).toBeGreaterThan(0);
  });
});

describe("an agent row: one line, and not much else", () => {
  /**
   * The AgentRow anatomy, as a measurement.
   *
   * A row's own text is its `textContent` **minus its disclosure**, and the subtraction is the point: the
   * disclosed half is where explanations are supposed to live, and counting it here would make this test fail
   * on the one change it exists to encourage.
   */
  function ownText(row: Element): string {
    let text = textOf(row);
    for (const hidden of row.querySelectorAll(".settings__agent-details")) {
      text = text.replace(textOf(hidden), "");
    }
    return text.replace(/\s+/g, " ").trim();
  }

  it("keeps every closed row's one line within the budget, in every list", () => {
    // **The mutation this fails on:** putting a third-party sentence on a row. The two shapes that would do it
    // are both real: `AvailabilityFix.command` for a catalogued entry is sometimes 127 characters of prose, and
    // `CatalogEntry.description` runs to 200. Both are fixtures here, and both are one press away instead.
    const container = show(appScope("agents"));
    fireEvent.click(screen.getByRole("button", { name: en["settings.agents.catalog.browse"] }));

    const lines = [...container.querySelectorAll(".settings__agent-line")];
    // Nine-ish rows across three lists: shipped agents, the declared provider and the catalogue.
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      const text = textOf(line);
      expect(text.length, `a row line is ${text.length} characters: "${text}"`).toBeLessThanOrEqual(AGENT_ROW_LINE_BUDGET);
      // And it is *there*: an empty line would satisfy the budget and say nothing, which is the shape of a
      // budget test that has stopped testing anything.
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("keeps a fix that is a sentence off the row, which is the branch the budget alone cannot prove", () => {
    // **The case the length budget cannot fail on by itself.** A row that printed a 127-character fix verbatim
    // would break the budget — but a row that printed a *short* sentence as its line would not, and this is the
    // fixture that pins which of the two things happens: the sentence names what to do in three words, and the
    // whole text is in the `title` and the disclosure. Removing the branch in `fixOrPhrase` puts the sentence
    // on the line and takes both assertions below red.
    const prose =
      "install Node.js so that \`npx\` is on PATH — this agent itself needs no install, it is fetched from npm on the first run";
    const container = show(appScope("agents"), {
      catalog: [entry({ id: "an-npx-recipe", title: "An Npx Recipe" })],
    });
    fireEvent.click(screen.getByRole("button", { name: en["settings.agents.catalog.browse"] }));
    const row = [...container.querySelectorAll(".settings__catalog-row")][0];
    if (row === undefined) throw new Error("no catalogue row was rendered");
    // Unmeasured, so the line is the "nothing to install" phrase and the prose is not reachable from the page
    // at all — which is the first half of the property.
    expect(row.querySelector(".settings__agent-line")?.textContent).toBe(
      en["settings.agents.row.nothingToInstall"],
    );
    expect(row.textContent).not.toContain("install Node.js");
    // And the shape the branch is *for*, asserted through the helper rather than through a render: a fix whose
    // text fits is the line, a fix that is a sentence is not.
    expect(fixOrPhrase([{ command: "npm install -g a-thing" }], "phrase", AGENT_ROW_LINE_BUDGET)).toEqual({
      line: "npm install -g a-thing",
      isCommand: true,
    });
    expect(fixOrPhrase([{ command: prose }], "phrase", AGENT_ROW_LINE_BUDGET)).toEqual({
      line: "phrase",
      title: prose,
      isCommand: false,
    });
  });

  it("keeps every closed row's own text within the budget, with nothing on it but a name, a state and a line", () => {
    const container = show(appScope("agents"));
    for (const row of container.querySelectorAll(".settings__agent")) {
      const text = ownText(row);
      expect(text.length, `a closed row is ${text.length} characters: "${text}"`).toBeLessThanOrEqual(AGENT_ROW_BUDGET);
    }
  });

  it("keeps no teaching paragraph inside a row — a note belongs to the page, not to the row", () => {
    // **The rule, as a shape rather than a length.** `.settings__note` is the page's own voice; a note inside a
    // row is the wall of text coming back one paragraph at a time, and it would slip under any per-row budget
    // by being just under it. The two exceptions are stated: an **empty state**, which the law says teaches, and
    // the daemon's own refusal rendered on the row that earned it, which is an answer rather than an
    // explanation.
    const container = show(appScope("agents"));
    fireEvent.click(screen.getByRole("button", { name: en["settings.agents.catalog.browse"] }));
    for (const row of container.querySelectorAll(".settings__agent")) {
      const notes = [...row.querySelectorAll(".settings__note")];
      expect(notes.map(textOf), "a note is inside a row").toEqual([]);
    }
  });
});

/* ────────────────────────────── the shape of the page ────────────────────────────── */

describe("the Agents page opens as three counted groups, not one wall", () => {
  it("carries a count on every group heading, so the page can be sized at a glance", () => {
    // **The mutation this fails on:** dropping the count. `On this machine`, `Your agents` and `Catalogue` are
    // three names; with their sizes on them they are three facts, and the third is the one that decides whether
    // a user looks further. Asserted as `heading + count` rather than as two separate nodes, because that is
    // what a reader sees.
    const container = show(appScope("agents"));
    const headings = [...container.querySelectorAll(".settings__heading")].map(textOf);
    expect(headings).toContain(`${en["settings.agents.shipped.heading"]} · ${state.harnesses.length}`);
    expect(headings).toContain(`${en["settings.agents.mine.heading"]} · ${state.providers.length}`);
    expect(headings).toContain(`${en["settings.agents.catalog.heading"]} · ${state.catalog.length}`);
  });

  it("opens with the catalogue collapsed, its count and its entry point still on screen", () => {
    // **The two halves of one rule, and they pull in opposite directions.** The catalogue had to stop
    // dominating the page (38 expanded rows were 71% of it), and nothing may become *invisible* — this
    // repository deleted a hiding feature for exactly that reason. So: no rows, and the count and the way in
    // are both there. The mutation this fails on is either half alone — an unopened page that also dropped the
    // button would be a whole group removed from the product.
    const container = show(appScope("agents"));
    expect(container.querySelectorAll(".settings__catalog-row")).toHaveLength(0);
    expect(container.querySelector(".settings__catalog")).toBeNull();
    expect(
      screen.getByRole("heading", { name: `${en["settings.agents.catalog.heading"]} · ${state.catalog.length}` }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: en["settings.agents.catalog.browse"] })).toBeTruthy();
    expect(screen.getByRole("button", { name: en["settings.agents.manual.open"] })).toBeTruthy();
  });

  it("lists every agent it holds once the catalogue is opened — the disclosure narrows the page, never the product", () => {
    // The arithmetic the owner's brief is about: what the daemon served is what a user can reach. A collapsed
    // group that lost a row would be the deleted preference with a nicer name.
    const container = show(appScope("agents"));
    fireEvent.click(screen.getByRole("button", { name: en["settings.agents.catalog.browse"] }));
    expect(container.querySelectorAll(".settings__catalog-row")).toHaveLength(state.catalog.length);
    for (const held of state.catalog) {
      expect(within(container as HTMLElement).getByText(held.title)).toBeTruthy();
    }
    // And the two lists of agents are untouched by the press: a disclosure that changed what the *shipped*
    // list holds would be a filter wearing a disclosure's clothes.
    expect(within(container as HTMLElement).getByText("Envoy Harness")).toBeTruthy();
    expect(within(container as HTMLElement).getByText("An Agent The User Declared")).toBeTruthy();
  });

  it("reveals a row's own published facts one press in, so they are disclosed rather than dropped", () => {
    const container = show(appScope("agents"));
    const row = [...container.querySelectorAll(".settings__agent")].find((candidate) =>
      textOf(candidate).includes("Envoy Harness"),
    );
    if (!(row instanceof HTMLElement)) throw new Error("no shipped row for Envoy Harness");
    expect(row.querySelector(".settings__agent-details")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: /^Details for / }));
    expect(row.querySelector(".settings__agent-details")).not.toBeNull();
    // The four facts, by their labels — the disclosed half is the *report*, not a second summary.
    for (const key of [
      "settings.agent.tier.title",
      "settings.agent.modes.title",
      "settings.agent.models.title",
      "settings.agent.thinking.title",
    ] as const) {
      expect(within(row).getByText(en[key])).toBeTruthy();
    }
  });
});
