/**
 * **What the two agent pickers say beside an agent's name — the measurement, not the recipe's provenance.**
 *
 * ## The report this file answers
 *
 * The owner, on *Settings → New tasks → "The agent new tasks start with"*: *"the dropdown has some agents, but
 * the status is wrong. we should make this the same with Agents. Maybe put the ready status agent? How do you
 * think?"* Both pickers (`SectionsControls.tsx`, `SectionsProjects.tsx`) appended *"(needs installing)"*
 * whenever the agent's **recipe tier** was `catalogued`. That is a fact about where a recipe came from rendered
 * as a fact about the user's machine, and it was wrong from the moment the programme was installed: on the
 * owner's machine `claudecode` and `codex` are both `ready` — their ACP bridges are installed and measured — and
 * both read *"(needs installing)"* under a name the Agents page calls **Ready**. Two screens of one product
 * contradicting each other about one agent is worse than either being silent.
 *
 * ## What replaces it, and the two halves of the fix this file keeps true
 *
 * The suffix is now the **verdict** (`verdictSuffix`, `agent-verdict.ts`), whose words come from the same
 * `VERDICT_CHIP` table the Agents page's chips use — so the two screens cannot drift, because there is one
 * table. A ready agent gets **no suffix at all**: a picker that labels every row is a picker whose labels stop
 * being read, and "Ready" beside every option is noise a user learns to skip.
 *
 * The second half is what the picker does with an agent that is **not** ready, and it is deliberately not the
 * owner's first suggestion (hide them; show only Ready). `offeredAgents` already drops the one state that
 * asserts a programme is *absent*, and every other state is offered with its reason named — because a user who
 * cannot see `opencode` in their own agent list concludes this product does not support it. An unexplained
 * short list is the complaint the Agents page exists to answer, so the list is not shortened further: it is
 * *labelled*. The assertions below hold both halves at once.
 *
 * ## The third thing asserted, which is not about words at all
 *
 * A `<select>` whose `value` matches no `<option>` is not "empty" — it is **blank**: the browser clears the
 * selection, and the row that was supposed to say which agent a new task starts on says nothing. The New-tasks
 * picker only rendered its fallback option when the list was *entirely* empty, so a stored default agent that
 * the measurement dropped from the list made the row go blank while the daemon kept the value. Asserted from
 * the rendered `select.value`, which is the only instrument that can see it.
 */

/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings, HarnessAvailability, HarnessState, HarnessSummary, Project } from "@envoydev/protocol";

import { stubAgentActions } from "./fixtures/agent-actions.js";
import { SettingsPane } from "../src/components/SettingsPane.js";
import { I18nProvider } from "../src/i18n/context.js";
import { en } from "../src/i18n/messages/en.js";
import { wiredBindings, type ShortcutActions } from "../src/input/shortcuts.js";
import type { AgentActions } from "../src/state/agent-actions.js";
import type { CoderState } from "../src/state/coderStore.js";
import { appScope, projectScope } from "../src/state/settings-scope.js";

afterEach(cleanup);

/** The two words themselves, read from the catalogue — never spelled out in this file. */
const NOT_READY = en["settings.agent.verdict.notReady"];
const READY = en["settings.agent.verdict.ready"];

