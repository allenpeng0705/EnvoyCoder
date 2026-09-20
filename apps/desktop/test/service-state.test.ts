/**
 * The Background service row's words and buttons, proved without a DOM.
 *
 * ## Why this file exists next to a component test
 *
 * The row renders one of six measured states, and three of the properties that matter are properties of the
 * **projection**, not of the JSX: that every state on the wire has a headline of its own, that the sentence
 * promising the service comes back at login is used only when the supervisor said `enabled`, and that the
 * supervisor's own `detail` is shown only where it is a diagnosis. Those are cheap to assert here, and the
 * mutation that breaks each is named below.
 *
 * ## The two claims this product must not make, and the cases that hold them
 *
 *   * **"Runs at boot."** The unit is a per-user agent that starts at *login* (`docs/daemon-lifecycle.md` §6),
 *     so no string under `settings.service*` says "boot", and the at-login sentence is gated on `enabled`.
 *     The mutation this fails on: choosing `running.atLogin` for an absent `enabled`, or adding a sentence
 *     that advertises a boot-time service.
 *   * **"The phone can reach this machine" while nothing is installed.** The off state says the window has to
 *     be open, in its own words; the mutation is reusing the running state's sentence there.
 */

import { describe, expect, it } from "vitest";

import type { DaemonServiceStatus } from "@envoydev/protocol";

import { en, type MessageKey } from "../src/i18n/messages/en.js";
import { serviceCopy, type ServiceActionId, type ServiceState } from "../src/components/settings/service-state.js";

/** Every state the wire can send, in the order the protocol declares them. */
const STATES: readonly ServiceState[] = [
  "not-installed",
  "installed-stopped",
  "running",
  "failed",
  "unsupported",
  "unknown",
];

const status = (state: ServiceState, over: Partial<DaemonServiceStatus> = {}): DaemonServiceStatus => ({
  state,
  detail: "",
  ...over,
});

const ids = (state: ServiceState, over: Partial<DaemonServiceStatus> = {}): ServiceActionId[] =>
  serviceCopy(status(state, over)).actions.map((action) => action.id);

describe("one state, one headline — and never a seventh", () => {
  it("gives each of the wire's six states words of its own", () => {
    // **The mutation this fails on:** a `switch` without a default whose arm for one state falls through to
    // another state's sentence — two states reading as the same thing, which is the defect the whole
    // vocabulary exists to prevent. The sentence is asserted beside the headline because a missing arm in the
    // sentence lookup has exactly that shape: `not-installed` once fell through to `unknown`'s sentence in
    // this file, and a check that only read headlines stayed green.
    const headlines = STATES.map((state) => serviceCopy(status(state)).headlineKey);
    expect(new Set(headlines).size).toBe(STATES.length);
    const sentences = STATES.map((state) => serviceCopy(status(state)).sentenceKey);
    expect(new Set(sentences).size).toBe(STATES.length);
  });

  it("renders 'we have not asked yet' as the state for 'we could not tell'", () => {
    // `undefined` is an absent answer, not an off service. Inventing a seventh word for it would put a state
    // on screen the wire never sends, so it borrows the unknown state's words and offers the same retry.
    const absent = serviceCopy(undefined);
    const unknown = serviceCopy(status("unknown"));
    expect(absent.headlineKey).toBe(unknown.headlineKey);
    expect(absent.sentenceKey).toBe(unknown.sentenceKey);
    expect(absent.actions.map((action) => action.id)).toEqual(["refresh"]);
    // Nothing to diagnose yet, so no diagnostic line either.
    expect(absent.showDetail).toBe(false);
  });
});

