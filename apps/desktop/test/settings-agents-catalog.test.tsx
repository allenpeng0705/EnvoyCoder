/**
 * The agents screen: **what it lists, what it claims, and what a press sends.**
 *
 * ## The one property this file exists for
 *
 * Every other screen in this product reports something the daemon measured. This one lists thirty-eight
 * *recipes* — command lines and links for programs nobody has looked for yet — and a recipe that renders as
 * supported is a claim we did not measure. That is the defect the last three slices were about, so the tests
 * below are mostly about the two directions it can fail in:
 *
 *   * a row that reads `ready` **without** a probe (the positive lie), and
 *   * a row that reads "not installed" because it is in a list (the negative one).
 *
 * Alongside them: that adding a row sends the entry's own command, argv, environment **names** and dialect —
 * asserted field by field, because "addProvider was called" would pass on a call that invented a `modeParam`;
 * that a missing program shows its link *and* the exact command; that an `npx` recipe says it needs no
 * install; and that an older daemon produces a sentence rather than an exception.
 *
 * ## What each case is checked against
 *
 * Every `it` below was run against a deliberate break, and the break is named in the case. The recording
 * fake (`agentActions`) is what makes that possible: it answers what the test says and remembers exactly
 * what it was handed.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CatalogEntry,
  HarnessAvailability,
  HarnessSummary,
} from "@envoycoder/protocol";
import { ALL_HARNESSES, harnessDefinition } from "@envoycoder/agent-catalog";

import { SettingsPane } from "../src/components/SettingsPane.js";
import { addInputFor } from "../src/components/settings/agent-catalog.js";
import { catalogEntries } from "../src/daemon/catalog.js";

/** The two verdicts, as a user reads them — never spelled out in a test, so a wording change is one edit. */
const READY = en["settings.agent.verdict.ready"];
const NOT_READY = en["settings.agent.verdict.notReady"];
import { en } from "../src/i18n/messages/en.js";
import { I18nProvider } from "../src/i18n/context.js";
import type { Refusal } from "../src/i18n/notice.js";
import { appScope, SECTIONS_SCOPE } from "../src/state/settings-scope.js";
import type { CoderState } from "../src/state/coderStore.js";

afterEach(cleanup);

/* ────────────────────────────── the fixtures ────────────────────────────── */

const settings: CoderState["settings"] = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "en",
};

/** Everything a `HarnessSummary` carries, with the two fields an older daemon omits left optional. */
function harness(over: Partial<HarnessSummary> & { id: HarnessSummary["id"] }): HarnessSummary {
  return {
    label: over.id,
    tier: "catalogued",
    summary: "…",
    modes: [],
    models: { kind: "none", options: [], source: "…" },
    thinking: { kind: "none", options: [], source: "…" },
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
    availability: { state: "ready", binary: `/usr/local/bin/${over.id}` },
    auth: { state: "unknown" },
    evidence: "…",
    ...over,
  } as HarnessSummary;
}

/**
 * The catalogue, as the daemon would serve it.
 *
 * Five entries, chosen for what each one proves rather than for realism: a binary agent, an `npx` recipe, one
 * whose recipe sets a variable, the id that is also a shipped agent, and one that states the *other* dialect
 * (so "the transport is the row's" is a claim a test can break).
 */
const catalog: CatalogEntry[] = [
  {
    id: "goose",
    title: "goose",
    description: "A local, extensible, open source AI agent.",
    version: "1.33.1",
    installLink: "https://block.github.io/goose/",
    command: "goose",
    args: ["acp"],
    env: [],
    transport: "acp",
    install: { kind: "binary", binary: "goose" },
    builtIn: false,
    // The daemon resolved this row's cheap facts when it served the list — no press, no probe call.
    availability: {
      state: "not-installed",
      fix: [{ command: "brew install goose", url: "https://block.github.io/goose/" }],
    },
  },
  {
    id: "cline",
    title: "Cline",
    description: "Autonomous coding agent CLI.",
    version: "3.0.46",
    installLink: "https://cline.bot/cli",
    command: "npx",
    args: ["-y", "cline@3.0.46", "--acp"],
    env: [],
    transport: "acp",
    install: { kind: "npx", package: "cline@3.0.46" },
    builtIn: false,
    // `npx` resolved, so the row is **Ready**: the package is fetched on the first run, which is not a problem.
    availability: { state: "ready", binary: "/usr/bin/npx" },
  },
  {
    id: "vtcode",
    title: "VT Code",
    description: "An open-source coding agent.",
    version: "0.96.14",
    installLink: "https://example.test/vtcode",
    command: "vtcode",
    args: ["acp"],
    env: [
      { name: "VT_ACP_ENABLED", value: "1" },
      { name: "VT_ACP_ZED_ENABLED", value: "1" },
    ],
    transport: "acp",
    install: { kind: "binary", binary: "vtcode" },
    builtIn: false,
    availability: { state: "ready", binary: "/usr/local/bin/vtcode" },
  },
  {
    id: "cursor",
    title: "Cursor",
    description: "Cursor's coding agent.",
    version: "2026.03.30",
    installLink: "https://docs.cursor.com/en/cli/overview",
    command: "cursor-agent",
    args: ["acp"],
    env: [],
    transport: "acp",
    install: { kind: "binary", binary: "cursor-agent" },
    builtIn: true,
    availability: { state: "ready", binary: "/usr/local/bin/cursor-agent" },
  },
  {
    id: "legacy-cli",
    title: "Legacy CLI",
    description: "A program that states it speaks a plain command line.",
    version: "manual",
    installLink: "https://example.test/legacy",
    command: "legacy",
    args: ["--once"],
    env: [],
    transport: "cli",
    install: { kind: "binary", binary: "legacy" },
    builtIn: false,
    // The entry declares a plain command line, so this build has no adapter for the way it speaks: our gap,
    // and the case `settings-agent-verdict.test.tsx` asserts offers no install step.
    availability: { state: "unsupported", binary: "/usr/local/bin/legacy" },
  },
];