const settings: CoderSettings = {
  defaults: { harness: "claudecode" },
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

const WIRED: ShortcutActions = {
  "commandCenter.open": () => {},
  "search.find": () => {},
  newTask: () => {},
  "settings.open": () => {},
};

function availability(state: HarnessState): HarnessAvailability {
  return state === "ready" || state === "unsupported"
    ? { state, binary: "/usr/local/bin/agent" }
    : { state };
}

/**
 * One shipped agent, in one measured state.
 *
 * Only the fields the picker's rule and the rows beside it read are interesting, so they are spelled out and
 * the rest is the shape a daemon sends. `tier` is a parameter rather than a constant because it is the field
 * the retired suffix was derived from: the point of the tests below is that it no longer decides anything.
 */
function agent(
  id: string,
  label: string,
  state: HarnessState,
  tier: "built-in" | "catalogued" = "catalogued",
): HarnessSummary {
  return {
    id,
    label,
    tier,
    summary: "…",
    modes: [],
    models: { kind: "none" as const, options: [], source: "…" },
    thinking: { kind: "none" as const, options: [], source: "…" },
    capabilities: {
      resume: false,
      cancel: false,
      approvals: false,
      structuredTools: false,
      streaming: false,
      images: false,
      agentMode: false,
      model: false,
      thinking: false,
      approvalPolicy: false,
    },
    availability: availability(state),
    auth: { state: "unknown" as const },
    evidence: "…",
  } as HarnessSummary;
}

/**
 * The owner's own machine, reduced to the four rows that matter: two catalogued agents that are **ready** (the
 * bridges were installed, which is what the old suffix got wrong), one whose connector is missing, and one
 * nobody has looked at.
 */
const harnesses: CoderState["harnesses"] = [
  agent("claudecode", "Claude Code", "ready"),
  agent("codex", "Codex", "ready"),
  agent("deepseek-harness", "DeepSeek Harness", "needs-bridge"),
  agent("opencode", "OpenCode", "unknown"),
];

function stateWith(over: Partial<CoderState> = {}): CoderState {
  return {
    connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
    resolved: undefined,
    hello: undefined,
    projects: [project],
    tasks: [],
    tasksKnown: true,
    settings,
    harnesses,
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

// The shared, **typed** stub: it answers a refusal to every action, so a page that reaches one renders
// a state instead of calling `undefined`. A local object cast to the interface is what let this list
// fall behind the interface once already.
const noAgentActions: AgentActions = stubAgentActions();

/** Render one page of the pane, in English, and hand back nothing — every assertion reads the screen. */
function show(scope: ReturnType<typeof appScope>, over: Partial<CoderState> = {}): void {
  render(
    <I18nProvider preference="en">
      <SettingsPane
        state={stateWith(over)}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        scope={scope}
        layout="wide"
        shortcuts={wiredBindings(WIRED)}
        onNavigate={vi.fn()}
        agents={noAgentActions}
      />
    </I18nProvider>,
  );
}

/** The options of the picker a row owns, as the text a user reads. */
function optionsOf(label: string): string[] {
  const picker = screen.getByLabelText(label) as HTMLSelectElement;
  return [...picker.options].map((option) => option.textContent ?? "");
}

const APP_PICKER = "The agent new tasks start with";
const PROJECT_PICKER = "The agent new tasks here start with";

describe("the New-tasks agent picker labels what was measured", () => {
  it("says nothing at all about an agent that is ready — including a catalogued one", () => {
    // **The reported bug, in one assertion.** `claudecode` and `codex` are `tier: "catalogued"` and
    // `availability.state: "ready"` — the owner's machine, exactly — and the old suffix appended
    // `"(needs installing)"` to both because the tier was catalogued. The mutation this fails on is any
    // suffix derived from `tier`.
    show(appScope("tasks"));
    const options = optionsOf(APP_PICKER);

    expect(options).toContain("Claude Code");
    expect(options).toContain("Codex");
    for (const option of options) {
      expect(option).not.toContain("needs installing");
    }
    // And not the verdict word either: no suffix is the point, not a different word.
    expect(options.filter((option) => option.includes(READY))).toEqual([]);
  });

  it("says Not ready beside an agent whose connector is missing, and still offers it", () => {
    // The row stays in the list — it is installed, its connector is not — and the reason it is not usable
    // travels with its name, in the same words the Agents page's chip uses.
    show(appScope("tasks"));
    const options = optionsOf(APP_PICKER);

    expect(options).toContain(`DeepSeek Harness — ${NOT_READY}`);
    // The other half of the same claim: it is *offered*, at the cost of a suffix, rather than dropped.
    expect(options.some((option) => option.includes("DeepSeek Harness"))).toBe(true);
  });

  it("says Not ready beside an agent nobody has looked at, and offers it too", () => {
    // `unknown` is the state a picker may never drop on the user's behalf (`agent-for.ts`), and it is also
    // the state where the product must not promise a run it has not established is possible. Both hold.
    show(appScope("tasks"));
    expect(optionsOf(APP_PICKER)).toContain(`OpenCode — ${NOT_READY}`);
  });

  it("still drops an agent a probe established is absent", () => {
    // Unchanged by this slice, and asserted beside it so the two rules cannot be confused later: the suffix
    // was added to the rows that remain, and the list is exactly as long as the measurements say.
    show(appScope("tasks"), {
      harnesses: harnesses.map((row) =>
        row.id === "opencode" ? { ...row, availability: { state: "not-installed" as const } } : row,
      ),
    });
    expect(optionsOf(APP_PICKER).some((option) => option.includes("OpenCode"))).toBe(false);
  });

  it("keeps the stored agent on screen when the measurement took it out of the list", () => {
    // **The blank-control defect.** The default agent is `opencode`, measured `not-installed`, so the picker
    // does not offer it — and the old code rendered a fallback option only when the list was empty *in full*.
    // A value with no matching option is a blank select, so the row stopped saying which agent a new task
    // would start on while the daemon still held the value: the control and the setting disagreed silently.
    show(appScope("tasks"), {
      settings: { ...settings, defaults: { harness: "opencode" } },
      harnesses: harnesses.map((row) =>
        row.id === "opencode" ? { ...row, availability: { state: "not-installed" as const } } : row,
      ),
    });

    const picker = screen.getByLabelText(APP_PICKER) as HTMLSelectElement;
    expect(picker.value).toBe("opencode");
    // The stored row carries the reason it is missing from the list, in the same words as every other row —
    // and the label is the agent's name rather than the raw id a user never chose.
    expect(optionsOf(APP_PICKER)).toContain(`OpenCode — ${NOT_READY}`);
  });
});

describe("a project's agent picker says the same thing about the same measurements", () => {
  it("adds no suffix to a ready catalogued agent, and the measured one to the rest", () => {
    // One new catalogued agent, `codex`, which is `ready`, beside the four rows above: the two pickers are
    // rendered from the same rule, and this is the assertion that fails if either grows a suffix of its own.
    show(projectScope(project.id));
    const options = optionsOf(PROJECT_PICKER);

    expect(options).toContain("Codex");
    expect(options).toContain(`DeepSeek Harness — ${NOT_READY}`);
    expect(options.some((option) => option.includes("needs installing"))).toBe(false);
  });

  it("keeps a stored project agent on screen when the measurement took it out of the list", () => {
    // The project picker already rendered this fallback; what is new is the reason travelling with it, so a
    // user reading their own project's row learns *why* the agent they chose is not in the list.
    show(projectScope(project.id), {
      projects: [{ ...project, defaults: { harness: "codex" } }],
      harnesses: harnesses.map((row) =>
        row.id === "codex" ? { ...row, availability: { state: "not-installed" as const } } : row,
      ),
    });

    const picker = screen.getByLabelText(PROJECT_PICKER) as HTMLSelectElement;
    expect(picker.value).toBe("codex");
    expect(optionsOf(PROJECT_PICKER)).toContain(`Codex — ${NOT_READY}`);
  });
});