describe("the login promise", () => {
  it("is made only when the supervisor said the service is enabled", () => {
    // **The mutation this fails on:** using the at-login sentence whenever the state is running — which is how
    // a machine with `enabled: false` gets told it will come back and does not.
    expect(serviceCopy(status("running", { enabled: true })).sentenceKey).toBe(
      "settings.service.state.running.atLogin",
    );
    expect(serviceCopy(status("running", { enabled: false })).sentenceKey).toBe(
      "settings.service.state.running.notAtLogin",
    );
    expect(serviceCopy(status("running")).sentenceKey).toBe("settings.service.state.running.plain");

    expect(serviceCopy(status("installed-stopped", { enabled: true })).sentenceKey).toBe(
      "settings.service.state.installedStopped.atLogin",
    );
    expect(serviceCopy(status("installed-stopped", { enabled: false })).sentenceKey).toBe(
      "settings.service.state.installedStopped.notAtLogin",
    );
    expect(serviceCopy(status("installed-stopped")).sentenceKey).toBe(
      "settings.service.state.installedStopped.plain",
    );
  });

  it("never says the service runs at boot, in any string the row can render", () => {
    // **The mutation this fails on:** a sentence promising a boot-time service. The wire never says that; the
    // unit is a per-user agent that starts at login, and `docs/daemon-lifecycle.md` §6 is why.
    const serviceKeys = (Object.keys(en) as MessageKey[]).filter(
      (key) => key.startsWith("settings.service") || key.startsWith("settings.section.service"),
    );
    expect(serviceKeys.length).toBeGreaterThan(10);
    for (const key of serviceKeys) {
      expect(en[key], key).not.toMatch(/\bboot(ed|ing|s)?\b/i);
    }
  });

  it("says what the off state costs, in the off state's own words", () => {
    // "Off" must not be a switch a user reads as harmless: with nothing installed the phone only reaches the
    // machine while the window is open, and that is the sentence the copy has to carry.
    expect(en["settings.service.state.notInstalled.detail"]).toMatch(/window is open/i);
    // …and the unsupported state says the app still works rather than that the feature is broken.
    expect(en["settings.service.state.unsupported.detail"]).toMatch(/still works/i);
  });
});

describe("the presses a state allows", () => {
  it("offers only what the state can honestly do", () => {
    // **The mutation this fails on:** rendering the same on/off pair for every state — the dead switch this
    // pane was rebuilt to remove. `unsupported` in particular must offer nothing at all.
    expect(ids("not-installed")).toEqual(["install"]);
    expect(ids("running")).toEqual(["restart", "uninstall"]);
    expect(ids("installed-stopped")).toEqual(["restart", "uninstall"]);
    expect(ids("failed")).toEqual(["install", "uninstall"]);
    expect(ids("unsupported")).toEqual([]);
    expect(ids("unknown")).toEqual(["refresh"]);
  });

  it("names the same press by what it is here: Turn on from off, Try again from a failure", () => {
    // One action id, two labels, because "turn it on" and "try again" are the same idempotent install press
    // but not the same sentence.
    expect(serviceCopy(status("not-installed")).actions[0]?.labelKey).toBe(
      "settings.service.action.turnOn",
    );
    expect(serviceCopy(status("failed")).actions[0]?.labelKey).toBe(
      "settings.service.action.tryAgain",
    );
  });
});

describe("the supervisor's own words", () => {
  it("are shown only where they are a diagnosis, and never for a running service", () => {
    // **The mutation this fails on:** rendering `detail` for every state. For a running service `detail` is
    // the supervisor's whole definition dump (`launchctl print`), which is a status report rather than a
    // diagnosis and has no business on a settings row.
    expect(serviceCopy(status("failed", { detail: "start-limit hit" })).showDetail).toBe(true);
    expect(serviceCopy(status("unknown", { detail: "unrecognised output" })).showDetail).toBe(true);
    expect(serviceCopy(status("running", { detail: "pid = 42\nstate = running" })).showDetail).toBe(false);
    expect(serviceCopy(status("installed-stopped", { detail: "state = waiting" })).showDetail).toBe(false);
    expect(serviceCopy(status("not-installed", { detail: "Could not find service" })).showDetail).toBe(false);
    expect(serviceCopy(status("unsupported", { detail: "no service manager" })).showDetail).toBe(false);
  });

  it("carries the pid only where a process exists to name", () => {
    // The pid belongs to the running state; the parser only sets it there (and on a failed systemd unit,
    // which is not a process a user should be told to look for).
    expect(serviceCopy(status("running", { pid: 4242 })).values).toEqual({ pid: 4242 });
    expect(serviceCopy(status("running")).values).toBeUndefined();
    expect(serviceCopy(status("installed-stopped", { pid: 1 })).values).toBeUndefined();
  });
});