const state: CoderState = {
  connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
  resolved: undefined,
  hello: {
    product: "EnvoyCoder",
    version: "0.1.0",
    instanceId: "test",
    home: "/home/u",
    stateDir: "/home/u/.envoycoder",
    startedAt: "2026-09-14T00:00:00.000Z",
    windowCount: 1,
    // **The methods the page gates on, present.** A daemon that served none of them is the older-daemon case
    // below, and it is the whole reason this list is consulted rather than assumed.
    methods: [
      "coder.hello",
      "coder.listHarnesses",
      "coder.listProviders",
      "coder.listCatalog",
      "coder.signInAgent",
    ],
    mesh: { kind: "no-node", reason: "not attached in this test" },
    notes: [],
  },
  projects: [],
  tasks: [],
  tasksKnown: true,
  settings,
  harnesses: [
    harness({ id: "envoy-harness", label: "Envoy Harness", tier: "built-in" }),
    harness({
      id: "codex",
      label: "Codex",
      availability: {
        state: "not-installed",
        fix: [{ command: "npm install -g @openai/codex", url: "https://www.npmjs.com/package/@openai/codex" }],
      },
      auth: { state: "needs-signin" },
    }),
  ],
  providers: [
    {
      id: "mine",
      label: "My Agent",
      command: "my-agent",
      args: ["serve"],
      env: [{ name: "MY_AGENT_TOKEN", set: false }],
      transport: "acp",
      availability: { state: "ready", binary: "/usr/local/bin/my-agent" },
      detail: "Ready to run (/usr/local/bin/my-agent).",
    },
  ],
  catalog,
  mesh: { kind: "no-node", reason: "" },
  runs: {},
  loaded: true,
  error: undefined,
  notes: [],
};

/** What the recording fake was handed, and what it answers with. */
interface AgentCalls {
  added: {
    id: string;
    label: string;
    command: string;
    args: readonly string[];
    env: readonly string[];
    transport: string;
    /** The catalogue reference, present for a row and absent for the manual form. */
    catalogEntryId?: string;
  }[];
  removed: string[];
  signedIn: string[];
}

/**
 * The five actions, recorded — and answering whatever the test set up.
 *
 * Deliberately not a `vi.fn()` per method with a shared `mockResolvedValue`: the interesting assertions are on
 * *arguments* (the whole config an Add sends), and a recorder makes those readable at the point of the claim.
 */
function agentActions(options: { addRefusal?: Refusal } = {}): {
  actions: Record<string, unknown>;
  calls: AgentCalls;
} {
  const calls: AgentCalls = { added: [], removed: [], signedIn: [] };
  const actions = {
    addProvider: async (input: AgentCalls["added"][number]) => {
      calls.added.push({ ...input, args: [...input.args], env: [...input.env] });
      if (options.addRefusal) return options.addRefusal;
      return { ok: true as const };
    },
    removeProvider: async (id: string) => {
      calls.removed.push(id);
      return { ok: true as const, removed: id };
    },
    signInAgent: async (id: string) => {
      calls.signedIn.push(id);
      return { ok: true as const, outcome: "signed-in" as const, detail: "…" };
    },
  };
  return { actions, calls };
}

/**
 * Render the Agents page, with the actions and state a case needs.
 *
 * **The catalogue is opened by default, and that default is the point.** The list moved behind a *Browse the
 * catalogue* button (`docs/settings-parity.md` §7.14: 38 expanded rows were 71% of the page), so every claim
 * about a row has to be made *after* the press a user would make. A case that wants the closed state — the
 * page as it first appears — passes `{ closed: true }`, and `settings-density.test.tsx` owns the assertions
 * about what is on screen before anything is pressed.
 */
function show(
  over: Partial<CoderState> = {},
  options: Parameters<typeof agentActions>[0] = {},
  view: { closed?: boolean } = {},
): AgentCalls {
  const { actions, calls } = agentActions(options);
  render(
    <I18nProvider preference="en">
      <SettingsPane
        state={{ ...state, ...over }}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        scope={appScope("agents")}
        layout="wide"
        shortcuts={[]}
        onNavigate={vi.fn()}
        agents={actions as never}
      />
    </I18nProvider>,
  );
  if (view.closed !== true) {
    // By the words a user reads, at the top level of the page rather than inside a row.
    fireEvent.click(
      screen.getByRole("button", { name: en["settings.agents.catalog.browse"] }),
    );
  }
  return calls;
}

