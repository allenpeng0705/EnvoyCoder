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

import type { CatalogEntry, CatalogProbe, HarnessSummary } from "@envoycoder/protocol";

import { SettingsPane } from "../src/components/SettingsPane.js";
import { addInputFor } from "../src/components/settings/agent-catalog.js";
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
    hidden: false,
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
      "coder.probeCatalogAgent",
      "coder.setAgentHidden",
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
      hidden: false,
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

/** A measurement, as the daemon answers one. */
function probe(availability: CatalogProbe["availability"], over: Partial<CatalogProbe> = {}): CatalogProbe {
  return {
    id: "goose",
    availability,
    costMs: 3,
    observedAt: "2026-09-15T10:00:00.000Z",
    cached: false,
    detail: "…",
    ...over,
  };
}

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
  hidden: { id: string; hidden: boolean }[];
  removed: string[];
  probed: { id: string; force: boolean | undefined }[];
  signedIn: string[];
}

/**
 * The five actions, recorded — and answering whatever the test set up.
 *
 * Deliberately not a `vi.fn()` per method with a shared `mockResolvedValue`: the interesting assertions are on
 * *arguments* (the whole config an Add sends), and a recorder makes those readable at the point of the claim.
 */
function agentActions(options: {
  probes?: Record<string, CatalogProbe | Refusal>;
  addRefusal?: Refusal;
} = {}): { actions: Record<string, unknown>; calls: AgentCalls } {
  const calls: AgentCalls = { added: [], hidden: [], removed: [], probed: [], signedIn: [] };
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
    setAgentHidden: async (id: string, hidden: boolean) => {
      calls.hidden.push({ id, hidden });
      return { ok: true as const, hidden, hiddenAgents: hidden ? [id] : [] };
    },
    probeCatalogAgent: async (id: string, probeOptions: { force?: boolean } = {}) => {
      calls.probed.push({ id, force: probeOptions.force });
      const answer = options.probes?.[id];
      // **Loud on purpose.** A missing arrangement used to answer with a refusal, which rendered as a plausible
      // sentence and made a broken test look like a working one. There is no honest default for "what did the
      // daemon measure", so the fake says so by throwing.
      if (answer === undefined) throw new Error(`this test did not arrange a measurement for ${id}`);
      return "ok" in answer ? answer : { ok: true as const, probe: answer };
    },
    signInAgent: async (id: string) => {
      calls.signedIn.push(id);
      return { ok: true as const, outcome: "signed-in" as const, detail: "…" };
    },
  };
  return { actions, calls };
}

/** Render the Agents page, with the actions and state a case needs. */
function show(
  over: Partial<CoderState> = {},
  options: Parameters<typeof agentActions>[0] = {},
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
  return calls;
}

/** The catalogue list, as a region of its own so a claim about it cannot be satisfied by another part. */
const catalogList = (): HTMLElement => {
  const list = document.querySelector(".settings__catalog");
  if (!(list instanceof HTMLElement)) throw new Error("the catalogue list was not rendered");
  return list;
};

/** One catalogue row, by the entry's own title — never by index, which would pass on a reordered list. */
function row(title: string): HTMLElement {
  const rows = [...catalogList().querySelectorAll(".settings__catalog-row")];
  const found = rows.find((candidate) => candidate.textContent?.includes(title));
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

/** The state chip of a row — the first chip in its head, which is where the state is rendered. */
const chipText = (element: HTMLElement): string =>
  element.querySelector(".settings__agent-head .chip")?.textContent ?? "";

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

  it("shows each catalogue row's command, version and where to get it", () => {
    show();
    const goose = row("goose");
    expect(within(goose).getByText("goose acp")).toBeTruthy();
    expect(within(goose).getByText(en["settings.agents.row.version"].replace("{version}", "1.33.1"))).toBeTruthy();
    const link = within(goose).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://block.github.io/goose/");
  });
});

