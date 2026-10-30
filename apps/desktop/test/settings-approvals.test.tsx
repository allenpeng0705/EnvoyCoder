/**
 * Safety → “Ask before risky steps”: the checkbox is enabled only when the catalogue
 * has a deliverable wire. Copilot/OMP listing an `unattended` mode must not enable it.
 */

/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings, HarnessId } from "@envoydev/protocol";
import { HARNESS_CATALOG } from "@envoydev/agent-catalog";

import { SettingsPane } from "../src/components/SettingsPane.js";
import { en } from "../src/i18n/messages/en.js";
import { I18nProvider } from "../src/i18n/context.js";
import { wiredBindings, type ShortcutActions } from "../src/input/shortcuts.js";
import type { AgentActions } from "../src/state/agent-actions.js";
import type { CoderState } from "../src/state/coderStore.js";
import { appScope } from "../src/state/settings-scope.js";
import { stubAgentActions } from "./fixtures/agent-actions.js";

afterEach(cleanup);

const settings: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "en",
};

const WIRED: ShortcutActions = {
  "commandCenter.open": () => {},
  "search.find": () => {},
  newTask: () => {},
  "settings.open": () => {},
};

const noAgentActions: AgentActions = stubAgentActions();

function harnessSummary(id: HarnessId, over: Partial<CoderState["harnesses"][number]> = {}) {
  const def = HARNESS_CATALOG[id];
  return {
    id,
    hidden: false,
    auth: { state: "unknown" as const },
    label: def.label,
    tier: "catalogued" as const,
    summary: "…",
    modes: def.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      ...(mode.unattended === true ? { unattended: true as const } : {}),
    })),
    models: { kind: "none" as const, options: [], source: "…" },
    thinking: { kind: "none" as const, options: [], source: "…" },
    capabilities: {
      resume: true,
      cancel: true,
      approvals: true,
      structuredTools: true,
      streaming: true,
      images: false,
      agentMode: def.capabilities.agentMode,
      model: false,
      thinking: false,
      approvalPolicy: def.capabilities.approvalPolicy,
    },
    availability: { state: "ready" as const, binary: `/usr/bin/${id}` },
    evidence: "…",
    ...over,
  };
}

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
      windowCount: 1,
      methods: [],
      mesh: { kind: "no-node" },
      notes: [],
    },
    projects: [],
    tasks: [],
    tasksKnown: true,
    settings,
    harnesses: [harnessSummary("envoy-harness")],
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

function showSafety(state: CoderState): void {
  render(
    <I18nProvider preference="en">
      <SettingsPane
        state={state}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        scope={appScope("safety")}
        layout="wide"
        shortcuts={wiredBindings(WIRED)}
        onNavigate={vi.fn()}
        agents={noAgentActions}
      />
    </I18nProvider>,
  );
}

function approvalsCheckbox(): HTMLInputElement {
  const box = screen.getByRole("checkbox", { name: en["settings.approvals.title"] });
  if (!(box instanceof HTMLInputElement)) throw new Error("approvals checkbox missing");
  return box;
}

describe("Safety → Ask before risky steps", () => {
  it("enables the switch for Envoy Harness (policy wire)", () => {
    showSafety(stateWith());
    expect(approvalsCheckbox().disabled).toBe(false);
    expect(
      screen.getByText(en["settings.approvals.reaches"].replace("{agent}", "Envoy Harness")),
    ).toBeTruthy();
  });

  it("enables the switch for Claude (deliverable unattended mode)", () => {
    showSafety(
      stateWith({
        settings: { ...settings, defaults: { harness: "claudecode" } },
        harnesses: [harnessSummary("claudecode")],
      }),
    );
    expect(approvalsCheckbox().disabled).toBe(false);
    expect(screen.getByText(/Bypass permissions/)).toBeTruthy();
  });

  it("disables the switch for Copilot even when the summary lists an unattended mode", () => {
    const copilot = harnessSummary("copilot");
    expect(copilot.modes.some((mode) => mode.unattended === true)).toBe(true);
    showSafety(
      stateWith({
        settings: { ...settings, defaults: { harness: "copilot" } },
        harnesses: [copilot],
      }),
    );
    expect(approvalsCheckbox().disabled).toBe(true);
    expect(
      screen.getByText(
        en["settings.approvals.unsupported"].replaceAll("{agent}", HARNESS_CATALOG.copilot.label),
      ),
    ).toBeTruthy();
  });

  it("disables the switch for OMP even when the summary lists an unattended mode", () => {
    const omp = harnessSummary("omp");
    expect(omp.modes.some((mode) => mode.unattended === true)).toBe(true);
    showSafety(
      stateWith({
        settings: { ...settings, defaults: { harness: "omp" } },
        harnesses: [omp],
      }),
    );
    expect(approvalsCheckbox().disabled).toBe(true);
    expect(
      screen.getByText(
        en["settings.approvals.unsupported"].replaceAll("{agent}", HARNESS_CATALOG.omp.label),
      ),
    ).toBeTruthy();
  });
});