/**
 * The manual form, opened the way a user opens it.
 *
 * The form is behind its own button now, and the opening is a named helper rather than an inline press for the
 * same reason `details()` is: it makes "the form is not on the page" an assertion a case can make *before*
 * calling this, which is the half of the change that could otherwise go unchecked.
 */
function manualForm(): HTMLElement {
  press(document.body, en["settings.agents.manual.open"]);
  const form = document.querySelector(".settings__manual");
  if (!(form instanceof HTMLElement)) throw new Error("the manual form was not rendered");
  return form;
}

/**
 * Open one row's disclosure — the third place an explanation is allowed to live.
 *
 * Every claim about what a *recipe* says (its command, its version, its link, why an `npx` row needs no
 * install) is a claim about disclosed text now, and this is the press that reveals it. Keeping it a named
 * helper rather than an inline `fireEvent.click` is what makes "the row does not show this" and "the row
 * shows this only after a press" two different assertions instead of one ambiguous one.
 */
function details(scope: HTMLElement): void {
  // **By the visible label, not by the accessible name.** The button carries `aria-label="Details for Cursor"`
  // so that eight of them are distinguishable to a screen reader; a lookup by accessible name would have to
  // reconstruct that string, while the *visible* label is what every one of them shows and what a pointer
  // presses. `getByRole` cannot be used for the visible one, because in the accessibility tree it is not the
  // name — hence the DOM query.
  const button = [...scope.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === en["settings.agents.row.details"],
  );
  if (button === undefined) throw new Error("no Details button in that row");
  fireEvent.click(button);
}

/** The catalogue list, as a region of its own so a claim about it cannot be satisfied by another part. */
const catalogList = (): HTMLElement => {
  const list = document.querySelector(".settings__catalog");
  if (!(list instanceof HTMLElement)) throw new Error("the catalogue list was not rendered");
  return list;
};

/**
 * One catalogue row, by the entry's own title — never by index, which would pass on a reordered list.
 *
 * **Matched on the row's *name*, not on its whole text**, and that is a change this slice forced rather than a
 * tidy-up. The lookup used to search `textContent`, which happened to work because every row rendered its own
 * command line — so `row("Cline")` found the `Cline` row through `npx -y cline@3.0.46 --acp`. With the command
 * line behind the disclosure that stopped working, and the honest reading is that it never should have: a
 * lookup that depends on disclosed text passes or fails for a reason nobody wrote down.
 */
function row(title: string): HTMLElement {
  const rows = [...catalogList().querySelectorAll(".settings__catalog-row")];
  const found = rows.find(
    (candidate) => candidate.querySelector(".settings__agent-name")?.textContent === title,
  );
  if (!(found instanceof HTMLElement)) throw new Error(`no catalogue row for ${title}`);
  return found;
}

/** The shipped-agents list. */
const shippedList = (): HTMLElement => {
  const list = document.querySelector(".settings__agents");
  if (!(list instanceof HTMLElement)) throw new Error("the shipped list was not rendered");
  return list;
};

/** One shipped agent's row, by the label on the wire. */
function rowFor(label: string): HTMLElement {
  const found = within(shippedList()).getByText(label).closest(".settings__agent");
  if (!(found instanceof HTMLElement)) throw new Error(`no shipped row for ${label}`);
  return found;
}

/**
 * The state chip of a row — **by class, not by position**.
 *
 * It used to be "the first chip in the head", which was true when the chip came before the name. The row now
 * leads with the name and puts the state chip *last* in its own column (so the state column's right edge is
 * constant), and a positional lookup would silently start returning a verdict chip — `No approvals` where the
 * test meant `Ready`.
 */
const chipText = (element: HTMLElement): string =>
  element.querySelector(".settings__agent-state")?.textContent ?? "";

/** Press a button by its label, inside one row. */
function press(scope: HTMLElement, label: string): void {
  const button = within(scope).getByRole("button", { name: label });
  fireEvent.click(button);
}

/* ────────────────────────────── what the page lists ────────────────────────────── */

