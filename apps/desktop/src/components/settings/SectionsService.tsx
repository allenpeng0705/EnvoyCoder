/**
 * **Background service** — the one control that lets a paired phone reach this machine while the window is
 * closed.
 *
 * ## What it is, and what it is not
 *
 * This row does not store a preference. The value it reports lives in the **operating system's own service
 * manager** — a launchd LaunchAgent, a systemd *user* unit, a per-user Task Scheduler job — and the row asks
 * that supervisor through `coder.getServiceStatus` and changes it through `coder.installService`,
 * `coder.uninstallService`, `coder.restartService` and `coder.shutdown` (`docs/daemon-lifecycle.md` §11). That
 * is why the row's words are the supervisor's *answer* rather than a checkbox: turning it on is a request that
 * can be refused, so a boolean here would be a claim about the machine made from our own optimism.
 *
 * The status is asked when **this page is opened**, not when the window connects: the read runs a supervisor
 * process (`launchctl print`, `systemctl --user show`, `schtasks /Query`), and there is nothing a user can do
 * with the answer until they are looking at the control. `MachineSection`'s paired-device list loads the same
 * way, on mount.
 *
 * ## Stop, and why it is not Turn off
 *
 * `stop` calls `coder.shutdown`, which ends the daemon now; because the service is installed, the supervisor
 * brings it back at the next login. `uninstall` removes the service so it does not come back at all. The row
 * says that difference in words (`settings.service.stopVsOff`) *and* puts it on each button's tooltip, because
 * the two labels alone are the kind of ambiguity that ends with somebody removing a service they meant to stop.
 *
 * **An accepted stop is the state, not a re-read.** `coder.shutdown` answers `{ stopping: true }` and the
 * process then drains for up to ten seconds; a status read inside that window can legitimately succeed and
 * report the daemon still running. Re-reading therefore used to restore "On, running" while the daemon was on
 * its way out. The accepted answer is what the row renders — `installed-stopped`, the shape a daemon that has
 * gone leaves behind — and a later visit to this page is what corrects it if the daemon really is still there.
 *
 * ## The log, which is read when asked and not before
 *
 * The row's last control is a disclosure onto `coder.getDaemonLog` (`ServiceLog.tsx` renders the panel). It is
 * **not a row and not on mount**: reading the tail is a file read on the daemon, and most visits to this page
 * do not want it, so the first open asks and the panel's Refresh is the only other ask. Nothing in this component
 * watches `logOpen` in an effect, which is what keeps a re-render from becoming a second read.
 *
 * ## The six states, the diagnostic band, and the two things the copy must never do
 *
 * `service-state.ts` owns the projection from the wire's `DaemonServiceStatus` to a headline, one sentence and
 * the presses a state allows; this file renders it, plus the diagnostic band the daemon's own history feeds
 * (restart count, last stop, then the supervisor's raw words last). The rules are stated there and held by
 * `test/service-state.test.ts`:
 *
 *   * the service starts **at login**, never "at boot", and the sentence that promises it is only used when
 *     the supervisor said `enabled: true`;
 *   * the supervisor's `detail` is diagnostic text, shown last, and only where it is a diagnosis.
 *
 * ## Why the buttons are not a `SettingRow.write`
 *
 * `SettingRow`'s write sink exists for a **setting** whose value the row shows: the row clears the refusal when
 * the stored value lands. These calls are not writes to us — the daemon asks the OS and answers with a fresh
 * status, which the store puts in `state.service` — and the row also has to keep a busy state while a
 * supervisor call is in flight. So the presses use the same local `busy` + `notice` pair the pairing and fix
 * rows use (`PairingSection.tsx`, `FixRunner.tsx`), and the refusal still renders under the control that
 * produced it rather than in the window's top bar.
 */

import type { JSX } from "react";

import type { DaemonServiceStatus } from "@envoydev/protocol";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "../../i18n/context.js";
import { localize, type Notice } from "../../i18n/notice.js";
import { formatWhen } from "../../i18n/when.js";
import type { DaemonLogAnswer } from "../../state/agent-actions.js";
import { SettingRow } from "../SettingsRows.js";
import type { SettingsSectionProps } from "./SectionProps.js";
import { ServiceLogPanel } from "./ServiceLog.js";
import { serviceCopy, serviceEvidence, type ServiceActionId } from "./service-state.js";

/** The one disclosure on this row, named so its toggle can point at the panel it opens. */
const LOG_PANEL_ID = "service-log";

