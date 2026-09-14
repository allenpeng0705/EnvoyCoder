/**
 * Settings: the app-wide defaults, and the two switches that decide what this machine will do.
 *
 * ## Where settings live, and why there are three scopes
 *
 * The reference product has two — app-global and per-host
 * (`docs/envoycoder-paseo-inheritance.md` §3). EnvoyCoder adds a third, **per project**: the
 * sidebar's own design says settings belong where the defaults do, and a monorepo of Go services
 * and a Python tool want different agents. This pane is the app level; per-project defaults are
 * edited from the project row, and both feed `resolveTaskDefaults`, which is pure and tested,
 * so "which agent will this task use?" has one answer.
 *
 * ## Why the labels are sentences
 *
 * Each switch answers a question a user would actually ask. "Allow remote runs" is a developer's
 * summary of a security decision; "Share this machine's agents with your other machines" is the
 * decision. The family's wording rule puts the headline in the user's language and the developer
 * detail last — here, in the tooltip.
 */

import type { JSX } from "react";

import type { CoderSettings, HarnessId } from "@envoycoder/protocol";

import { useI18n, useT } from "../i18n/context.js";
import { LOCALES, LOCALE_LABELS } from "../i18n/locales.js";
import { localizeText } from "../i18n/notice.js";
import type { CoderState } from "../state/coderStore.js";

export interface SettingsPaneProps {
  state: CoderState;
  onClose: () => void;
  onUpdate: (patch: Partial<CoderSettings>) => void;
}

