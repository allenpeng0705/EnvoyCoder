/**
 * What the Background service row **says** and **offers**, as one pure function of the wire's own status.
 *
 * ## Why this is a module and not a `switch` inside the row
 *
 * The state comes from `coder.getServiceStatus` and it is a closed six-word vocabulary
 * (`DaemonServiceStatus["state"]`, restated by the daemon from `@envoydev/platform`'s `ServiceStatus`). Two
 * of those states carry a second axis — `enabled`, which is the only thing the wire says about whether the
 * service comes back, and which is *absent* on platforms that do not report it — and one carries an optional
 * pid. If the mapping from wire to words lived inside JSX, the sentence and the buttons could disagree about
 * which state the row is in, and there would be no place to assert that every state has *some* words of its
 * own. Here the whole projection is a table with a `satisfies` on it: a state without an entry is a compile
 * error, and a seventh state cannot be invented without inventing it on the wire first.
 *
 * ## The two rules the table is built to keep
 *
 *   * **The login promise is gated on `enabled`, and "boot" is never said.** The service starts **at login**
 *     (the unit is a launchd LaunchAgent, a systemd *user* unit, a per-user scheduled task — see
 *     `docs/daemon-lifecycle.md` §6), and a machine with `enabled: false` will *not* bring it back. So the
 *     at-login sentence is chosen from `enabled`, and an absent `enabled` gets the sentence that claims
 *     nothing rather than the flattering one. `test/service-state.test.ts` asserts exactly this, in English,
 *     against the catalogue.
 *   * **The supervisor's `detail` is diagnostic text, not our sentence.** It is the OS service manager's own
 *     output, it is not translated, and for a *running* service it is the supervisor's whole definition dump
 *     — so it is shown only for the two states where it is actually a diagnosis (`failed`, `unknown`) and
 *     never where it is a status report.
 *
 * @see docs/daemon-lifecycle.md §10 — the Settings control this is half of.
 * @see docs/settings-parity.md §7.6 — the row that records where the control lives.
 */

import type { DaemonServiceStatus } from "@envoydev/protocol";

import type { MessageKey } from "../../i18n/messages/en.js";

/** The closed state vocabulary, named once so the tables below can be total against it. */
export type ServiceState = DaemonServiceStatus["state"];

/**
 * The four presses a service row can offer.
 *
 * `install` is the "turn it on" press *and* the "try again" press: it is idempotent on every platform
 * (`launchd` boots the job out before bootstrapping it, systemd `enable --now`s an existing unit), and it is
 * the operation that asks the supervisor to have it running. `refresh` only asks again.
 */
export type ServiceActionId = "install" | "restart" | "uninstall" | "refresh";

export interface ServiceAction {
  readonly id: ServiceActionId;
  /** The button's own words. State-specific, so `install` reads *Turn on* from off and *Try again* from failed. */
  readonly labelKey: MessageKey;
}

export interface ServiceCopy {
  /** The state, as a headline: what a user reads first. */
  readonly headlineKey: MessageKey;
  /** One sentence under the headline. See the module doc for the two axes it is chosen from. */
  readonly sentenceKey: MessageKey;
  /** Interpolation values for `sentenceKey` — the pid, when the supervisor named one. */
  readonly values?: { readonly pid: number };
  /** The presses this state allows. Empty is a real answer: `unsupported` offers none. */
  readonly actions: readonly ServiceAction[];
  /** Render the supervisor's own `detail` last, as diagnostic text? See the module doc. */
  readonly showDetail: boolean;
}

const HEADLINES = {
  "not-installed": "settings.service.state.notInstalled.title",
  running: "settings.service.state.running.title",
  "installed-stopped": "settings.service.state.installedStopped.title",
  failed: "settings.service.state.failed.title",
  unsupported: "settings.service.state.unsupported.title",
  unknown: "settings.service.state.unknown.title",
} as const satisfies Record<ServiceState, MessageKey>;

/**
 * The sentence, with the two conditional states answered from `enabled`.
 *
 * Written as a function rather than a second table so the condition is visible at one site: `running` and
 * `installed-stopped` are the only states whose words depend on anything but the state itself.
 */
function sentenceKey(service: DaemonServiceStatus): MessageKey {
  if (service.state === "running") {
    return service.enabled === true
      ? "settings.service.state.running.atLogin"
      : service.enabled === false
        ? "settings.service.state.running.notAtLogin"
        : "settings.service.state.running.plain";
  }
  if (service.state === "installed-stopped") {
    return service.enabled === true
      ? "settings.service.state.installedStopped.atLogin"
      : service.enabled === false
        ? "settings.service.state.installedStopped.notAtLogin"
        : "settings.service.state.installedStopped.plain";
  }
  if (service.state === "failed") return "settings.service.state.failed.detail";
  if (service.state === "unsupported") return "settings.service.state.unsupported.detail";
  if (service.state === "not-installed") return "settings.service.state.notInstalled.detail";
  return "settings.service.state.unknown.detail";
}

const ACTIONS = {
  "not-installed": [{ id: "install", labelKey: "settings.service.action.turnOn" }],
  // A running service gets Restart and Turn off; an installed one that is not running gets the same two,
  // because Restart is also how a user starts it again — there is no separate "start" on the wire.
  running: [
    { id: "restart", labelKey: "settings.service.action.restart" },
    { id: "uninstall", labelKey: "settings.service.action.turnOff" },
  ],
  "installed-stopped": [
    { id: "restart", labelKey: "settings.service.action.restart" },
    { id: "uninstall", labelKey: "settings.service.action.turnOff" },
  ],
  // A failure offers the same on/off pair: *Try again* is `install`, which is idempotent and is the press
  // that asks the supervisor to have it running; *Turn off* is still the way out.
  failed: [
    { id: "install", labelKey: "settings.service.action.tryAgain" },
    { id: "uninstall", labelKey: "settings.service.action.turnOff" },
  ],
  // **No on/off buttons here, on purpose.** A switch that cannot be honoured is the defect this whole pane
  // was rebuilt to remove, and there is no supervisor to talk to on this system.
  unsupported: [],
  // We could not read the state, so the only honest press is to ask again.
  unknown: [{ id: "refresh", labelKey: "settings.service.action.refresh" }],
} as const satisfies Record<ServiceState, readonly ServiceAction[]>;

/**
 * The row's copy for a status — or for `undefined`, which is "this window has not asked yet".
 *
 * `undefined` renders as `unknown`: both mean *we cannot tell you what the service is doing*, and inventing a
 * seventh state for "we have not looked" would put a word on screen the wire never sends. The row's busy
 * state is what covers the moment between opening the page and the answer arriving.
 */
export function serviceCopy(service: DaemonServiceStatus | undefined): ServiceCopy {
  const status: DaemonServiceStatus = service ?? { state: "unknown", detail: "" };
  const pid = status.state === "running" && status.pid !== undefined ? { pid: status.pid } : undefined;
  return {
    headlineKey: HEADLINES[status.state],
    sentenceKey: sentenceKey(status),
    ...(pid !== undefined ? { values: pid } : {}),
    actions: ACTIONS[status.state],
    // An absent answer has nothing to diagnose, so it is never a state that shows a diagnostic line — even
    // though it borrows the unknown state's words and its Refresh.
    showDetail: service !== undefined && (status.state === "failed" || status.state === "unknown"),
  };
}
