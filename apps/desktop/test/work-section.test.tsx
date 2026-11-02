/**
 * WorkSection — mode, GitHub-first layout, review queue.
 */

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings } from "@envoydev/protocol";
import { defaultWorkPolicy } from "@envoydev/work-model";

import { WorkSection } from "../src/components/settings/WorkSection.js";
import { I18nProvider } from "../src/i18n/context.js";
import type { CoderState } from "../src/state/coderStore.js";
import { stubAgentActions } from "./fixtures/agent-actions.js";

afterEach(cleanup);

const settings: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "en",
};

const state = {
  connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
  settings,
} as unknown as CoderState;

describe("WorkSection UX", () => {
  it("shows mode select and GitHub controls in Watch mode", async () => {
    const agents = stubAgentActions({
      getWorkPolicy: vi.fn(async () => ({
        ok: true as const,
        policy: { ...defaultWorkPolicy(), enabled: true, acceptMode: "observe" },
      })),
      listWorkCandidates: vi.fn(async () => ({ ok: true as const, candidates: [] })),
      githubPoll: vi.fn(async () => ({
        ok: true as const,
        triggers: 0,
        candidates: 0,
        wouldAccept: 0,
        accepted: 0,
      })),
    });

    render(
      <I18nProvider preference="en">
        <WorkSection state={state} onUpdate={async () => undefined} agents={agents} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("work-mode")).toBeTruthy());
    expect(screen.getByTestId("work-github-poll")).toBeTruthy();
    expect(screen.getByTestId("work-github-auto-poll")).toBeTruthy();
    expect(screen.getByText("Needs your review")).toBeTruthy();
    expect(screen.getByText("Advanced")).toBeTruthy();
  });

  it("hides GitHub when Mode is Off", async () => {
    const agents = stubAgentActions({
      getWorkPolicy: vi.fn(async () => ({
        ok: true as const,
        policy: { ...defaultWorkPolicy(), enabled: false },
      })),
      listWorkCandidates: vi.fn(async () => ({ ok: true as const, candidates: [] })),
    });

    render(
      <I18nProvider preference="en">
        <WorkSection state={state} onUpdate={async () => undefined} agents={agents} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("work-mode")).toBeTruthy());
    expect(screen.queryByTestId("work-github-poll")).toBeNull();
  });

  it("maps Mode Take work to enabled + auto", async () => {
    const setWorkPolicy = vi.fn(async (patch: Record<string, unknown>) => ({
      ok: true as const,
      policy: {
        ...defaultWorkPolicy(),
        enabled: patch.enabled === true,
        acceptMode: (patch.acceptMode as "auto") ?? "observe",
      },
    }));
    const agents = stubAgentActions({
      getWorkPolicy: vi.fn(async () => ({
        ok: true as const,
        policy: { ...defaultWorkPolicy(), enabled: true, acceptMode: "observe" },
      })),
      setWorkPolicy,
      listWorkCandidates: vi.fn(async () => ({ ok: true as const, candidates: [] })),
    });

    render(
      <I18nProvider preference="en">
        <WorkSection state={state} onUpdate={async () => undefined} agents={agents} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("work-mode")).toBeTruthy());
    fireEvent.change(screen.getByTestId("work-mode"), { target: { value: "take" } });
    await waitFor(() =>
      expect(setWorkPolicy).toHaveBeenCalledWith({ enabled: true, acceptMode: "auto" }),
    );
  });
});
