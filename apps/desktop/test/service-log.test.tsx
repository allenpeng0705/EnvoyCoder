/**
 * The log disclosure on the Background service row, rendered.
 *
 * ## What this file is for, and the one property it exists for
 *
 * Reading the daemon log is a **file read on the daemon**, and most visits to this row do not want it. So the
 * disclosure fetches when it is opened and not before, and nothing here — not a re-render, not a status read
 * landing, not a close-and-reopen — may turn into a second read. The cases below assert that with call counts
 * on the action itself, which is the only place the property is observable.
 *
 * The rest is the panel's obligations to a reader, in the order `ServiceLog.tsx` states them: which file it is,
 * whether this is all of it (`truncated` is said, never implied), an empty state rather than an error when
 * nothing has written a log, and a refusal rendered where the press was.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DaemonServiceStatus } from "@envoydev/protocol";

import { SettingsPane } from "../src/components/SettingsPane.js";
import { I18nProvider } from "../src/i18n/context.js";
import { en } from "../src/i18n/messages/en.js";
import { appScope } from "../src/state/settings-scope.js";
import type { AgentActions } from "../src/state/agent-actions.js";
import type { CoderState } from "../src/state/coderStore.js";
import { stubAgentActions } from "./fixtures/agent-actions.js";

afterEach(cleanup);

const settings: CoderState["settings"] = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "en",
};

const running: DaemonServiceStatus = {
  state: "running",
  enabled: true,
  pid: 7,
  detail: "",
  restartsInLastHour: 0,
};

const LOG_PATH = "/home/you/.envoymesh/EnvoyDev/logs/daemon.log";

function stateWith(status: DaemonServiceStatus): CoderState {
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
    harnesses: [],
    providers: [],
    catalog: [],
    mesh: { kind: "no-node", reason: "" },
    runs: {},
    loaded: true,
    error: undefined,
    notes: [],
    service: status,
  };
}

/** The pane at the service scope, with the log read wired to whatever a case stages. */
function show(overrides: Partial<AgentActions> = {}) {
  const agents = stubAgentActions({
    getServiceStatus: vi.fn(async () => ({ ok: true as const, service: running })),
    ...overrides,
  });
  const { container } = render(
    <I18nProvider preference="en">
      <SettingsPane
        state={stateWith(running)}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        scope={appScope("service")}
        layout="wide"
        shortcuts={[]}
        onNavigate={vi.fn()}
        agents={agents}
      />
    </I18nProvider>,
  );
  return { container };
}

const toggle = (container: HTMLElement): HTMLButtonElement => {
  const found = container.querySelector("[data-service-log-toggle]");
  if (!(found instanceof HTMLButtonElement)) throw new Error("the service row has no log toggle");
  return found;
};

const panel = (container: HTMLElement): HTMLElement | null =>
  container.querySelector(".settings__log");

const refresh = (container: HTMLElement): HTMLButtonElement => {
  const found = container.querySelector("[data-service-log-refresh]");
  if (!(found instanceof HTMLButtonElement)) throw new Error("the log panel has no Refresh button");
  return found;
};

const okAnswer = (lines: string[], truncated = false) => ({
  ok: true as const,
  log: { path: LOG_PATH, lines, truncated },
});