/**
 * What to show once a stop has been accepted.
 *
 * Only `coder.shutdown` reaches this path, and it is honest for the same reason the button was offered: the
 * press exists only for a service that is installed, so "installed and not running" is what a daemon that has
 * gone leaves behind — and the `enabled` it had is the only thing that says whether it comes back. The
 * accepted answer is the evidence; the re-read this replaced was not (`docs/daemon-lifecycle.md` §11).
 */
function stoppedFallback(previous: DaemonServiceStatus | undefined): DaemonServiceStatus {
  return {
    state: "installed-stopped",
    detail: "",
    restartsInLastHour: previous?.restartsInLastHour ?? 0,
    ...(previous?.enabled !== undefined ? { enabled: previous.enabled } : {}),
  };
}

/** The service surface's calls, named on the state's own action bundle — see `service-state.ts`. */
export function ServiceSection(props: SettingsSectionProps): JSX.Element {
  const { t, locale } = useI18n();
  /**
   * Which press is in flight.
   *
   * A single slot rather than four booleans, because the buttons are mutually exclusive for as long as any of
   * them is running: every one of them can change what the *others* would do, so a second press queued behind
   * the first would be a press whose premise no longer holds. `undefined` is "nothing is running" and every
   * control is enabled.
   */
  const [busy, setBusy] = useState<ServiceActionId | undefined>(undefined);
  /** The last refusal from the page's own presses, read under the control that produced it. */
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  /**
   * The status to render from a stop that was accepted.
   *
   * `undefined` means "use the store's". An accepted stop sets `stoppedFallback`, so the row shows the machine
   * the way the acknowledgement says it is rather than the running state a re-read could still report for up to
   * ten seconds. Any later status load — reopening the page — clears it.
   */
  const [stopped, setStopped] = useState<DaemonServiceStatus | undefined>(undefined);
  /**
   * The log disclosure: whether it is open, the last read, and whether one is in flight.
   *
   * All three are here rather than in `CoderState` because the log belongs to this one block — putting it in the
   * store's snapshot would re-render every surface in the window for a panel most visits never open.
   */
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<DaemonLogAnswer | undefined>(undefined);
  const [logBusy, setLogBusy] = useState(false);

  const status = stopped ?? props.state.service;
  const copy = serviceCopy(status);
  const evidence = serviceEvidence(status, (at) => formatWhen(at, locale));

  /**
   * Read the log tail. Called when the disclosure opens and by its Refresh press, and by nothing else — there is
   * no effect watching `logOpen`, so a re-render cannot turn into a second file read on the daemon.
   */
  const readLog = useCallback((): void => {
    if (logBusy) return;
    setLogBusy(true);
    void props.agents.getDaemonLog().then((answer) => {
      setLog(answer);
      setLogBusy(false);
    });
  }, [logBusy, props.agents]);

  const toggleLog = (): void => {
    const next = !logOpen;
    setLogOpen(next);
    // **Fetched when opened, not on mount.** The first open asks; Refresh is the only other ask. `log === undefined`
    // keeps a close-and-reopen from reading the file again, which is what "the disclosure fetches on open" means
    // for a panel whose contents do not change on their own.
    if (next && log === undefined) readLog();
  };

  /**
   * One press, one in-flight slot, one place a refusal lands.
   *
   * The answer is the *returned* status, never an assumption: the store writes it into `state.service` before
   * this promise settles, so the row's words and buttons follow the supervisor's answer rather than the press.
   * Stop is the one press whose answer is not a status, and it is handled first — see the module doc.
   */
  const run = useCallback(
    (action: ServiceActionId): void => {
      if (busy !== undefined) return;
      setBusy(action);
      void (async () => {
        if (action === "stop") {
          const accepted = await props.agents.shutdown();
          if (!accepted.ok) {
            setBusy(undefined);
            setNotice(accepted);
            return;
          }
          // The daemon is on its way out, and the acknowledgement is what says so. **Not a re-read**: inside
          // the drain the daemon still answers, and the status it reports is honestly "running" — which would
          // restore the running row for up to ten seconds for a service the user just stopped.
          setStopped(stoppedFallback(status));
          setNotice(undefined);
          setBusy(undefined);
          return;
        }
        const answer =
          action === "install"
            ? props.agents.installService()
            : action === "restart"
              ? props.agents.restartService()
              : action === "uninstall"
                ? props.agents.uninstallService()
                : props.agents.getServiceStatus();
        const result = await answer;
        setBusy(undefined);
        setNotice(result.ok ? undefined : result);
        // Any other press answers with a status, so the stop fallback has been superseded.
        setStopped(undefined);
      })();
    },
    [busy, props.agents, status],
  );

  /**
   * Ask the supervisor what it thinks, once, when this page opens.
   *
   * `props.agents` is the store and therefore stable, so this is one call per visit rather than one per
   * render. A refusal is kept rather than swallowed: "the daemon does not know this method" is exactly the
   * sentence that tells a user their daemon is a build behind, and the row's own refresh press is the retry.
   */
  useEffect(() => {
    setBusy("refresh");
    void props.agents.getServiceStatus().then((answer) => {
      setBusy(undefined);
      setNotice(answer.ok ? undefined : answer);
      setStopped(undefined);
    });
  }, [props.agents]);

  // The line under the control: the state, headline first. **"Checking" while the first answer is still on
  // its way**, because "Could not tell" is a claim about the supervisor and we have not heard from it yet.
  // The headline, the sentence and the pid are three elements rather than one run of text: the bands are
  // what a reader scans, and a test can name the sentence rather than the paragraph around it.
  const stopOffered = copy.actions.some((action) => action.id === "stop");
  const note =
    status === undefined && busy !== undefined ? (
      t("settings.service.checking")
    ) : (
      <>
        <strong className="setting__state" data-service-state={status?.state ?? "unknown"}>
          {t(copy.headlineKey)}
        </strong>
        {" — "}
        <span className="setting__state-sentence">{t(copy.sentenceKey, copy.values)}</span>
        {copy.values !== undefined ? (
          <>
            {" "}
            <span className="setting__state-pid">{t("settings.service.pid", { pid: copy.values.pid })}</span>
          </>
        ) : null}
        {/* **The one place the two ending presses are told apart in words.** Shown wherever Stop is on the
            row, because a user who reads "Stop" and "Turn off" side by side has to know which one removes the
            service. */}
        {stopOffered ? (
          <>
            {" "}
            <span className="setting__state-sentence">{t("settings.service.stopVsOff")}</span>
          </>
        ) : null}
      </>
    );

  // The diagnostic band: the daemon's own history first (evidence a reader can act on), the supervisor's raw
  // output last. Each line is absent when it has nothing to say, and the band is absent when none of them do.
  const supervisorDetail = evidence.supervisorDetail && status !== undefined && status.detail !== "";
  const hasDiagnostics =
    evidence.restarts !== undefined || evidence.lastStop !== undefined || supervisorDetail;

  return (
    <>
      <SettingRow
        title={t("settings.service.title")}
        detail={t("settings.service.detail")}
        // The developer fact is the call this value comes from, not a settings field: there is no field.
        developerNote="coder.getServiceStatus"
        titleId="setting-service"
        note={note}
      >
        <>
          <div className="setting__field-group" aria-busy={busy !== undefined}>
            {copy.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="button button--secondary"
                disabled={busy !== undefined}
                data-service-action={action.id}
                {...(action.titleKey !== undefined ? { title: t(action.titleKey) } : {})}
                onClick={() => run(action.id)}
              >
                {busy === action.id ? t("settings.service.busy") : t(action.labelKey)}
              </button>
            ))}
          </div>
          {/* **The daemon's history, then the supervisor's own words, last and verbatim.** For a running service
              `detail` is the supervisor's whole definition dump, which is not something to put on a row; for a
              failure or an answer we could not read, it is the most useful thing on the page. The lines above it
              are ours — a translated restart count and the one sentence the previous stop deserves. */}
          {hasDiagnostics ? (
            <div className="setting__diagnostics" data-testid="service-detail">
              {evidence.restarts !== undefined ? (
                <p className="setting__developer">{t(evidence.restarts.key, evidence.restarts.values)}</p>
              ) : null}
              {evidence.lastStop !== undefined ? (
                <p className="setting__developer">{t(evidence.lastStop.key, evidence.lastStop.values)}</p>
              ) : null}
              {supervisorDetail ? <p className="setting__developer">{status.detail}</p> : null}
            </div>
          ) : null}
          {/* A disclosure, not a row: the log is where a user goes when something is wrong, and the press is what
              reads it. The panel is a sibling below the row so its monospace block gets the full width rather
              than the control column. */}
          <button
            type="button"
            className="button button--secondary settings__log-toggle"
            aria-expanded={logOpen}
            aria-controls={LOG_PANEL_ID}
            data-service-log-toggle=""
            onClick={toggleLog}
          >
            {logOpen ? t("settings.service.log.hide") : t("settings.service.log.show")}
          </button>
          {notice !== undefined ? (
            <p className="setting__failure" role="status">
              {localize(t, notice)}
            </p>
          ) : null}
        </>
      </SettingRow>
      {logOpen ? (
        <ServiceLogPanel id={LOG_PANEL_ID} answer={log} busy={logBusy} onRefresh={readLog} />
      ) : null}
    </>
  );
}
