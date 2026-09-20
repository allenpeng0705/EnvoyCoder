/**
 * The Background service row's words, buttons and diagnostics, proved without a DOM.
 *
 * ## Why this file exists next to a component test
 *
 * The row renders one of six measured states, and the properties that matter are properties of the
 * **projection**, not of the JSX: that every state on the wire has words of its own, that the sentence
 * promising the service comes back at login is used only when the supervisor said `enabled`, that Stop and
 * Turn off are different presses, and that the daemon's own history is turned into evidence only when it
 * explains something. Those are cheap to assert here, and the mutation that breaks each is named below.
 *
 * ## The three claims this product must not make, and the cases that hold them
 *
 *   * **"Runs at boot."** The unit is a per-user agent that starts at *login* (`docs/daemon-lifecycle.md` §6),
 *     so no string under `settings.service*` says "boot", and the at-login sentence is gated on `enabled`.
 *     The mutation this fails on: choosing `running.atLogin` for an absent `enabled`, or adding a sentence
 *     that advertises a boot-time service.
 *   * **"The phone can reach this machine" while nothing is installed.** The off state says the window has to
 *     be open, in its own words; the mutation is reusing the running state's sentence there.
 *   * **"0 restarts" and "a clean history" are the same thing.** They are not evidence of anything, so the
 *     diagnostic band stays empty for both; the mutation is always rendering the count, or rendering "no stop
 *     record" when nothing restarted.
 */

import { describe, expect, it } from "vitest";

import type { DaemonServiceStatus } from "@envoydev/protocol";

import { en, type MessageKey } from "../src/i18n/messages/en.js";
import {
  serviceCopy,
  serviceEvidence,
  type ServiceActionId,
  type ServiceState,
} from "../src/components/settings/service-state.js";

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
  restartsInLastHour: 0,
  ...over,
});

const copyOf = (state: ServiceState, over: Partial<DaemonServiceStatus> = {}) =>
  serviceCopy(status(state, over));

const ids = (state: ServiceState, over: Partial<DaemonServiceStatus> = {}): ServiceActionId[] =>
  copyOf(state, over).actions.map((action) => action.id);

/** A `formatWhen` the test controls, so an assertion can name the timestamp without depending on `Intl`. */
const FORMATTED = (at: string): string => `formatted(${at})`;

const evidenceOf = (state: ServiceState, over: Partial<DaemonServiceStatus> = {}) =>
  serviceEvidence(status(state, over), FORMATTED);

const actionOf = (state: ServiceState, id: ServiceActionId, over: Partial<DaemonServiceStatus> = {}) =>
  copyOf(state, over).actions.find((action) => action.id === id);

describe("one state, one headline — and never a seventh", () => {
  it("gives each of the wire's six states words of its own", () => {
    // **The mutation this fails on:** a `switch` without a default whose arm for one state falls through to
    // another state's sentence — two states reading as the same thing, which is the defect the whole
    // vocabulary exists to prevent. The sentence is asserted beside the headline because a missing arm in the
    // sentence lookup has exactly that shape: `not-installed` once fell through to `unknown`'s sentence in
    // this file, and a check that only read headlines stayed green.
    const headlines = STATES.map((state) => copyOf(state).headlineKey);
    expect(new Set(headlines).size).toBe(STATES.length);
    const sentences = STATES.map((state) => copyOf(state).sentenceKey);
    expect(new Set(sentences).size).toBe(STATES.length);
  });

  it("renders 'we have not asked yet' as the state for 'we could not tell'", () => {
    // `undefined` is an absent answer, not an off service. Inventing a seventh word for it would put a state
    // on screen the wire never sends, so it borrows the unknown state's words and offers the same retry.
    const absent = serviceCopy(undefined);
    const unknown = copyOf("unknown");
    expect(absent.headlineKey).toBe(unknown.headlineKey);
    expect(absent.sentenceKey).toBe(unknown.sentenceKey);
    expect(absent.actions.map((action) => action.id)).toEqual(["refresh"]);
    // Nothing to diagnose yet, so no diagnostic line either.
    expect(serviceEvidence(undefined, FORMATTED)).toEqual({ supervisorDetail: false });
  });
});

