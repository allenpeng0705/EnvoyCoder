/**
 * Project agent picker — click the label, pick an agent, updateProject fires.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HarnessSummary, Project } from "@envoydev/protocol";

import { ProjectAgentPicker } from "../src/components/ProjectAgentPicker.js";
import { I18nProvider } from "../src/i18n/context.js";
import { en } from "../src/i18n/messages/en.js";

afterEach(cleanup);

const project: Project = {
  id: "proj-1",
  path: "/tmp/repo",
  label: "repo",
  createdAt: "2026-01-01T00:00:00.000Z",
  defaults: { harness: "envoy-harness" },
};

function harness(id: HarnessSummary["id"], label: string): HarnessSummary {
  return {
    id,
    label,
    tier: id === "envoy-harness" ? "built-in" : "catalogued",
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
    availability: { state: "ready", binary: `/usr/bin/${id}` },
    auth: { state: "unknown" },
    evidence: "…",
  };
}

describe("ProjectAgentPicker", () => {
  it("opens a menu and updates the project agent", async () => {
    const onChoose = vi.fn(async () => ({ ok: true as const }));
    render(
      <I18nProvider preference="en">
        <ProjectAgentPicker
          project={project}
          appHarness="envoy-harness"
          harnesses={[
            harness("envoy-harness", "Envoy Harness"),
            harness("deepseek-harness", "DeepSeek Harness"),
          ]}
          appearance="meta"
          onChoose={onChoose}
        />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: en["project.agent.picker.aria"].replace("{agent}", "Envoy Harness"),
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "DeepSeek Harness" }));

    await waitFor(() => expect(onChoose).toHaveBeenCalled());
    expect(onChoose).toHaveBeenCalledWith({ harness: "deepseek-harness" });
  });
});
