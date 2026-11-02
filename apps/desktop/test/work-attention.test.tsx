/**
 * WorkAttention — person/* tickets and actions.
 */

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkTicket } from "@envoydev/work-model";

import { WorkAttention } from "../src/components/WorkAttention.js";
import { I18nProvider } from "../src/i18n/context.js";
import { stubAgentActions } from "./fixtures/agent-actions.js";

afterEach(cleanup);

const reviewTicket: WorkTicket = {
  id: "wt-1",
  shortName: "wt-1",
  title: "Review the patch",
  taskId: "task-9",
  status: "open",
  mandate: {
    id: "m-1",
    policyVersion: 1,
    strength: "explicit",
    scope: "manual",
    createdAt: "2026-02-01T12:00:00.000Z",
  },
  assignments: [],
  latestReport: { kind: "ready", at: "2026-02-01T12:01:00.000Z" },
  createdAt: "2026-02-01T12:00:00.000Z",
  updatedAt: "2026-02-01T12:01:00.000Z",
};

describe("WorkAttention", () => {
  it("lists a ready ticket with review label and Open, Retry, Stop", async () => {
    const onOpenTask = vi.fn();
    const agents = stubAgentActions({
      listWorkAttention: vi.fn(async () => ({ ok: true as const, tickets: [reviewTicket] })),
      retryWorkTicket: vi.fn(async () => ({ ok: true as const, ticket: reviewTicket })),
      stopWorkTicket: vi.fn(async () => ({ ok: true as const, ticket: reviewTicket })),
    });

    render(
      <I18nProvider preference="en">
        <WorkAttention agents={agents} onOpenTask={onOpenTask} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("work-attention")).toBeTruthy());
    expect(screen.getByText("Review the patch")).toBeTruthy();
    expect(screen.getByText("Awaiting review")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(onOpenTask).toHaveBeenCalledWith("task-9");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(agents.retryWorkTicket).toHaveBeenCalledWith("wt-1");

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(agents.stopWorkTicket).toHaveBeenCalledWith("wt-1");
  });

  it("renders nothing when attention is empty", async () => {
    const agents = stubAgentActions({
      listWorkAttention: vi.fn(async () => ({ ok: true as const, tickets: [] })),
    });
    render(
      <I18nProvider preference="en">
        <WorkAttention agents={agents} />
      </I18nProvider>,
    );
    await waitFor(() => expect(agents.listWorkAttention).toHaveBeenCalled());
    expect(screen.queryByTestId("work-attention")).toBeNull();
  });
});
