/**
 * Settings section Info — inline what/how on Agents, LLM, Pairing and Teams.
 *
 * | test | the mutation that fails it |
 * |---|---|
 * | "shows Info on the four complex sections" | dropping SectionInfo from SectionPage |
 * | "omits Info on a simple section" | rendering Info on every section |
 * | "prints what and how on the page" | an empty block, or missing steps |
 * | "skips the short band when Info is present" | band + Info saying the same thing twice |
 * | "speaks the window's language" | hard-coded English in the block |
 */

/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings, Project } from "@envoydev/protocol";

import { SettingsPane } from "../src/components/SettingsPane.js";
import { SECTIONS_WITH_INFO } from "../src/components/settings/SectionInfo.js";
import { en } from "../src/i18n/messages/en.js";
import { zh } from "../src/i18n/messages/zh.js";
import { I18nProvider } from "../src/i18n/context.js";
import { wiredBindings, type ShortcutActions } from "../src/input/shortcuts.js";
import type { AgentActions } from "../src/state/agent-actions.js";
import type { CoderState } from "../src/state/coderStore.js";
import { appScope, type SettingsScope } from "../src/state/settings-scope.js";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../src/state/settings-sections.js";
import { stubAgentActions } from "./fixtures/agent-actions.js";

afterEach(cleanup);

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

const WIRED: ShortcutActions = {
  "commandCenter.open": () => {},
  "search.find": () => {},
  newTask: () => {},
  "settings.open": () => {},
};

const harnesses: CoderState["harnesses"] = (["envoy-harness", "deepseek-harness"] as const).map((id) => ({
  id,
  hidden: false,
  auth: { state: "unknown" as const },
  label: id === "envoy-harness" ? "Envoy Harness" : "DeepSeek Harness",
  tier: id === "envoy-harness" ? ("built-in" as const) : ("catalogued" as const),
  summary: "…",
  modes: [{ id: "plan", label: "plan" }],
  models: {
    kind: "listed" as const,
    options: [
      {
        id: "deepseek/deepseek-chat",
        label: "deepseek-chat",
        provider: "deepseek",
        model: "deepseek-chat",
      },
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

const noAgentActions: AgentActions = stubAgentActions();

function show(
  scope: SettingsScope,
  preference: "en" | "zh" = "en",
  layout: "wide" | "narrow" = "wide",
): void {
  render(
    <I18nProvider preference={preference}>
      <SettingsPane
        state={stateWith()}
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
}

describe("Settings section Info", () => {
  it("shows Info on Agents, LLM, Pairing and Teams — and nowhere else", () => {
    const withInfo = new Set<string>(SECTIONS_WITH_INFO);
    for (const section of SETTINGS_SECTIONS) {
      cleanup();
      show(appScope(section.id as SettingsSectionId));
      const block = screen.queryByTestId(`settings-info-${section.id}`);
      if (withInfo.has(section.id)) {
        expect(block, `${section.id} should show Info`).toBeTruthy();
      } else {
        expect(block, `${section.id} should not show Info`).toBeNull();
      }
    }
  });

  it("prints what and how on the page", () => {
    show(appScope("agents"));
    const block = screen.getByTestId("settings-info-agents");
    expect(within(block).getByText(en["settings.section.agents.info.what"])).toBeTruthy();
    expect(within(block).getByText(en["settings.info.howHeading"])).toBeTruthy();
    expect(within(block).getByText(en["settings.section.agents.info.how.1"])).toBeTruthy();
    expect(within(block).getByText(en["settings.section.agents.info.how.4"])).toBeTruthy();
  });

  it("skips the short band sentence when Info is present (narrow)", () => {
    show(appScope("agents"), "en", "narrow");
    expect(screen.getByTestId("settings-info-agents")).toBeTruthy();
    expect(screen.queryByText(en["settings.section.agents.detail"])).toBeNull();
  });

  it("localizes the Info body", () => {
    show(appScope("llm"), "zh");
    const block = screen.getByTestId("settings-info-llm");
    expect(within(block).getByText(zh["settings.section.llm.info.what"])).toBeTruthy();
    expect(within(block).getByText(zh["settings.info.howHeading"])).toBeTruthy();
  });
});
