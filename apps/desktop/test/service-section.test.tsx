/**
 * The Background service row, rendered — which state it shows, what its diagnostics say, and what its presses do.
 *
 * ## Why this file exists next to `service-state.test.ts`
 *
 * That test proves the *projection*: the six states, the login gate, the buttons each state allows, and the
 * evidence rules. This one proves the row is actually wired to it: the words reach the DOM, the press calls the
 * call it names, the diagnostic band is on screen only where it has something to say, and **a press in flight
 * disables every button** so a supervisor cannot be asked twice for the same change.
 *
 * Stop gets its own cases because its answer is not a status. `coder.shutdown` is acknowledged and then the
 * daemon drains for up to ten seconds; a re-read inside that window legitimately succeeds and says "running",
 * so the row renders the stopped state from the **accepted answer** instead — the one place this control could
 * turn "it did what you asked" into a lie about the machine.
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

/** A status with the fields every case does not vary spelled out, so each case varies only what it tests. */
function service(over: Partial<DaemonServiceStatus> & Pick<DaemonServiceStatus, "state">): DaemonServiceStatus {
  return { detail: "", restartsInLastHour: 0, ...over };
}

function stateWith(status: DaemonServiceStatus | undefined): CoderState {
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
    ...(status !== undefined ? { service: status } : {}),
  };
}

