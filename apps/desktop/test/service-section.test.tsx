/**
 * The Background service row, rendered — which state it shows, and what its presses do.
 *
 * ## Why this file exists next to `service-state.test.ts`
 *
 * That test proves the *projection*: the six states, the login gate, the buttons each state allows. This one
 * proves the row is actually wired to it: the words reach the DOM, the press calls the call it names, the
 * supervisor's `detail` is on screen only where it is a diagnosis, and **a press in flight disables every
 * button** so a supervisor cannot be asked twice for the same change.
 *
 * The pane renders through `SettingsPane` at the service scope rather than `ServiceSection` alone, because the
 * wiring under test includes the section registry and the pane's `switch` — a section registered in the bar
 * with no page behind it is the failure `settings-nav.test.tsx` refuses, and a page reached with the wrong
 * scope is this file's concern.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function stateWith(service: DaemonServiceStatus | undefined): CoderState {
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
    ...(service !== undefined ? { service } : {}),
  };
}

/** The pane at the service scope, with the daemon calls a test cares about wired. */
function show(service: DaemonServiceStatus | undefined, overrides: Partial<AgentActions> = {}) {
  const agents = stubAgentActions({
    // The page's own load, which every case here needs to settle rather than refuse — otherwise the row is
    // rendering "could not tell" and the assertions below would be about a different state.
    getServiceStatus: vi.fn(async () => ({ ok: true as const, service: service ?? { state: "unknown", detail: "" } })),
    ...overrides,
  });
  const { container } = render(
    <I18nProvider preference="en">
      <SettingsPane
        state={stateWith(service)}
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
  return { container, agents };
}

/** One service press's button, found by the action it performs rather than by its label. */
const button = (container: HTMLElement, action: string): HTMLButtonElement => {
  const found = container.querySelector(`[data-service-action="${action}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no ${action} button on the service row`);
  return found;
};

const allButtons = (container: HTMLElement): HTMLButtonElement[] => [
  ...container.querySelectorAll("[data-service-action]"),
].filter((node): node is HTMLButtonElement => node instanceof HTMLButtonElement);

/**
 * Wait for the page's own load to settle, so a press in the cases below is a press a user could make.
 *
 * The row asks the supervisor for the status when it opens and disables every button until the answer
 * arrives, so a click issued synchronously after `render` would be a click on a disabled control — a test
 * artifact, not the behaviour under test.
 */
const ready = async (container: HTMLElement): Promise<void> => {
  await waitFor(() => expect(allButtons(container).every((node) => !node.disabled)).toBe(true));
};

describe("what the row shows", () => {
  it("renders the off state with the price of being off and the one press that changes it", async () => {
    const { container } = show({ state: "not-installed", detail: "Could not find service" });
    // The supervisor's "not found" words are a status report, not a diagnosis — they are not on the row.
    expect(container.querySelector('[data-testid="service-detail"]')).toBeNull();
    expect(await screen.findByText(en["settings.service.state.notInstalled.title"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.state.notInstalled.detail"])).toBeTruthy();
    // Only the on press: there is nothing to restart and nothing to turn off.
    expect(allButtons(container).map((node) => node.dataset.serviceAction)).toEqual(["install"]);
    expect(button(container, "install").textContent).toBe(en["settings.service.action.turnOn"]);
  });

  it("shows the login promise and the pid for a running, enabled service", async () => {
    show({ state: "running", enabled: true, pid: 4242, detail: "pid = 4242\nstate = running" });
    expect(await screen.findByText(en["settings.service.state.running.title"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.state.running.atLogin"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.pid"].replace("{pid}", "4242"))).toBeTruthy();
    // The running state's `detail` is `launchctl print`'s whole dump — not something to put on the row.
    expect(screen.queryByTestId("service-detail")).toBeNull();
  });

  it("does not promise a login restart the supervisor did not confirm", async () => {
    show({ state: "running", enabled: false, detail: "" });
    expect(await screen.findByText(en["settings.service.state.running.title"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.state.running.notAtLogin"])).toBeTruthy();
    expect(screen.queryByText(en["settings.service.state.running.atLogin"])).toBeNull();
  });

  it("offers no buttons at all where this system has no service manager", async () => {
    const { container } = show({ state: "unsupported", detail: "this build cannot install a service on linux" });
    expect(await screen.findByText(en["settings.service.state.unsupported.title"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.state.unsupported.detail"])).toBeTruthy();
    // **The dead switch this test exists for:** an on/off pair on a machine where neither can work.
    expect(allButtons(container)).toEqual([]);
  });

  it("shows the supervisor's own words last when the service failed", async () => {
    const { container } = show({ state: "failed", enabled: true, detail: "start-limit hit, giving up" });
    expect(await screen.findByText(en["settings.service.state.failed.title"])).toBeTruthy();
    const detail = await screen.findByTestId("service-detail");
    expect(detail.textContent).toBe("start-limit hit, giving up");
    // Try again is the install press; Turn off is still the way out.
    expect(allButtons(container).map((node) => node.dataset.serviceAction)).toEqual(["install", "uninstall"]);
    expect(button(container, "install").textContent).toBe(en["settings.service.action.tryAgain"]);
  });

  it("offers only a refresh when the state could not be read", async () => {
    const { container } = show({ state: "unknown", detail: "unrecognised output" });
    expect(await screen.findByText(en["settings.service.state.unknown.title"])).toBeTruthy();
    expect(allButtons(container).map((node) => node.dataset.serviceAction)).toEqual(["refresh"]);
    // An answer we could not read is exactly the case the supervisor's words are for.
    expect((await screen.findByTestId("service-detail")).textContent).toBe("unrecognised output");
  });
});

describe("what the presses do", () => {
  it("calls the call the button names, and adopts the status it returns", async () => {
    const installed: DaemonServiceStatus = { state: "running", enabled: true, pid: 7, detail: "" };
    const installService = vi.fn(async () => ({ ok: true as const, service: installed }));
    const { container } = show({ state: "not-installed", detail: "" }, { installService });
    await ready(container);

    fireEvent.click(button(container, "install"));
    expect(installService).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button(container, "install").disabled).toBe(false));
  });

  it("disables every press while one is in flight, so the supervisor is not asked twice", async () => {
    // **The mutation this fails on:** leaving the buttons live during a call. Installing a service is a
    // sequence of supervisor commands; a second press issued inside the first would run them concurrently.
    let settle: (answer: { ok: true; service: DaemonServiceStatus }) => void = () => {};
    const installService = vi.fn(
      () =>
        new Promise<{ ok: true; service: DaemonServiceStatus }>((resolve) => {
          settle = resolve;
        }),
    );
    const { container } = show({ state: "not-installed", detail: "" }, { installService });
    await ready(container);

    fireEvent.click(button(container, "install"));
    const pressed = button(container, "install");
    expect(pressed.disabled).toBe(true);
    expect(pressed.textContent).toBe(en["settings.service.busy"]);
    // A second click on a disabled button is not a second call.
    fireEvent.click(pressed);
    expect(installService).toHaveBeenCalledTimes(1);

    settle({ ok: true, service: { state: "running", enabled: true, detail: "" } });
    await waitFor(() => expect(button(container, "install").disabled).toBe(false));
  });

  it("renders a refusal under the row rather than in the window's top bar", async () => {
    // The store raises nothing for a refused write (`CoderStore.mutate`), so the row is the only place the
    // sentence can appear — and a service press is exactly the kind of call the OS is allowed to refuse.
    const installService = vi.fn(async () => ({
      ok: false as const,
      message: "launchctl bootstrap failed (exit 1): Bootstrap failed: 5",
    }));
    const { container } = show({ state: "not-installed", detail: "" }, { installService });
    await ready(container);

    fireEvent.click(button(container, "install"));
    await waitFor(() =>
      expect(container.querySelector(".setting__failure")?.textContent).toContain(
        "launchctl bootstrap failed",
      ),
    );
    // The row is still the row: the off state's press is enabled again for another attempt.
    await waitFor(() => expect(button(container, "install").disabled).toBe(false));
  });
});

describe("the row as a row", () => {
  it("is the registered section, with the pane's title and the shared two bands", async () => {
    // The section registry, the pane's `switch` and the row component are three places this control has to
    // agree; rendering the scope the bar item opens is what proves they do.
    const { container } = show({ state: "not-installed", detail: "" });
    expect(await screen.findByRole("heading", { name: en["settings.section.service.title"] })).toBeTruthy();
    const row = container.querySelector(".setting");
    if (!(row instanceof HTMLElement)) throw new Error("the service row is not a .setting");
    expect(within(row).getByText(en["settings.service.title"])).toBeTruthy();
    expect(within(row).getByText(en["settings.service.detail"])).toBeTruthy();
  });
});