describe("the login promise", () => {
  it("is made only when the supervisor said the service is enabled", () => {
    // **The mutation this fails on:** using the at-login sentence whenever the state is running — which is how
    // a machine with `enabled: false` gets told it will come back and does not.
    expect(copyOf("running", { enabled: true }).sentenceKey).toBe("settings.service.state.running.atLogin");
    expect(copyOf("running", { enabled: false }).sentenceKey).toBe("settings.service.state.running.notAtLogin");
    expect(copyOf("running").sentenceKey).toBe("settings.service.state.running.plain");

    expect(copyOf("installed-stopped", { enabled: true }).sentenceKey).toBe(
      "settings.service.state.installedStopped.atLogin",
    );
    expect(copyOf("installed-stopped", { enabled: false }).sentenceKey).toBe(
      "settings.service.state.installedStopped.notAtLogin",
    );
    expect(copyOf("installed-stopped").sentenceKey).toBe(
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
    expect(ids("running")).toEqual(["restart", "stop", "uninstall"]);
    expect(ids("installed-stopped")).toEqual(["restart", "stop", "uninstall"]);
    // A service the supervisor reported as failed is not something to ask to exit: no Stop there.
    expect(ids("failed")).toEqual(["install", "uninstall"]);
    expect(ids("unsupported")).toEqual([]);
    expect(ids("unknown")).toEqual(["refresh"]);
  });

  it("names the same press by what it is here: Turn on from off, Try again from a failure", () => {
    // One action id, two labels, because "turn it on" and "try again" are the same idempotent install press
    // but not the same sentence.
    expect(actionOf("not-installed", "install")?.labelKey).toBe("settings.service.action.turnOn");
    expect(actionOf("failed", "install")?.labelKey).toBe("settings.service.action.tryAgain");
  });

  it("tells Stop and Turn off apart, and gates Stop's login promise exactly as the sentence is", () => {
    // **The two mutations this fails on:** giving both buttons the same tooltip — which is how a user removes a
    // service they only meant to stop for now — and promising the login return in Stop's tooltip on a machine
    // the supervisor said is `enabled: false`, which would contradict the sentence right above the buttons.
    const off = actionOf("running", "uninstall");
    expect(actionOf("running", "stop")?.labelKey).toBe("settings.service.action.stop");
    expect(off?.labelKey).toBe("settings.service.action.turnOff");
    expect(off?.titleKey).toBe("settings.service.action.turnOff.title");
    expect(en[off!.titleKey!]).toMatch(/remove/i);

    // Three tooltips, chosen by the same `enabled` the sentence is: promise, deny, claim nothing.
    expect(actionOf("running", "stop", { enabled: true })?.titleKey).toBe(
      "settings.service.action.stop.title",
    );
    expect(actionOf("running", "stop", { enabled: false })?.titleKey).toBe(
      "settings.service.action.stop.title.notAtLogin",
    );
    expect(actionOf("running", "stop")?.titleKey).toBe("settings.service.action.stop.title.plain");
    expect(en["settings.service.action.stop.title"]).toMatch(/login/i);
    expect(en["settings.service.action.stop.title.notAtLogin"]).toMatch(/not set to start/i);
    expect(en["settings.service.action.stop.title.plain"]).not.toMatch(/login/i);

    // …and the row's own sentence names both labels, so the difference is visible without hovering.
    expect(en["settings.service.stopVsOff"]).toContain(en["settings.service.action.stop"]);
    expect(en["settings.service.stopVsOff"]).toContain(en["settings.service.action.turnOff"]);
  });
});

describe("the daemon's own history, as evidence", () => {
  it("says nothing at all when nothing has restarted", () => {
    // **The mutation this fails on:** rendering "Restarted 0 times". A zero is not evidence of a problem, and
    // a row that reports one teaches a user to ignore the line that matters.
    expect(evidenceOf("running", { restartsInLastHour: 0 }).restarts).toBeUndefined();
    expect(evidenceOf("running").restarts).toBeUndefined();
  });

  it("counts restarts in the last hour, with a sentence that reads for one", () => {
    expect(evidenceOf("running", { restartsInLastHour: 1 }).restarts).toEqual({
      key: "settings.service.restarts.one",
      values: { count: 1 },
    });
    expect(evidenceOf("running", { restartsInLastHour: 3 }).restarts).toEqual({
      key: "settings.service.restarts.many",
      values: { count: 3 },
    });
    // The evidence is shown whatever the state, because a crash loop and a clean stop are not exclusive.
    expect(evidenceOf("installed-stopped", { restartsInLastHour: 2 }).restarts?.key).toBe(
      "settings.service.restarts.many",
    );
  });

  it("names a recorded stop, in the daemon's own vocabulary and the reader's own time", () => {
    const at = "2026-09-14T05:23:00.000Z";
    const when = FORMATTED(at);
    expect(evidenceOf("running", { lastStop: { at, signal: "requested over the connection" } }).lastStop).toEqual({
      key: "settings.service.lastStop.requested",
      values: { when },
    });
    expect(evidenceOf("running", { lastStop: { at, signal: "refused" } }).lastStop).toEqual({
      key: "settings.service.lastStop.refused",
      values: { when },
    });
    expect(evidenceOf("running", { lastStop: { at, signal: "failed to serve" } }).lastStop).toEqual({
      key: "settings.service.lastStop.failed",
      values: { when },
    });
    expect(evidenceOf("running", { lastStop: { at, signal: "SIGTERM" } }).lastStop).toEqual({
      key: "settings.service.lastStop.signal",
      values: { signal: "SIGTERM", when },
    });
    // A controlled exit carries its code; a signal does not.
    expect(evidenceOf("running", { lastStop: { at, signal: "SIGTERM", exitCode: 4 } }).lastStop).toEqual({
      key: "settings.service.lastStop.signalExit",
      values: { signal: "SIGTERM", code: 4, when },
    });
  });

  it("calls an unexplained restart what it is — a crash — and only when something restarted", () => {
    // **The mutation this fails on:** staying silent when a stopped daemon restarted with no stop record. A
    // deliberate stop always leaves one (`recordStop`), so the absence *is* the diagnosis, and it is the one
    // line a person whose daemon keeps disappearing needs.
    expect(evidenceOf("running", { restartsInLastHour: 2 }).lastStop).toEqual({
      key: "settings.service.lastStop.crash",
      values: {},
    });
    // The other half: with no restarts to explain, the same absence says nothing at all.
    expect(evidenceOf("running", { restartsInLastHour: 0 }).lastStop).toBeUndefined();
    // And a recorded stop wins over the inference — we do not call it a crash when the ledger says otherwise.
    expect(
      evidenceOf("running", {
        restartsInLastHour: 3,
        lastStop: { at: "2026-09-14T05:23:00.000Z", signal: "SIGTERM" },
      }).lastStop?.key,
    ).toBe("settings.service.lastStop.signal");
  });
});

describe("the supervisor's own words", () => {
  it("are shown only where they are a diagnosis, and never for a running service", () => {
    // **The mutation this fails on:** rendering `detail` for every state. For a running service `detail` is
    // the supervisor's whole definition dump (`launchctl print`), which is a status report rather than a
    // diagnosis and has no business on a settings row.
    expect(evidenceOf("failed", { detail: "start-limit hit" }).supervisorDetail).toBe(true);
    expect(evidenceOf("unknown", { detail: "unrecognised output" }).supervisorDetail).toBe(true);
    expect(evidenceOf("running", { detail: "pid = 42\nstate = running" }).supervisorDetail).toBe(false);
    expect(evidenceOf("installed-stopped", { detail: "state = waiting" }).supervisorDetail).toBe(false);
    expect(evidenceOf("not-installed", { detail: "Could not find service" }).supervisorDetail).toBe(false);
    expect(evidenceOf("unsupported", { detail: "no service manager" }).supervisorDetail).toBe(false);
  });

  it("carries the pid only where a process exists to name", () => {
    // The pid belongs to the running state; the parser only sets it there (and on a failed systemd unit,
    // which is not a process a user should be told to look for).
    expect(copyOf("running", { pid: 4242 }).values).toEqual({ pid: 4242 });
    expect(copyOf("running").values).toBeUndefined();
    expect(copyOf("installed-stopped", { pid: 1 }).values).toBeUndefined();
  });
});