describe("the agents screen", () => {
  it("lists the agents this machine has and the whole catalogue, in one place", () => {
    // **The mutation this fails on:** rendering only `state.harnesses`, which is what the page did before this
    // slice — the catalogue existed in a package and no surface read it, so a user with Goose installed had a
    // product that supported it and no way to find out.
    show();
    expect(within(shippedList()).getByText("Envoy Harness")).toBeTruthy();
    expect(within(shippedList()).getByText("Codex")).toBeTruthy();
    for (const entry of catalog) {
      expect(within(catalogList()).getByText(entry.title), entry.id).toBeTruthy();
    }
    expect(catalogList().querySelectorAll(".settings__catalog-row")).toHaveLength(catalog.length);
  });

  it("lists every agent we ship, every agent declared and all 38 catalogue rows, and nothing shortens it", () => {
    // **The owner's brief, as an assertion.** *"We need user to see them and can enable and use them. That's
    // the target of our control plane."* A control plane that cannot see the agents it controls is the exact
    // complaint this screen exists to answer — and the one thing that was able to act against it was the
    // deleted preference, which could take a **shipped** agent out of a list. So this case renders the real
    // catalogue (`catalogEntries()`, the daemon's own projection, not a second copy of it), all nine shipped
    // agents and two declared providers, and asserts the arithmetic: what the daemon served is what a user
    // can see.
    //
    // **The mutation it fails on:** any filter, cap or "show more" over a list on this page — including a
    // `hidden`-style predicate reintroduced in the render, which would take the shipped count from 9 to 8.
    // The real catalogue, projected by the daemon's own function over a stub prober: what is under test here
    // is the *list* — every entry, in one place, with nothing shortening it — not this machine's programs.
    const entries = catalogEntries(() => ({ state: "ready", binaryPath: "/usr/local/bin/stub", via: "path" }));
    // **The nine, in all five states between them** — because a fixture where every agent is `ready` cannot
    // tell "lists everything" from "lists everything that works", and it was that gap that let this case stay
    // green under a `state === "ready"` filter while the weaker cases next door went red. Every state the
    // pickers may drop is in the list, so only an unfiltered render puts all nine on the page.
    const states: HarnessAvailability[] = [
      { state: "ready", binary: "/usr/local/bin/agent" },
      { state: "unknown" },
      { state: "not-installed", fix: [{ command: "npm install -g the-agent" }] },
      { state: "needs-bridge", agentBinary: "/usr/local/bin/agent", fix: [{ command: "npm install -g the-adapter" }] },
      { state: "unsupported", binary: "/usr/local/bin/agent" },
    ];
    const shipped = ALL_HARNESSES.map((id, at) =>
      harness({ id, label: harnessDefinition(id).label, availability: states[at % states.length]! }),
    );
    expect(entries, "the catalogue this product ships").toHaveLength(38);
    expect(shipped, "the agents this product ships").toHaveLength(9);
    expect(new Set(shipped.map((agent) => agent.availability.state)).size, "states covered").toBe(5);

    show({
      harnesses: shipped,
      providers: [
        { ...state.providers[0]!, id: "my-agent", label: "My Agent" },
        { ...state.providers[0]!, id: "other-agent", label: "Other Agent" },
      ],
      catalog: entries,
    });

    const lists = document.querySelectorAll(".settings__agents");
    const shippedRows = lists[0]?.querySelectorAll(".settings__agent") ?? [];
    const providerRows = lists[1]?.querySelectorAll(".settings__agent") ?? [];
    expect(shippedRows).toHaveLength(9);
    expect(providerRows).toHaveLength(2);
    for (const agent of shipped) {
      expect(within(shippedList()).getByText(agent.label), agent.id).toBeTruthy();
    }
    for (const provider of ["My Agent", "Other Agent"]) {
      expect(document.body.textContent).toContain(provider);
    }

    // Every entry, by the entry's own title: the count is the catalogue's, and no row is missing from it.
    expect(catalogList().querySelectorAll(".settings__catalog-row")).toHaveLength(entries.length);
    for (const entry of entries) {
      expect(within(catalogList()).getByText(entry.title), entry.id).toBeTruthy();
    }
  });

  it("shows each catalogue row's command, version and where to get it — one press in", () => {
    // **The mutation this fails on:** deleting the disclosed half, which would take the recipe's own command
    // line, its version and its install link off the product entirely. The rule this page follows is
    // *explanations move to a title, a disclosure or the docs* — not that they stop existing, and a row whose
    // details were simply dropped is the `hiddenAgents` mistake wearing a disclosure's clothes.
    show();
    const goose = row("goose");
    // Not on the closed row: a command line per row is what made this list thirty-eight cards tall.
    expect(goose.textContent).not.toContain("goose acp");
    details(goose);
    expect(within(goose).getByText("goose acp")).toBeTruthy();
    expect(within(goose).getByText(en["settings.agents.row.version"].replace("{version}", "1.33.1"))).toBeTruthy();
    const link = within(goose).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://block.github.io/goose/");
  });
});

/* ────────────────────── the verdict, which is resolved before the list is served ────────────────────── */

/**
 * **The row's state used to be a thing a user had to ask for.** All 38 rows rendered *"Not checked yet"* and
 * offered a *Check* button; `coder.probeCatalogAgent` measured one entry per press and cached the answer.
 *
 * That is gone, and this block is what replaced it: every row arrives with the daemon's own cheap measurement
 * on it (`CatalogEntry.availability`), rendered as **Ready** or **Not ready**. The tests below are about the
 * two ways that could go quietly wrong — a row reading as anything other than those two words, and a row
 * offering an install step for a gap that is ours.
 *
 * The wording and the layout of each of the five Not-ready cases, at the level of the row's line and the
 * guide its disclosure leads with, is `settings-agent-verdict.test.tsx`'s job; what is asserted here is the
 * *list's* half, which is which entry ends up in which verdict.
 */
