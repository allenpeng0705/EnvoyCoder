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
 * ## The rules the copy is built to keep
 *
 *   * **The login promise is gated on `enabled`, and "boot" is never said.** The service starts **at login**
 *     (a launchd LaunchAgent, a systemd *user* unit, a per-user scheduled task — `docs/daemon-lifecycle.md`
 *     §6), and a machine with `enabled: false` will *not* bring it back. So the at-login sentence is chosen
 *     from `enabled`, and an absent `enabled` gets the sentence that claims nothing rather than the
 *     flattering one. `test/service-state.test.ts` asserts exactly this, in English, against the catalogue.
 *   * **The supervisor's `detail` is diagnostic text, not our sentence.** It is the OS service manager's own
 *     output, it is not translated, and for a *running* service it is the supervisor's whole definition dump
 *     — so it is shown only where it is actually a diagnosis.
 *   * **The daemon's own history is evidence, not alarm.** `restartsInLastHour` is shown only above zero, and
 *     the one line about the previous stop is shown only when it explains something: a recorded stop is worth
 *     naming, and **the absence of a record when something restarted is the diagnosis** — a deliberate stop
 *     always leaves one (`lifecycle.recordStop`).
 *
 * @see docs/daemon-lifecycle.md §10 — the Settings control this is half of.
 * @see docs/settings-parity.md §5.1 — the row that records where the control lives.
 */

import type { DaemonServiceStatus } from "@envoydev/protocol";

import type { MessageKey } from "../../i18n/messages/en.js";

/** The closed state vocabulary, named once so the tables below can be total against it. */
export type ServiceState = DaemonServiceStatus["state"];

/**
 * The five presses a service row can offer.
 *
 * `install` is the "turn it on" press *and* the "try again" press: it is idempotent on every platform
 * (`launchd` boots the job out before bootstrapping it, systemd `enable --now`s an existing unit), and it is
 * the operation that asks the supervisor to have it running.
 *
 * `stop` and `uninstall` are deliberately **not** the same press, and the copy says so: `stop` asks the daemon
 * to end itself now (`coder.shutdown`) and the installed service brings it back at the next login, while
 * `uninstall` takes the service away so it does not come back at all.
 */
export type ServiceActionId = "install" | "restart" | "stop" | "uninstall" | "refresh";

export interface ServiceAction {
  readonly id: ServiceActionId;
  /** The button's own words. State-specific, so `install` reads *Turn on* from off and *Try again* from failed. */
  readonly labelKey: MessageKey;
  /**
   * The longer sentence in the button's tooltip, where the label cannot carry the difference.
   *
   * It exists because of `stop` vs `uninstall`: both end the daemon, and only one of them stops it coming
   * back. The visible hint (`settings.service.stopVsOff`) says the same thing on the row; this is that fact
   * attached to the control the user is about to press.
   */
  readonly titleKey?: MessageKey;
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
}

/** One line of the diagnostic band, already resolved to a catalogue key and its values. */
export interface ServiceDiagnostic {
  readonly key: MessageKey;
  readonly values: Record<string, string | number>;
}

/**
 * The row's **diagnostic band**: the daemon's own history, then the supervisor's raw words.
 *
 * Kept separate from `ServiceCopy` because these are not the state — a running service can be crash-looping,
 * and a failed one can have a perfectly clean history. They are the evidence behind the state, and each line
 * is absent when it has nothing to say.
 */