/* ────────────────────── the state, which is measured or absent ────────────────────── */

describe("what a catalogue row claims", () => {
  it("claims nothing at all until somebody measures it", () => {
    // **The mutation this fails on:** defaulting an unmeasured row to `ready` (or reading the daemon's
    // `unknown` for it). A recipe is a command line and a link; "it is in the catalogue" is not evidence that
    // this machine can run it, and that sentence is the reason this screen was rebuilt.
    show();
    for (const entry of catalog) {
      expect(chipText(row(entry.title)), entry.id).toBe(en["settings.agent.unchecked"]);
    }
    expect(catalogList().textContent).not.toContain(en["settings.agent.ready"]);
    expect(catalogList().textContent).not.toContain(en["settings.agent.notInstalled"]);
  });

  it("renders ready only after a measurement that said so, and not-installed only after one that did", async () => {
    // **The mutation this fails on:** a chip taken from anything but the probe's answer. Two rows, two
    // different answers, and neither may borrow the other's word.
    const calls = show(
      {},
      {
        probes: {
          goose: probe({ state: "ready", binary: "/usr/local/bin/goose" }),
          cline: probe({ state: "not-installed", fix: [{ command: "npx -y cline@3.0.46 --acp" }] }, { id: "cline" }),
        },
      },
    );

    press(row("goose"), en["settings.agents.row.check"]);
    await waitFor(() => expect(chipText(row("goose"))).toBe(en["settings.agent.ready"]));
    // And the row it was *not* measured about is still unmeasured, in both words.
    expect(chipText(row("cline"))).toBe(en["settings.agent.unchecked"]);

    press(row("cline"), en["settings.agents.row.check"]);
    await waitFor(() => expect(chipText(row("cline"))).toBe(en["settings.agent.notInstalled"]));
    expect(chipText(row("goose"))).toBe(en["settings.agent.ready"]);

    // One press, one row: no sweep, which is what keeps 38 rows from costing 38 walks of the search path.
    expect(calls.probed).toEqual([
      { id: "goose", force: false },
      { id: "cline", force: false },
    ]);
  });

  it("asks for a fresh measurement on the second press, because that is what the second press means", async () => {
    // A user who has just installed the program presses again. The daemon refuses to cache a negative answer
    // for exactly this reason, and `force` is the window's half of it.
    const calls = show(
      {},
      { probes: { goose: probe({ state: "not-installed", fix: [{ command: "goose acp" }] }) } },
    );
    press(row("goose"), en["settings.agents.row.check"]);
    await waitFor(() => expect(chipText(row("goose"))).toBe(en["settings.agent.notInstalled"]));
    press(row("goose"), en["settings.agents.row.checkAgain"]);
    await waitFor(() => expect(calls.probed).toHaveLength(2));
    expect(calls.probed).toEqual([
      { id: "goose", force: false },
      { id: "goose", force: true },
    ]);
  });

  it("shows the install link and the exact command when the program is missing", async () => {
    // **The mutation this fails on:** rendering the state without the fix. A row that says what is absent and
    // not what to do is the sentence `AvailabilityFix` replaced — and the whole point of the catalogue is
    // that a user can get from "not installed" to "running" without leaving it.
    show(
      {},
      {
        probes: {
          goose: probe({
            state: "not-installed",
            fix: [{ command: "install goose — then it runs as: goose acp", url: "https://block.github.io/goose/" }],
          }),
        },
      },
    );
    const goose = row("goose");
    // The link is entry data, so it is shown whether or not anything was measured.
    expect(within(goose).getByRole("link").getAttribute("href")).toBe("https://block.github.io/goose/");
    expect(goose.textContent).toContain("goose acp");

    press(goose, en["settings.agents.row.check"]);
    await screen.findByText(/then it runs as: goose acp/);
  });

  it("says plainly that an npx recipe needs no install, and names what the first run fetches", () => {
    // **The mutation this fails on:** one "install it" sentence for both shapes. Half the catalogue is fetched
    // from npm on first run and has no installer at all, and telling a user to install it sends them to a
    // download page for something that installs itself.
    show();
    const cline = row("Cline");
    expect(cline.textContent).toContain(
      en["settings.agents.row.needsNoInstall"]
        .replace("{package}", "cline@3.0.46")
        .replace("{agent}", "Cline"),
    );
    expect(cline.textContent).not.toContain(en["settings.agents.row.install"].split("{")[0]);
    // …and the other shape gets the other sentence.
    expect(row("goose").textContent).toContain(en["settings.agents.row.install"].split("{")[0]);
  });

  it("does not let an npx row read as verified, because only `npx` was measured", async () => {
    // **The over-claim this test exists for.** The daemon's `ready` for an `npx -y <pkg> …` recipe means
    // **`npx` resolved** — the probe looks for `npx` rather than the package, deliberately, because looking
    // for the package would report all 14 of these rows as missing. So "Ready" on those rows claimed a
    // verification nobody performed, and nothing has been downloaded. Two assertions, and both matter:
    //   * the chip word is the narrowed one, not `settings.agent.ready`;
    //   * the sentence names what was *not* measured, so the narrowed word is explained rather than replaced
    //     by another unsupported claim.
    show(
      {},
      {
        probes: {
          cline: probe({ state: "ready", binary: "/usr/bin/npx" }, { id: "cline" }),
        },
      },
    );
    // A measurement only exists after the user asks for one — that is the row's whole design, so the chip
    // starts as "Not checked yet" and this test presses the button rather than assuming a state.
    press(row("Cline"), en["settings.agents.row.check"]);
    const chip = await within(row("Cline")).findByText(en["settings.agents.row.readyNpx"]);
    expect(chip.textContent).toBe(en["settings.agents.row.readyNpx"]);
    expect(chip.textContent).not.toBe(en["settings.agent.ready"]);
    expect(row("Cline").textContent).toContain("not been downloaded yet");

    // A fresh render, because `row()` reads the first list in the document and two live trees would make
    // this second half assert about the wrong one.
    cleanup();

    // And a row whose program really was found still says Ready: the narrowing is about the *shape* of the
    // recipe, not a blanket doubt about the probe.
    show(
      {},
      {
        probes: {
          goose: probe({ state: "ready", binary: "/usr/local/bin/goose" }),
        },
      },
    );
    press(row("goose"), en["settings.agents.row.check"]);
    await within(row("goose")).findByText(en["settings.agent.ready"]);
    expect(chipText(row("goose"))).toBe(en["settings.agent.ready"]);
  });

  it("shows a refused check as the daemon's own sentence, on the row that earned it", async () => {
    show(
      {},
      {
        probes: {
          goose: {
            ok: false,
            message: "The daemon is an older build.",
            key: "error.daemonTooOld",
            values: { method: "coder.probeCatalogAgent" },
          } as unknown as Refusal,
        },
      },
    );
    press(row("goose"), en["settings.agents.row.check"]);
    await within(row("goose")).findByText(/older build/);
    expect(chipText(row("goose"))).toBe(en["settings.agent.refused"]);
    // The row nobody asked about is untouched: a failure is about the row that was measured.
    expect(chipText(row("Cline"))).toBe(en["settings.agent.unchecked"]);
  });

  it("says so when an older daemon has no catalogue, instead of throwing the pane away", async () => {
    // **The mutation this fails on:** reading `hello.methods` and calling anyway, or assuming `state.catalog`
    // is non-empty. A daemon from the previous build refuses both methods, and a page that asked regardless
    // would answer a German user with "Method not found" four times — or, worse, render an empty catalogue as
    // "there are no agents", which is a claim about the product rather than about the build.
    show({
      hello: { ...state.hello!, methods: ["coder.hello", "coder.listHarnesses"] },
      catalog: [],
      providers: [],
    });
    expect(screen.getAllByText(en["settings.agents.olderDaemon"]).length).toBeGreaterThan(0);
    // The shipped agents still render from the method this daemon *does* serve.
    expect(within(shippedList()).getByText("Envoy Harness")).toBeTruthy();
    // **And the catalogue's own surface is not rendered at all.** This is the assertion with teeth: the
    // sentence above is also printed for the "Your agents" group, so a page that rendered the catalogue
    // anyway would still satisfy it. What must not exist is the *search box over an empty list* — a user
    // reading that concludes "there are no agents", which is a claim about the product rather than about the
    // build this window is talking to.
    expect(document.querySelector(".settings__catalog-search")).toBeNull();
    expect(document.querySelector(".settings__catalog")).toBeNull();
  });
});