describe("what a catalogue row's verdict is", () => {
  it("gives every row one of the two verdicts, resolved before anything was pressed", () => {
    // **The mutation this fails on:** any row rendering `settings.agent.unchecked` — or rendering no chip —
    // which is what a row whose state came from a per-row probe looks like when nobody pressed it. The fixture
    // covers all four shapes a row can be in (installed, fetched on first run, missing, and a plain command
    // line this build cannot drive), so a state falling out of the projection shows up here.
    show();
    for (const entry of catalog) {
      expect([READY, NOT_READY], `${entry.id}: ${chipText(row(entry.title))}`).toContain(
        chipText(row(entry.title)),
      );
    }
    // The one entry that resolves is the one that reads Ready, and the unresolvable ones read Not ready.
    expect(chipText(row("Cline"))).toBe(READY);
    expect(chipText(row("VT Code"))).toBe(READY);
    expect(chipText(row("goose"))).toBe(NOT_READY);
    expect(chipText(row("Legacy CLI"))).toBe(NOT_READY);
  });

  it("has no control on it that exists to find out a state", () => {
    // *"the product must not ask the user to press something to learn a state."* The two buttons a catalogue
    // row may carry are the two things a user can **do** — add it, or forget one they declared — and the old
    // pair (*Check this machine* / *Check again*) is gone from the page and from the catalogue of strings.
    show();
    const labels = [...catalogList().querySelectorAll("button")].map((button) => button.textContent ?? "");
    expect(labels.some((label) => /check/i.test(label))).toBe(false);
    // And the strings themselves do not exist any more, so a translation cannot bring one back.
    for (const key of ["settings.agents.row.check", "settings.agents.row.checkAgain"] as const) {
      expect(Object.keys(en), key).not.toContain(key);
    }
  });

  it("offers no install step for the entry whose gap is ours", () => {
    // **The mandate's distinction, at the list level.** `legacy-cli` resolves and runs, and this build has no
    // adapter for the way it speaks: nothing is missing from the user's machine, so nothing may be offered.
    const container = show() && catalogList();
    void container;
    const legacy = row("Legacy CLI");
    expect(chipText(legacy)).toBe(NOT_READY);
    expect(legacy.textContent).not.toMatch(/npm install/);
    details(legacy);
    const panel = legacy.querySelector(".settings__agent-details");
    expect(panel?.querySelectorAll(".settings__agent-steps")).toHaveLength(0);
    expect(panel?.querySelectorAll("a")).toHaveLength(0);
    expect(panel?.textContent).not.toMatch(/npm install/);
  });

  it("shows the entry's own install step and link for the row that really is missing", () => {
    // The other side of the branch: `goose` did not resolve, so the row says so and the disclosure leads with
    // the command and the vendor's page. A projection that gave every Not-ready row the same shape would pass
    // the test above and fail this one.
    show();
    const goose = row("goose");
    expect(chipText(goose)).toBe(NOT_READY);
    details(goose);
    const steps = [...goose.querySelectorAll(".settings__agent-steps code")].map((code) => code.textContent);
    expect(steps).toEqual(["brew install goose"]);
    expect(goose.querySelector(".settings__agent-guide a")?.getAttribute("href")).toBe(
      "https://block.github.io/goose/",
    );
  });

  it("says an npx recipe is fetched on the first run instead of treating the download as a fault", () => {
    // **The mandate's fifth bullet:** *"an `npx` recipe → it is not a problem: the program is fetched on first
    // run, and say so."* The mutation: the deleted `ready-npx` state, whose chip read *"Not downloaded yet"* on
    // 14 working rows.
    show();
    const cline = row("Cline");
    expect(chipText(cline)).toBe(READY);
    expect(cline.textContent).not.toMatch(/not downloaded/i);
    expect(cline.textContent).not.toMatch(/npm install/);
    details(cline);
    expect(cline.textContent).toContain(
      en["settings.agent.fact.obtained.npx"].replace("{package}", "cline@3.0.46"),
    );
  });

  it("carries the recipe's own constants as facts rather than as something the user owes", () => {
    // `§7.10`'s rule, kept: the entry's constants travel with the reference, so a row says which variables the
    // recipe supplies. A row that asked the user to export them would send them to set something EnvoyCoder is
    // already providing.
    show();
    const vtcode = row("VT Code");
    details(vtcode);
    const panel = vtcode.querySelector(".settings__agent-details");
    expect(panel?.textContent).toContain("VT_ACP_ENABLED");
    expect(panel?.textContent).toContain(en["settings.agent.fact.env.recipe"]);
  });

  it("leaves a row with no measurement at all saying the daemon is a build behind", () => {
    // **The legacy wire.** A daemon that does not send `availability` cannot be read as "not installed", and
    // the row says whose gap it is and what the one action is. The mutation: defaulting an absent field to a
    // state — `not-installed` would blame the user's machine, `ready` would invent a measurement.
    show({ catalog: catalog.map(({ availability: _dropped, ...rest }) => rest as (typeof catalog)[number]) });
    const goose = row("goose");
    expect(chipText(goose)).toBe(NOT_READY);
    expect(goose.textContent).toContain(en["settings.agent.verdict.legacy.line"]);
    details(goose);
    expect(goose.querySelector(".settings__agent-details")?.textContent).toContain(
      en["settings.agent.verdict.app.restart"],
    );
  });
});