export function SettingsPane(props: SettingsPaneProps): JSX.Element {
  const t = useT();
  const { locale, preference } = useI18n();
  const { settings } = props.state;
  const available = props.state.harnesses.filter((harness) => harness.available !== false);
  // A value the daemon has not stored yet reads as `system`, which is what the daemon will apply.
  const language = settings.language ?? "system";

  return (
    <section className="pane" aria-label={t("settings.title")}>
      <header className="pane__header">
        <div className="pane__title-group">
          <h1 className="pane__title">{t("settings.title")}</h1>
          <div className="pane__meta">
            <span
              className="chip chip--quiet"
              title={props.state.hello?.stateDir ?? t("connection.none")}
            >
              {props.state.hello
                ? t("settings.stateDir", { path: shortPath(props.state.hello.stateDir) })
                : t("connection.none")}
            </span>
            <span className="chip chip--quiet" title={t("settings.daemon.title")}>
              {props.state.hello
                ? t("settings.daemon", { version: props.state.hello.version })
                : t("settings.noDaemon")}
            </span>
          </div>
        </div>
        <div className="pane__actions">
          <button type="button" className="button button--secondary" onClick={props.onClose}>
            {t("settings.close")}
          </button>
        </div>
      </header>

      <div className="settings">
        {/* **The language, and why it is a daemon setting rather than `localStorage`.**
            It is a per-user preference, and the daemon already owns this user's settings: a value in
            the webview's own storage would be invisible to the phone, would not survive a webview
            cache clear, and would have to be re-sent to whichever surface renders a refusal. Stored
            with the rest, it follows the user to every window and every client — which is what
            "the language must be unified" requires, since the daemon's refusals are rendered by
            whoever is looking. */}
        <Setting
          title={t("settings.language.title")}
          detail={t("settings.language.detail")}
          developerNote="settings.language"
        >
          <select
            className="select"
            value={language}
            aria-label={t("settings.language.aria")}
            onChange={(event) =>
              props.onUpdate({ language: event.target.value as CoderSettings["language"] })
            }
          >
            <option value="system">{t("settings.language.system")}</option>
            {LOCALES.map((option) => (
              // Endonyms: a language is listed in its own language, so the one a user is looking for
              // is the one they can read. The row is also the only place the *resolved* locale is
              // visible, when the setting is "system".
              <option key={option} value={option}>
                {LOCALE_LABELS[option]}
                {option === locale && preference === "system" ? ` — ${t("settings.language.system")}` : ""}
              </option>
            ))}
          </select>
        </Setting>

        <Setting
          title={t("settings.defaultHarness.title")}
          detail={t("settings.defaultHarness.detail")}
          developerNote="settings.defaults.harness"
        >
          <select
            className="select"
            value={settings.defaults.harness ?? "envoy-harness"}
            onChange={(event) =>
              props.onUpdate({ defaults: { ...settings.defaults, harness: event.target.value as HarnessId } })
            }
          >
            {available.length === 0 ? (
              // An empty picker is a lie by omission: it suggests nothing is installed when the
              // truth is that we have not been told yet.
              <option value={settings.defaults.harness ?? "envoy-harness"}>
                {settings.defaults.harness ?? "envoy-harness"}
              </option>
            ) : null}
            {available.map((harness) => (
              <option key={harness.id} value={harness.id}>
                {harness.label}
                {harness.tier === "catalogued" ? ` ${t("settings.needsInstalling")}` : ""}
              </option>
            ))}
          </select>
        </Setting>

        <Setting
          title={t("settings.approvals.title")}
          detail={t("settings.approvals.detail")}
          developerNote="settings.requireApprovalForDestructive"
        >
          <input
            type="checkbox"
            checked={settings.requireApprovalForDestructive}
            onChange={(event) => props.onUpdate({ requireApprovalForDestructive: event.target.checked })}
            aria-label={t("settings.approvals.title")}
          />
        </Setting>

        <Setting
          title={t("settings.remoteRuns.title")}
          detail={t("settings.remoteRuns.detail")}
          developerNote="settings.allowRemoteRuns"
        >
          <input
            type="checkbox"
            checked={settings.allowRemoteRuns}
            onChange={(event) => props.onUpdate({ allowRemoteRuns: event.target.checked })}
            aria-label={t("settings.remoteRuns.title")}
          />
        </Setting>

        <Setting
          title={t("settings.transcripts.title")}
          detail={t("settings.transcripts.detail")}
          developerNote="settings.keepTranscripts"
        >
          <input
            type="checkbox"
            checked={settings.keepTranscripts}
            onChange={(event) => props.onUpdate({ keepTranscripts: event.target.checked })}
            aria-label={t("settings.transcripts.title")}
          />
        </Setting>

        <h2 className="settings__heading">{t("settings.agents.heading")}</h2>
        <p className="settings__note">{t("settings.agents.note")}</p>
        <ul className="settings__agents">
          {props.state.harnesses.map((harness) => (
            <li key={harness.id} className="settings__agent">
              <div>
                <strong>{harness.label}</strong>
                <span className="settings__agent-summary">{harness.summary}</span>
              </div>
              <div className="settings__agent-facts">
                <span className={`chip ${harness.available === false ? "chip--danger" : harness.available === "unknown" ? "chip--quiet" : "chip--live"}`}>
                  {harness.available === false
                    ? t("settings.agent.notInstalled")
                    : harness.available === "unknown"
                      ? t("settings.agent.unknown")
                      : t("settings.agent.ready")}
                </span>
                {harness.capabilities.approvals ? null : (
                  <span className="chip chip--warn" title={t("settings.agent.noApprovals.title")}>
                    {t("settings.agent.noApprovals")}
                  </span>
                )}
                {harness.capabilities.cancel ? null : (
                  <span className="chip chip--warn" title={t("settings.agent.noCancel.title")}>
                    {t("settings.agent.noCancel")}
                  </span>
                )}
                {/* `installHint` is deliberately not translated: it is a command line
                    (`npm install -g @anthropic-ai/claude-code`), and a translated command is a
                    command that does not run. */}
                {harness.installHint ? <span className="settings__hint">{harness.installHint}</span> : null}
              </div>
            </li>
          ))}
          {props.state.harnesses.length === 0 ? (
            <li className="settings__agent">{t("settings.agents.empty")}</li>
          ) : null}
        </ul>

        {props.state.notes.length > 0 ? (
          <>
            <h2 className="settings__heading">{t("settings.notes.heading")}</h2>
            <ul className="settings__notes">
              {props.state.notes.map((note) => (
                // The daemon's own sentences, rendered through their key when it sent one — a
                // quarantined file explained in German, with the parse error it cited left as it is.
                <li key={note}>{localizeText(t, note)}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}

function Setting(props: {
  title: string;
  detail: string;
  developerNote: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="setting">
      <div className="setting__text">
        <p className="setting__title" title={props.developerNote}>
          {props.title}
        </p>
        <p className="setting__detail">{props.detail}</p>
      </div>
      <div className="setting__control">{props.children}</div>
    </div>
  );
}

/** Home directories are long and the middle is the interesting part; keep the tail. */
function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}
