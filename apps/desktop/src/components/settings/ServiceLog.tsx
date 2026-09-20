/**
 * The daemon's log tail, as the service row's disclosure panel.
 *
 * ## Why this is a panel and not another row
 *
 * The log is not a value the row *has*; it is something a user goes and looks at when the service is misbehaving.
 * So it lives behind a disclosure (`SectionsService`'s toggle button, with the fetch state), and this component
 * only renders what that state holds: the bounded tail, the note that says it *is* a tail, and the two ordinary
 * non-answers — a file nothing has written yet, and a refusal.
 *
 * ## What the panel owes the reader, in order
 *
 *   1. **Which file it is.** The daemon answers with the live log's path; it is shown shortened (`shortPath`, the
 *      same abbreviation the pane's chips use) with the whole path on hover, because "the log" is two files on a
 *      machine that has run both ways.
 *   2. **Whether this is all of it.** `truncated: true` gets a sentence, not an implication: the daemon read at
 *      most the last 64 KB / 200 lines, and a tail that looked complete is a lie somebody debugs from.
 *   3. **Nothing, said as nothing.** `lines: []` with a path is the normal state of a machine that has never run
 *      the daemon — an empty state naming the situation, never an error.
 *   4. **The supervisor's refusal, where the press was.** A daemon log is owner-window-only, so a refusal is a
 *      real answer and is rendered on the panel rather than swallowed.
 *
 * The lines are rendered as one `<pre>`: the daemon sends lines, not markup, and a `<span>` per line would be
 * a way for one line's text to become another element.
 */

import type { JSX } from "react";

import type { DaemonLogAnswer } from "../../state/agent-actions.js";

import { useI18n } from "../../i18n/context.js";
import { localize } from "../../i18n/notice.js";
import { shortPath } from "../SettingsShell.js";

export interface ServiceLogPanelProps {
  /** The id the row's toggle names in `aria-controls`, so the button and the panel are one disclosure. */
  id: string;
  /** The last read, or `undefined` while the first one is still on its way. */
  answer: DaemonLogAnswer | undefined;
  /** A read is in flight; the Refresh press is disabled so the daemon is not asked twice. */
  busy: boolean;
  onRefresh: () => void;
}

export function ServiceLogPanel(props: ServiceLogPanelProps): JSX.Element {
  const { t } = useI18n();
  const log = props.answer?.ok === true ? props.answer.log : undefined;

  return (
    <section className="settings__log" id={props.id} aria-label={t("settings.service.log.title")}>
      <div className="settings__log-head">
        <h3 className="settings__heading">{t("settings.service.log.title")}</h3>
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={props.busy}
          data-service-log-refresh=""
          onClick={props.onRefresh}
        >
          {props.busy ? t("settings.service.log.reading") : t("settings.service.log.refresh")}
        </button>
      </div>
      {props.answer === undefined ? (
        // Opened and not answered yet: the one moment the panel has nothing to report, said as itself.
        <p className="settings__log-note" role="status">
          {t("settings.service.log.reading")}
        </p>
      ) : !props.answer.ok ? (
        <p className="setting__failure" role="status">
          {localize(t, props.answer)}
        </p>
      ) : log === undefined ? null : (
        <>
          {log.path !== "" ? (
            <p className="settings__log-path" title={log.path} data-service-log-path="">
              {shortPath(log.path)}
            </p>
          ) : null}
          {/* **Said, never implied.** The daemon bounds the read twice; this is the sentence that admits it. */}
          {log.truncated ? (
            <p className="settings__log-note" data-service-log-truncated="">
              {t("settings.service.log.truncated")}
            </p>
          ) : null}
          {log.lines.length === 0 ? (
            <p className="settings__log-empty" data-service-log-empty="">
              {t("settings.service.log.empty")}
            </p>
          ) : (
            <pre className="settings__log-lines" data-service-log-lines="">
              {log.lines.join("\n")}
            </pre>
          )}
        </>
      )}
    </section>
  );
}