describe("adding an agent from the catalogue", () => {
  it("sends the command, the arguments and the environment names the entry describes", async () => {
    // **The mutation this fails on:** any Add that builds its own config. Every field here comes off the row,
    // and the test asserts them one by one because `addProvider` merely *being called* would pass on a call
    // that dropped the argv or split the command line wrongly.
    const calls = show();
    press(row("VT Code"), en["settings.agents.row.add"]);
    await waitFor(() => expect(calls.added).toHaveLength(1));
    expect(calls.added).toEqual([
      {
        // The provider's own id, distinct from the recipe it references — see the note on `addInputFor`: this
        // pair being *equal* is what the store refuses, and it is what broke every Add in the catalogue.
        id: "vtcode-acp",
        label: "VT Code",
        command: "vtcode",
        args: ["acp"],
        // **Names, plus the reference — and never the value.** The entry's own recipe sets
        // `VT_ACP_ENABLED=1`; a provider has no field for the `1`, and this is the wire half of the schema
        // that has none. `catalogEntryId` is what makes the value unnecessary rather than merely forbidden:
        // the daemon resolves the recipe's constants from the catalogue it ships.
        env: ["VT_ACP_ENABLED", "VT_ACP_ZED_ENABLED"],
        transport: "acp",
        catalogEntryId: "vtcode",
      },
    ]);
    expect(JSON.stringify(calls.added)).not.toContain('"1"');
  });

  it("carries the dialect the row states, and never invents one", async () => {
    // **The mutation this fails on:** defaulting the transport to `"acp"` on the way to `addProvider`. The
    // failure is silent in both directions — a peer ignores an unknown `modeId` and reports success, and a
    // one-shot CLI started as ACP gets an `initialize` it never answers — so the assertion is on the exact
    // value the entry stated, from an entry whose stated value is the *unusual* one.
    const calls = show();
    press(row("Legacy CLI"), en["settings.agents.row.add"]);
    await waitFor(() => expect(calls.added).toHaveLength(1));
    expect(calls.added[0]?.transport).toBe("cli");
    // Nothing else about the dialect travels with it: no `modeParam`, no `authMethodId`, because the entry
    // states neither and a plausible guess is worse than an omission.
    expect(Object.keys(calls.added[0] ?? {}).sort()).toEqual([
      "args",
      "catalogEntryId",
      "command",
      "env",
      "id",
      "label",
      "transport",
    ]);
  });

  it("offers Remove instead of Add for an entry the user has already declared", async () => {
    // Adding is a **replace** (`coder.addProvider` is a complete statement of how to start a program), so a
    // button labelled *Add* that silently replaced an existing agent would be the wrong control.
    const calls = show({
      providers: [
        { ...state.providers[0]!, id: "goose", label: "goose" },
      ],
    });
    const goose = row("goose");
    expect(within(goose).queryByRole("button", { name: en["settings.agents.row.add"] })).toBeNull();
    press(goose, en["settings.agents.mine.remove"]);
    await waitFor(() => expect(calls.removed).toEqual(["goose"]));
  });

  it("shows the shipped agent rather than a second Add for the id that is in both lists", () => {
    // The overlap rule (`resolveAgentEntry`: a built-in wins) arrives from the daemon as `builtIn`, so the
    // window does not compute it — and the row says why instead of offering a duplicate.
    show();
    const cursor = row("Cursor");
    expect(within(cursor).queryByRole("button", { name: en["settings.agents.row.add"] })).toBeNull();
    // The label on the row is two words; the sentence it stands for is the `title`, which is where an
    // explanation goes when the row may not carry one (`settings/density.ts`).
    const label = within(cursor).getByText(en["settings.agents.row.builtIn.short"]);
    expect(label.getAttribute("title")).toBe(en["settings.agents.row.builtIn"]);
  });
});

