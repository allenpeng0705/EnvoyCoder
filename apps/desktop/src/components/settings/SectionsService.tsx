/**
 * **Background service** — the one control that lets a paired phone reach this machine while the window is
 * closed.
 *
 * ## What it is, and what it is not
 *
 * This row does not store a preference. The value it reports lives in the **operating system's own service
 * manager** — a launchd LaunchAgent, a systemd *user* unit, a per-user Task Scheduler job — and the row asks
 * that supervisor through `coder.getServiceStatus` and changes it through `coder.installService`,
 * `coder.uninstallService` and `coder.restartService` (`docs/daemon-lifecycle.md` §10). That is why the row's
 * words are the supervisor's *answer* rather than a checkbox: turning it on is a request that can be refused,
 * so a boolean here would be a claim about the machine made from our own optimism.
 *
 * The status is asked when **this page is opened**, not when the window connects: the read runs a supervisor
 * process (`launchctl print`, `systemctl --user show`, `schtasks /Query`), and there is nothing a user can do
 * with the answer until they are looking at the control. `MachineSection`'s paired-device list loads the same
 * way, on mount.
 *
 * ## The six states, and the two things the copy must never do
 *
 * `service-state.ts` owns the projection from the wire's `DaemonServiceStatus` to a headline, one sentence and
 * the presses a state allows; this file only renders it. The two rules it enforces are stated there and held
 * by `test/service-state.test.ts`:
 *
 *   * the service starts **at login**, never "at boot", and the sentence that promises it is only used when
 *     the supervisor said `enabled: true`;
 *   * the supervisor's own `detail` is diagnostic text, shown last, and only where it is a diagnosis.
 *
 * ## Why the buttons are not a `SettingRow.write`
 *
 * `SettingRow`'s write sink exists for a **setting** whose value the row shows: the row clears the refusal when
 * the stored value lands. These four calls are not writes to us — the daemon asks the OS and answers with a
 * fresh status, which the store puts in `state.service` — and the row also has to keep a busy state while a
 * supervisor call is in flight. So the presses use the same local `busy` + `notice` pair the pairing and fix
 * rows use (`PairingSection.tsx`, `FixRunner.tsx`), and the refusal still renders under the control that
 * produced it rather than in the window's top bar.
 */

import type { JSX } from "react";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "../../i18n/context.js";
import { localize, type Notice } from "../../i18n/notice.js";
import { SettingRow } from "../SettingsRows.js";
import type { SettingsSectionProps } from "./SectionProps.js";
import { serviceCopy, type ServiceActionId } from "./service-state.js";

/** The service surface's calls, named on the state's own action bundle — see `service-state.ts`. */
export function ServiceSection(props: SettingsSectionProps): JSX.Element {
  const { t } = useI18n();
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

  const status = props.state.service;
  const copy = serviceCopy(status);

  /**
   * One press, one in-flight slot, one place a refusal lands.
   *
   * The answer is the *returned* status, never an assumption: the store writes it into `state.service` before
   * this promise settles, so the row's words and buttons follow the supervisor's answer rather than the press.
   */
  const run = useCallback(
    (action: ServiceActionId): void => {
      if (busy !== undefined) return;
      setBusy(action);
      const answer =
        action === "install"
          ? props.agents.installService()
          : action === "restart"
            ? props.agents.restartService()
            : action === "uninstall"
              ? props.agents.uninstallService()
              : props.agents.getServiceStatus();
      void answer.then((result) => {
        setBusy(undefined);
        setNotice(result.ok ? undefined : result);
      });
    },
    [busy, props.agents],
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
    });
  }, [props.agents]);

  // The line under the control: the state, headline first. **"Checking" while the first answer is still on
  // its way**, because "Could not tell" is a claim about the supervisor and we have not heard from it yet.
  // The headline, the sentence and the pid are three elements rather than one run of text: the bands are
  // what a reader scans, and a test can name the sentence rather than the paragraph around it.
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
      </>
    );

  return (
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
              onClick={() => run(action.id)}
            >
              {busy === action.id ? t("settings.service.busy") : t(action.labelKey)}
            </button>
          ))}
        </div>
        {/* **The supervisor's own words, last, and only where they are a diagnosis.** For a running service
            `detail` is the supervisor's whole definition dump, which is not something to put on a row; for a
            failure or an answer we could not read, it is the most useful thing on the page. It is not a
            catalogue string — it is the OS's output, kept verbatim. */}
        {copy.showDetail && status !== undefined && status.detail !== "" ? (
          <p className="setting__developer" data-testid="service-detail">
            {status.detail}
          </p>
        ) : null}
        {notice !== undefined ? (
          <p className="setting__failure" role="status">
            {localize(t, notice)}
          </p>
        ) : null}
      </>
    </SettingRow>
  );
}