/** The pane at the service scope, with the daemon calls a test cares about wired. */
function show(status: DaemonServiceStatus | undefined, overrides: Partial<AgentActions> = {}) {
  const agents = stubAgentActions({
    // The page's own load, which every case here needs to settle rather than refuse — otherwise the row is
    // rendering "could not tell" and the assertions below would be about a different state.
    getServiceStatus: vi.fn(async () => ({
      ok: true as const,
      service: status ?? service({ state: "unknown" }),
    })),
    ...overrides,
  });
  const { container } = render(
    <I18nProvider preference="en">
      <SettingsPane
        state={stateWith(status)}
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

/** The diagnostic band's text, `""` when the band is not rendered at all. */
const diagnostics = (container: HTMLElement): string =>
  container.querySelector('[data-testid="service-detail"]')?.textContent ?? "";

describe("what the row shows", () => {
  it("renders the off state with the price of being off and the one press that changes it", async () => {
    const { container } = show(service({ state: "not-installed", detail: "Could not find service" }));
    // The supervisor's "not found" words are a status report, not a diagnosis — they are not on the row.
    expect(diagnostics(container)).toBe("");
    expect(await screen.findByText(en["settings.service.state.notInstalled.title"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.state.notInstalled.detail"])).toBeTruthy();
    // Only the on press: there is nothing to restart and nothing to turn off.
    expect(allButtons(container).map((node) => node.dataset.serviceAction)).toEqual(["install"]);
    expect(button(container, "install").textContent).toBe(en["settings.service.action.turnOn"]);
  });

  it("shows the login promise and the pid for a running, enabled service", async () => {
    const { container } = show(
      service({ state: "running", enabled: true, pid: 4242, detail: "pid = 4242\nstate = running" }),
    );
    expect(await screen.findByText(en["settings.service.state.running.title"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.state.running.atLogin"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.pid"].replace("{pid}", "4242"))).toBeTruthy();
    // The running state's `detail` is `launchctl print`'s whole dump — not something to put on the row.
    expect(diagnostics(container)).toBe("");
  });

  it("does not promise a login restart the supervisor did not confirm", async () => {
    show(service({ state: "running", enabled: false }));
    expect(await screen.findByText(en["settings.service.state.running.title"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.state.running.notAtLogin"])).toBeTruthy();
    expect(screen.queryByText(en["settings.service.state.running.atLogin"])).toBeNull();
  });

  it("offers no buttons at all where this system has no service manager", async () => {
    const { container } = show(
      service({ state: "unsupported", detail: "this build cannot install a service on linux" }),
    );
    expect(await screen.findByText(en["settings.service.state.unsupported.title"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.state.unsupported.detail"])).toBeTruthy();
    // **The dead switch this test exists for:** an on/off pair on a machine where neither can work.
    expect(allButtons(container)).toEqual([]);
  });

  it("shows the supervisor's own words last when the service failed", async () => {
    const { container } = show(service({ state: "failed", enabled: true, detail: "start-limit hit, giving up" }));
    expect(await screen.findByText(en["settings.service.state.failed.title"])).toBeTruthy();
    expect(diagnostics(container)).toBe("start-limit hit, giving up");
    // Try again is the install press; Turn off is still the way out — and no Stop, because a failed service is
    // not something to ask to exit.
    expect(allButtons(container).map((node) => node.dataset.serviceAction)).toEqual(["install", "uninstall"]);
    expect(button(container, "install").textContent).toBe(en["settings.service.action.tryAgain"]);
  });

  it("offers only a refresh when the state could not be read", async () => {
    const { container } = show(service({ state: "unknown", detail: "unrecognised output" }));
    expect(await screen.findByText(en["settings.service.state.unknown.title"])).toBeTruthy();
    expect(allButtons(container).map((node) => node.dataset.serviceAction)).toEqual(["refresh"]);
    // An answer we could not read is exactly the case the supervisor's words are for.
    expect(diagnostics(container)).toBe("unrecognised output");
  });
});

describe("the diagnostic band", () => {
  it("shows the restart count as evidence, and calls an unexplained restart a crash", async () => {
    // **The mutation this fails on:** dropping the daemon's own history from the row — the number is the whole
    // reason a crash loop is visible, and the missing stop record is the sentence that explains it.
    const { container } = show(service({ state: "running", enabled: true, restartsInLastHour: 3 }));
    expect(await screen.findByText(en["settings.service.restarts.many"].replace("{count}", "3"))).toBeTruthy();
    expect(screen.getByText(en["settings.service.lastStop.crash"])).toBeTruthy();
  });

  it("names a deliberate stop in the daemon's own vocabulary, formatted for the reader", async () => {
    const { container } = show(
      service({
        state: "installed-stopped",
        enabled: true,
        restartsInLastHour: 1,
        lastStop: { at: "2026-09-14T05:23:00.000Z", signal: "requested over the connection" },
      }),
    );
    expect(await screen.findByText(en["settings.service.restarts.one"])).toBeTruthy();
    // The `{when}` is rendered by `Intl`, so the assertion is on the stable half of the sentence.
    expect(diagnostics(container)).toContain("Last stop: you asked for it over the connection");
    // A recorded stop means the crash sentence must not appear.
    expect(screen.queryByText(en["settings.service.lastStop.crash"])).toBeNull();
  });

  it("says nothing at all when the history explains nothing", async () => {
    // 0 restarts and no recorded stop is a healthy daemon: the band is absent rather than a row of zeros.
    const { container } = show(service({ state: "running", enabled: true }));
    expect(await screen.findByText(en["settings.service.state.running.title"])).toBeTruthy();
    expect(diagnostics(container)).toBe("");
  });
});

describe("Stop, beside Restart and Turn off", () => {
  it("is offered on a running service and says how it differs from Turn off", async () => {
    const { container } = show(service({ state: "running", enabled: true }));
    await screen.findByText(en["settings.service.state.running.title"]);
    expect(allButtons(container).map((node) => node.dataset.serviceAction)).toEqual([
      "restart",
      "stop",
      "uninstall",
    ]);
    expect(button(container, "stop").textContent).toBe(en["settings.service.action.stop"]);
    // Both endings are on the row, and the sentence that tells them apart is visible without hovering.
    expect(screen.getByText(en["settings.service.stopVsOff"])).toBeTruthy();
    expect(button(container, "stop").title).toBe(en["settings.service.action.stop.title"]);
    expect(button(container, "uninstall").title).toBe(en["settings.service.action.turnOff.title"]);
  });

  it("renders the stopped state from the accepted answer, even when a re-read would still report it running", async () => {
    // **The mutation this fails on:** re-reading the status after `coder.shutdown`. The daemon answers before it
    // drains, so for up to ten seconds a real read *succeeds* and honestly says "running" — which restored the
    // running row for a service the user had just stopped. The acknowledgement is the state; a later visit to
    // the page is what corrects it if the daemon really is still there.
    const runningNow = service({ state: "running", enabled: true, pid: 9 });
    const shutdown = vi.fn(async () => ({ ok: true as const, stopping: true as const }));
    // Deliberately the *success* case: the read the old code depended on, answering with the truth it saw.
    const getServiceStatus = vi.fn(async () => ({ ok: true as const, service: runningNow }));
    const { container } = show(runningNow, { shutdown, getServiceStatus });
    await ready(container);

    fireEvent.click(button(container, "stop"));
    await waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(en["settings.service.state.installedStopped.title"])).toBeTruthy();
    expect(screen.getByText(en["settings.service.state.installedStopped.atLogin"])).toBeTruthy();
    // The page's own load is the only status read: a stop does not ask a second time.
    expect(getServiceStatus).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".setting__failure")).toBeNull();
  });

  it("keeps the refusal on the row when the daemon will not take the stop", async () => {
    const shutdown = vi.fn(async () => ({ ok: false as const, message: "envoydev.owner-window-only: refused" }));
    const getServiceStatus = vi.fn(async () => ({ ok: true as const, service: service({ state: "running" }) }));
    const { container } = show(service({ state: "running", enabled: true }), { shutdown, getServiceStatus });
    await ready(container);

    fireEvent.click(button(container, "stop"));
    await waitFor(() => expect(container.querySelector(".setting__failure")?.textContent).toContain("refused"));
    // No re-read is attempted when the press itself was refused, and the row is usable again.
    expect(getServiceStatus).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button(container, "stop").disabled).toBe(false));
  });
});

describe("what the presses do", () => {
  it("calls the call the button names, and re-enables the row when the answer lands", async () => {
    // Adoption — the returned status becoming `state.service` — is asserted at its own seam in
    // `service-store.test.ts`; here the subject is the wiring: the button reaches the call it names, and the
    // busy slot clears so the row is usable again.
    const installed = service({ state: "running", enabled: true, pid: 7 });
    const installService = vi.fn(async () => ({ ok: true as const, service: installed }));
    const { container } = show(service({ state: "not-installed" }), { installService });
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
    const { container } = show(service({ state: "not-installed" }), { installService });
    await ready(container);

    fireEvent.click(button(container, "install"));
    const pressed = button(container, "install");
    expect(pressed.disabled).toBe(true);
    expect(pressed.textContent).toBe(en["settings.service.busy"]);
    // A second click on a disabled button is not a second call.
    fireEvent.click(pressed);
    expect(installService).toHaveBeenCalledTimes(1);

    settle({ ok: true, service: service({ state: "running", enabled: true }) });
    await waitFor(() => expect(button(container, "install").disabled).toBe(false));
  });

  it("renders a refusal under the row rather than in the window's top bar", async () => {
    // The store raises nothing for a refused write (`CoderStore.mutate`), so the row is the only place the
    // sentence can appear — and a service press is exactly the kind of call the OS is allowed to refuse.
    const installService = vi.fn(async () => ({
      ok: false as const,
      message: "launchctl bootstrap failed (exit 1): Bootstrap failed: 5",
    }));
    const { container } = show(service({ state: "not-installed" }), { installService });
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
    const { container } = show(service({ state: "not-installed" }));
    expect(await screen.findByRole("heading", { name: en["settings.section.service.title"] })).toBeTruthy();
    const row = container.querySelector(".setting");
    if (!(row instanceof HTMLElement)) throw new Error("the service row is not a .setting");
    expect(within(row).getByText(en["settings.service.title"])).toBeTruthy();
    expect(within(row).getByText(en["settings.service.detail"])).toBeTruthy();
  });
});