describe("nothing on this page can take an agent out of a list", () => {
  /**
   * **The switch that used to be here, and what replaced it.**
   *
   * This describe was called *"turning an agent on and off"* and its first two cases pressed *Hide from my
   * lists* and read the **Hidden** chip back off the row. The preference, the control and the chip are all
   * gone: a stored filter that shortens the list of agents a product offers is the one control that can make
   * an agent **we ship** disappear from our own lists, which is the failure this product's owner named when
   * they said they could not see the agents we support. What decides a picker's contents is now derived from
   * probed facts (`composer/agent-for.ts`'s `offeredAgents`), and the two cases here are the screen's half of
   * that: **no control on the page mentions the preference**, and the keys that spelled it are gone from the
   * catalogue rather than left behind as orphans.
   */
  it("offers no control, and no chip, that takes an agent out of the user's lists", () => {
    // The vocabulary is the assertion. A *Hide*, a *Show* or a *Hidden* anywhere on this page is the feature
    // coming back, whatever it is wired to — so the check is on the words a user would read, and on the two
    // keys that spelled them being absent from the catalogue rather than merely unreferenced.
    for (const key of [
      "settings.agents.hide",
      "settings.agents.show",
      "settings.agents.hidden",
      "settings.agents.hidden.title",
    ]) {
      expect(en[key as keyof typeof en], `${key} is still in the catalogue`).toBeUndefined();
    }

    show();
    // The whole document, not one region: a *Hide* that moved elsewhere on the page is the same feature
    // back, and a check scoped to the list it used to sit in would not notice.
    for (const stale of ["Hide from my lists", "Show in my lists", "Hidden"]) {
      expect(document.body.textContent, `the page still says "${stale}"`).not.toContain(stale);
    }
    // And a shipped agent's row carries no button that acts on the *list*: the only controls an agent we ship
    // has are its own sign-in (absent here — this fixture has not said it needs one) and the disclosure that
    // unfolds its own facts. The assertion is on the **names**, not on the count, and that is a change this
    // slice made deliberately: `queryAllByRole("button")).toEqual([])` was true when a row carried nothing but
    // a Sign-in, and it would now fail on `Details` — a button that opens the row it belongs to and can no more
    // shorten a list than a tooltip can.
    expect(
      within(rowFor("Envoy Harness"))
        .queryAllByRole("button")
        .map((button) => button.textContent ?? ""),
    ).toEqual([en["settings.agents.row.details"]]);
  });

  it("removes an agent the user declared, in words that are not 'hide'", async () => {
    // **Remove is kept, and it is a different act from the deleted preference.** Removing a *declared*
    // provider undoes the user's own action — they added it, they can un-add it — while the preference could
    // take an agent **we ship** out of a list, which is why only the first survives. The copy is the other half
    // of the guarantee: a control whose wording reads as "hide" would restore the confusion the deletion is
    // about, so the title is asserted to say what Remove does *and* to avoid the vocabulary of hiding.
    const calls = show();
    const providerList = document.querySelectorAll(".settings__agents")[1];
    const providerRow = providerList?.querySelector(".settings__agent");
    if (!(providerRow instanceof HTMLElement)) throw new Error("no provider row was rendered");

    const remove = within(providerRow).getByRole("button", { name: en["settings.agents.mine.remove"] });
    const title = remove.getAttribute("title") ?? "";
    expect(title).toContain("Forget My Agent");
    expect(title.toLowerCase()).not.toContain("hide");
    expect(title).toContain("Nothing is uninstalled");

    press(providerRow, en["settings.agents.mine.remove"]);
    await waitFor(() => expect(calls.removed).toEqual(["mine"]));

    // And no shipped agent carries it: there is nothing of the user's to undo on an agent we ship, so a
    // Remove there would be the deleted preference wearing a different word.
    expect(
      within(rowFor("Envoy Harness")).queryByRole("button", { name: en["settings.agents.mine.remove"] }),
    ).toBeNull();
  });

  it("lists a shipped agent the probe could not run at all, with the command that fixes it", () => {
    // The other direction, and the one a picker may *not* take: `Codex` here is `not-installed`, so
    // `offeredAgents` drops it from the two default-agent pickers — and this page still lists it, still says
    // why, and still names the install command. That difference is the whole bargain: a picker is where a
    // choice is made, and the catalogue is where the product is visible.
    show();
    const codex = rowFor("Codex");
    // The verdict is one of two words, and *why* is on the row's own line — which is the half that must not be
    // softened. The mutation: rendering the agent as absent-from-a-list rather than as a row with a fix.
    expect(chipText(codex)).toBe(en["settings.agent.verdict.notReady"]);
    expect(codex.querySelector(".settings__agent-line")?.textContent).toContain(
      "npm install -g @openai/codex",
    );
  });

  it("offers the agent's own sign-in only when it says it needs one", () => {
    show();
    expect(within(rowFor("Codex")).getByRole("button", { name: en["settings.agents.signIn"] })).toBeTruthy();
    expect(within(rowFor("Envoy Harness")).queryByRole("button", { name: en["settings.agents.signIn"] })).toBeNull();
  });
});

/* ────────────────────────────── an agent nobody catalogued ────────────────────────────── */