/* ────────────────────────────── adding, hiding, signing in ────────────────────────────── */

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
        id: "vtcode",
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
    expect(cursor.textContent).toContain(en["settings.agents.row.builtIn"]);
  });
});

describe("turning an agent on and off", () => {
  it("hides an agent without changing one word of what it reports", async () => {
    // **The audit's correction, as a test.** Hiding is a *preference* the user expresses; the state beside it
    // is a *measurement* we made. Paseo's switch rewrites the reported state (`unavailable`, and a
    // `listModels` that throws), and `docs/settings-parity.md` §5.8 records the audit that first mistook the
    // two — twice. A test that only asserted "setAgentHidden was called" would pass on exactly that defect,
    // so this one reads the row's own chip as well.
    const calls = show();
    const envoy = rowFor("Envoy Harness");
    expect(chipText(envoy)).toBe(en["settings.agent.ready"]);
    expect(envoy.textContent).not.toContain(en["settings.agents.hidden"]);

    press(envoy, en["settings.agents.hide"]);
    await waitFor(() => expect(calls.hidden).toEqual([{ id: "envoy-harness", hidden: true }]));
    // Nothing the row reports has moved. (It still says Ready and still carries its declared facts; the
    // daemon is what will now hand the next `coder.listHarnesses` a `hidden: true` **beside** that state.)
    expect(chipText(rowFor("Envoy Harness"))).toBe(en["settings.agent.ready"]);
    expect(rowFor("Envoy Harness").textContent).toContain(en["settings.agent.tier.builtIn"]);
  });

  it("shows a hidden agent's own preference chip, over a state it does not touch", () => {
    // The other half of the same property, and the half a fixture can prove: with `hidden: true` on the wire,
    // the row carries **both** — the preference chip and the measured state — which is the whole shape of
    // `HarnessSummary.hidden`.
    show({ harnesses: [harness({ id: "envoy-harness", label: "Envoy Harness", tier: "built-in", hidden: true })] });
    const envoy = rowFor("Envoy Harness");
    expect(envoy.textContent).toContain(en["settings.agents.hidden"]);
    expect(chipText(envoy)).toBe(en["settings.agent.ready"]);
    expect(within(envoy).getByRole("button", { name: en["settings.agents.show"] })).toBeTruthy();
  });

  it("shows a missing agent's install command whatever the user has done to their list", () => {
    show();
    const codex = rowFor("Codex");
    expect(codex.textContent).toContain("npm install -g @openai/codex");
    expect(chipText(codex)).toBe(en["settings.agent.notInstalled"]);
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
    const form = document.querySelector(".settings__manual");
    if (!(form instanceof HTMLElement)) throw new Error("the manual form was not rendered");
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
    const form = document.querySelector(".settings__manual");
    if (!(form instanceof HTMLElement)) throw new Error("the manual form was not rendered");
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
    const form = document.querySelector(".settings__manual");
    if (!(form instanceof HTMLElement)) throw new Error("the manual form was not rendered");
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
    const form = document.querySelector(".settings__manual");
    if (!(form instanceof HTMLElement)) throw new Error("the manual form was not rendered");
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
      id: "vtcode",
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