describe("when the log is read", () => {
  it("is not read on mount, and is read exactly once when the disclosure opens", async () => {
    // **The mutation this fails on:** fetching in a `useEffect` on mount (or on `logOpen`), which turns opening a
    // settings page into a daemon file read nobody asked for.
    const getDaemonLog = vi.fn(async () => okAnswer(["first", "second"]));
    const { container } = show({ getDaemonLog });
    // The row's own status load has not even settled yet; the log still must not have been asked for.
    expect(getDaemonLog).not.toHaveBeenCalled();
    expect(panel(container)).toBeNull();

    fireEvent.click(toggle(container));
    expect(getDaemonLog).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(container.querySelector("[data-service-log-lines]")?.textContent).toBe("first\nsecond"),
    );
  });

  it("does not read a second time when the row re-renders, closes and reopens", async () => {
    // **The mutation this fails on:** an effect keyed on `logOpen`/`log`, or a toggle that re-reads on every
    // open. A re-render is not a request; only the first open and Refresh are.
    const getDaemonLog = vi.fn(async () => okAnswer(["only"]));
    const { container } = show({ getDaemonLog });

    fireEvent.click(toggle(container));
    await waitFor(() => expect(container.querySelector("[data-service-log-lines]")).not.toBeNull());
    // The status load settles here, which re-renders the row — and the read count must not move.
    await waitFor(() =>
      expect(container.querySelector('[data-service-state="running"]')).not.toBeNull(),
    );
    expect(getDaemonLog).toHaveBeenCalledTimes(1);

    fireEvent.click(toggle(container));
    expect(panel(container)).toBeNull();
    fireEvent.click(toggle(container));
    expect(panel(container)).not.toBeNull();
    expect(getDaemonLog).toHaveBeenCalledTimes(1);
  });

  it("re-reads on Refresh, and disables that press while a read is in flight", async () => {
    let settle: (answer: ReturnType<typeof okAnswer>) => void = () => {};
    const getDaemonLog = vi.fn(
      () =>
        new Promise<ReturnType<typeof okAnswer>>((resolve) => {
          settle = resolve;
        }),
    );
    const { container } = show({ getDaemonLog });

    fireEvent.click(toggle(container));
    // In flight: the panel says so and the only press that could ask twice is disabled.
    expect(refresh(container).disabled).toBe(true);
    expect(refresh(container).textContent).toBe(en["settings.service.log.reading"]);

    settle(okAnswer(["one"]));
    await waitFor(() => expect(refresh(container).disabled).toBe(false));

    fireEvent.click(refresh(container));
    expect(getDaemonLog).toHaveBeenCalledTimes(2);
    settle(okAnswer(["two"]));
    await waitFor(() =>
      expect(container.querySelector("[data-service-log-lines]")?.textContent).toBe("two"),
    );
  });
});

describe("what the panel says", () => {
  it("names the file it read, shortened, with the whole path on hover", async () => {
    // "The log" is two files on a machine that has run both ways, so which one was read is part of the answer.
    const { container } = show({ getDaemonLog: vi.fn(async () => okAnswer(["x"])) });
    fireEvent.click(toggle(container));

    const path = await waitFor(() => {
      const found = container.querySelector("[data-service-log-path]");
      if (found === null) throw new Error("no path yet");
      return found;
    });
    expect(path.textContent).toBe("…/logs/daemon.log");
    expect(path.getAttribute("title")).toBe(LOG_PATH);
  });

  it("says out loud when the tail is a tail", async () => {
    // **The mutation this fails on:** dropping the truncation note. The daemon returns at most the last 200 lines
    // / 64 KB, and a tail that reads as a complete log is a lie somebody debugs from.
    const { container } = show({ getDaemonLog: vi.fn(async () => okAnswer(["x"], true)) });
    fireEvent.click(toggle(container));

    expect(await screen.findByText(en["settings.service.log.truncated"])).toBeTruthy();
  });

  it("renders an empty state, not an error, when nothing has written a log yet", async () => {
    // `lines: []` with a path is normal on a machine that has never run the daemon. The mutation is rendering it
    // as a failure — a red line for a machine that is simply new.
    const { container } = show({ getDaemonLog: vi.fn(async () => okAnswer([])) });
    fireEvent.click(toggle(container));

    expect(await screen.findByText(en["settings.service.log.empty"])).toBeTruthy();
    expect(container.querySelector("[data-service-log-lines]")).toBeNull();
    expect(container.querySelector(".setting__failure")).toBeNull();
    // Truncation is meaningless when there are no lines, so the note must not be there either.
    expect(screen.queryByText(en["settings.service.log.truncated"])).toBeNull();
  });

  it("renders a refusal on the panel, where the press was", async () => {
    // A daemon log is owner-window-only, so a refusal is a real answer rather than a bug to swallow.
    const { container } = show({
      getDaemonLog: vi.fn(async () => ({
        ok: false as const,
        message: "envoydev.owner-window-only: this can only be done at the machine itself",
      })),
    });
    fireEvent.click(toggle(container));

    await waitFor(() =>
      expect(container.querySelector(".setting__failure")?.textContent).toContain("owner-window-only"),
    );
    expect(container.querySelector("[data-service-log-lines]")).toBeNull();
  });
});