export interface ServiceEvidence {
  /** "Restarted 3 times in the last hour" — absent at zero, because a zero is evidence of nothing. */
  readonly restarts?: ServiceDiagnostic;
  /**
   * One line about how the previous daemon stopped — or, when it restarted with no record of a stop, the
   * sentence that says so. Absent when the history explains nothing.
   */
  readonly lastStop?: ServiceDiagnostic;
  /** Whether the supervisor's own `detail` belongs on the row (a diagnosis, not a status report). */
  readonly supervisorDetail: boolean;
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

/**
 * The running/stopped pair, which is also the pair that carries **Stop**.
 *
 * Restart first (benign), Stop second, Turn off last: the two that end the daemon sit together, and the one
 * that also removes the service is the last thing on the row rather than the thing next to Restart. Stop's
 * own tooltip is resolved per status by `serviceCopy`, because it makes the same login promise the sentence
 * does and must therefore be gated on `enabled` the same way.
 */
const RUNNING_ACTIONS = [
  { id: "restart", labelKey: "settings.service.action.restart" },
  { id: "stop", labelKey: "settings.service.action.stop" },
  {
    id: "uninstall",
    labelKey: "settings.service.action.turnOff",
    titleKey: "settings.service.action.turnOff.title",
  },
] as const;

const ACTIONS = {
  "not-installed": [{ id: "install", labelKey: "settings.service.action.turnOn" }],
  running: RUNNING_ACTIONS,
  "installed-stopped": RUNNING_ACTIONS,
  // A failure offers the same on/off pair: *Try again* is `install`, which is idempotent and is the press
  // that asks the supervisor to have it running; *Turn off* is still the way out. No Stop: a service the
  // supervisor reported as failed is not something to ask to exit.
  failed: [
    { id: "install", labelKey: "settings.service.action.tryAgain" },
    {
      id: "uninstall",
      labelKey: "settings.service.action.turnOff",
      titleKey: "settings.service.action.turnOff.title",
    },
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
  const status: DaemonServiceStatus = service ?? { state: "unknown", detail: "", restartsInLastHour: 0 };
  const pid = status.state === "running" && status.pid !== undefined ? { pid: status.pid } : undefined;
  const stopTitle = stopTitleKey(status);
  const actions = ACTIONS[status.state].map((action): ServiceAction =>
    action.id === "stop" && stopTitle !== undefined ? { ...action, titleKey: stopTitle } : action,
  );
  return {
    headlineKey: HEADLINES[status.state],
    sentenceKey: sentenceKey(status),
    ...(pid !== undefined ? { values: pid } : {}),
    actions,
  };
}

/**
 * Stop's tooltip, gated exactly as the sentence above it is.
 *
 * Stop leaves the service installed, so whether it *comes back* is the supervisor's answer and not ours: with
 * `enabled` true it returns at the next login, with `enabled` false it does not, and an absent `enabled` says
 * nothing about login at all. A single static tooltip would put the flattering version in front of a user on a
 * machine that will stay stopped — the same lie the state sentence's gate exists to prevent.
 */
function stopTitleKey(service: DaemonServiceStatus): MessageKey | undefined {
  if (service.state !== "running" && service.state !== "installed-stopped") return undefined;
  return service.enabled === true
    ? "settings.service.action.stop.title"
    : service.enabled === false
      ? "settings.service.action.stop.title.notAtLogin"
      : "settings.service.action.stop.title.plain";
}

/**
 * The diagnostic band for a status.
 *
 * `formatWhen` is injected rather than imported so this stays a pure function of its inputs — and so the test
 * can assert *which* timestamp was formatted without depending on `Intl`'s output.
 */
export function serviceEvidence(
  service: DaemonServiceStatus | undefined,
  formatWhen: (at: string) => string,
): ServiceEvidence {
  if (service === undefined) return { supervisorDetail: false };
  // A daemon from before this field existed sends nothing; "no history" is not a crash loop, so it reads 0.
  const restarts = service.restartsInLastHour ?? 0;
  const restarts$ = restartLine(restarts);
  const lastStop = lastStopLine(service, restarts, formatWhen);
  return {
    ...(restarts$ !== undefined ? { restarts: restarts$ } : {}),
    ...(lastStop !== undefined ? { lastStop } : {}),
    supervisorDetail: service.state === "failed" || service.state === "unknown",
  };
}

/** "Restarted 3 times in the last hour" — one key per count, because "1 times" is not a sentence. */
function restartLine(restarts: number): ServiceDiagnostic | undefined {
  if (restarts <= 0) return undefined;
  return {
    key: restarts === 1 ? "settings.service.restarts.one" : "settings.service.restarts.many",
    values: { count: restarts },
  };
}

/**
 * How the previous daemon stopped — the deliberate reasons first, because they are the ones the daemon writes.
 *
 * A `signal` is normally a signal name (`SIGTERM`), but three deliberate exits write a phrase instead
 * (`apps/desktop/src/daemon/main.ts`): a stop requested over this connection, a refused boot, and a failure to
 * serve. Each gets its own sentence rather than being printed raw, because "requested over the connection" is
 * not something to show a user in quotes.
 */
function lastStopLine(
  service: DaemonServiceStatus,
  restarts: number,
  formatWhen: (at: string) => string,
): ServiceDiagnostic | undefined {
  const stop = service.lastStop;
  if (stop !== undefined) {
    const when = formatWhen(stop.at);
    if (stop.signal === "requested over the connection") {
      return { key: "settings.service.lastStop.requested", values: { when } };
    }
    if (stop.signal === "refused") return { key: "settings.service.lastStop.refused", values: { when } };
    if (stop.signal === "failed to serve") return { key: "settings.service.lastStop.failed", values: { when } };
    return stop.exitCode !== undefined
      ? { key: "settings.service.lastStop.signalExit", values: { signal: stop.signal, code: stop.exitCode, when } }
      : { key: "settings.service.lastStop.signal", values: { signal: stop.signal, when } };
  }
  // **The absence is the diagnosis.** `recordStop` runs on every deliberate exit, so a start with no record
  // behind it and restarts to explain was a kill or a crash — which is the thing a person whose daemon keeps
  // disappearing actually needs to read.
  if (restarts > 0) return { key: "settings.service.lastStop.crash", values: {} };
  return undefined;
}