describe("declaring an agent that is not in the catalogue", () => {
  it("will not send a dialect until the user states one", async () => {
    // **The mutation this fails on:** preselecting a radio. `coder.addProvider` makes `transport` required
    // because choosing on the user's behalf is the one thing that field exists to prevent — and a form with a
    // default would move that guess from the schema into the UI, where it is invisible.
    const calls = show();
    // **The form is behind its own button now**, and the absence is asserted rather than assumed: a form of
    // five fields is the second-largest thing this page used to render, and it is one press from the
    // count-carrying heading. `manualForm()` performs that press.
    expect(document.querySelector(".settings__manual")).toBeNull();
    const form = manualForm();
    fireEvent.change(within(form).getByLabelText(en["settings.agents.manual.label"]), {
      target: { value: "My Own Agent" },
    });
    fireEvent.change(within(form).getByLabelText(en["settings.agents.manual.command"]), {
      target: { value: "my-agent" },
    });
    const submit = within(form).getByRole("button", { name: en["settings.agents.manual.submit"] });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(form).getByLabelText(en["settings.agents.manual.transport.acp"]));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(calls.added).toHaveLength(1));
    expect(calls.added).toEqual([
      {
        id: "my-own-agent",
        label: "My Own Agent",
        command: "my-agent",
        args: [],
        env: [],
        transport: "acp",
      },
    ]);
  });

  it("splits a quoted argument the way the launch does", async () => {
    // The window has its own `splitArgs` because the package's entry point reaches `node:fs` and cannot be
    // bundled; `agent-catalog.ts` names that duplication and this is where it is held in step with a case that
    // a naive `.split(" ")` gets wrong.
    const calls = show();
    const form = manualForm();
    fireEvent.change(within(form).getByLabelText(en["settings.agents.manual.label"]), {
      target: { value: "Spaced Agent" },
    });
    fireEvent.change(within(form).getByLabelText(en["settings.agents.manual.command"]), {
      target: { value: "spaced" },
    });
    fireEvent.change(within(form).getByLabelText(en["settings.agents.manual.args"]), {
      target: { value: '--dir "/Users/me/My Project" --acp' },
    });
    fireEvent.click(within(form).getByLabelText(en["settings.agents.manual.transport.cli"]));
    fireEvent.click(within(form).getByRole("button", { name: en["settings.agents.manual.submit"] }));
    await waitFor(() => expect(calls.added).toHaveLength(1));
    expect(calls.added[0]?.args).toEqual(["--dir", "/Users/me/My Project", "--acp"]);
  });

  it("never hands back the thing a user pasted into the environment field", async () => {
    // **The credential rule, at the one place a window could break it.** The field takes *names*; what people
    // paste into a field labelled "environment" is very often the credential itself. The daemon refuses an
    // entry that is not a name with a sentence that deliberately does not quote it back, and the window's job
    // is to render that sentence and **not** the string — a refusal that echoes a pasted key puts it on the
    // screen, in the transcript and in the next bug report.
    const secret = "ANTHROPIC_API_KEY=sk-live-abcdef123456";
    const { actions } = agentActions();

    const { actions: recording, calls } = agentActions({
      addRefusal: {
        ok: false,
        message: "EnvoyCoder stores the names of the environment variables an agent needs, never their values.",
        key: "error.providerEnvNotAName",
        values: { position: 1 },
      } as unknown as Refusal,
    });
    expect(actions).toBeDefined();

    render(
      <I18nProvider preference="en">
        <SettingsPane
          state={state}
          onClose={vi.fn()}
          onUpdate={vi.fn()}
          scope={appScope("agents")}
          layout="wide"
          shortcuts={[]}
          onNavigate={vi.fn()}
          agents={recording as never}
        />
      </I18nProvider>,
    );
    const form = manualForm();
    fireEvent.change(within(form).getByLabelText(en["settings.agents.manual.label"]), {
      target: { value: "Kes Agent" },
    });
    fireEvent.change(within(form).getByLabelText(en["settings.agents.manual.command"]), {
      target: { value: "kes" },
    });
    fireEvent.change(within(form).getByLabelText(en["settings.agents.manual.env"]), {
      target: { value: secret },
    });
    fireEvent.click(within(form).getByLabelText(en["settings.agents.manual.transport.acp"]));
    fireEvent.click(within(form).getByRole("button", { name: en["settings.agents.manual.submit"] }));

    await screen.findByText(/never their values/);
    expect(document.body.textContent).not.toContain("sk-live-abcdef123456");
    // The window sent the name-shaped string it was given and nothing more; the *daemon* is what refuses it,
    // which is where the rule is enforced (`AgentProviderConfigSchema`) and where `providers.test.ts` proves it.
    expect(calls.added[0]?.env).toEqual([secret]);
  });

  it("states the rule the schema enforces, before the press", () => {
    show();
    const form = manualForm();
    expect(within(form).getByText(en["settings.agents.manual.env.detail"])).toBeTruthy();
    expect(within(form).getByText(en["settings.agents.manual.transport.detail"])).toBeTruthy();
  });
});

/* ────────────────────────────── the pure half, without a DOM ────────────────────────────── */

describe("the catalogue's own conversions", () => {
  it("produces the parameters `coder.addProvider` takes, from the entry and nothing else", () => {
    // The whole of `addInputFor`, asserted against the fixture entry rather than through a click, so a failure
    // here says which field drifted rather than which button did not respond.
    expect(addInputFor(catalog[2]!)).toEqual({
      // **An id of its own, and the reference to the recipe.** They may not be equal: the store refuses a provider
      // that *is* the catalogue entry it says it came from, and sending `entry.id` here is what made every Add in
      // the catalogue fail on the wire (`catalog-add.test.ts` stores all 38 to keep that from coming back).
      id: "vtcode-acp",
      label: "VT Code",
      command: "vtcode",
      args: ["acp"],
      env: ["VT_ACP_ENABLED", "VT_ACP_ZED_ENABLED"],
      transport: "acp",
      // **The row carries the constants; this function drops them and sends the reference instead.** That
      // pair is the whole design: `providers.json` holds no value at all, and the daemon resolves the
      // recipe's constants from the catalogue it ships.
      catalogEntryId: "vtcode",
    });
    // The values are on the row and not in the parameters — the negative half, asserted rather than implied.
    expect(catalog[2]!.env.map((constant) => constant.value)).toEqual(["1", "1"]);
    expect(JSON.stringify(addInputFor(catalog[2]!))).not.toContain('"1"');
    // A `cli` entry states a different dialect and it travels unchanged.
    expect(addInputFor(catalog[4]!).transport).toBe("cli");
  });
});

/* ────────────────────────────── the frame the section renders in ────────────────────────────── */

describe("the Agents section inside the pane", () => {
  it("is reachable from the sections list and comes back with its own back control", () => {
    // Not a claim about the catalogue: a claim that this page is still a settings section, reachable the way
    // every other one is. A page that renders perfectly but cannot be navigated to is not shipped.
    show();
    expect(screen.getByRole("heading", { name: en["settings.section.agents.title"] })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: new RegExp(en["settings.back"]) }),
    ).toBeTruthy();
    expect(SECTIONS_SCOPE).toEqual({ kind: "sections" });
  });
});
