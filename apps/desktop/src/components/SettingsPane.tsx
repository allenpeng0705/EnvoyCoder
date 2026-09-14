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
import type { CoderState } from "../state/coderStore.js";

export interface SettingsPaneProps {
  state: CoderState;
  onClose: () => void;
  onUpdate: (patch: Partial<CoderSettings>) => void;
}

export function SettingsPane(props: SettingsPaneProps): JSX.Element {
  const { settings } = props.state;
  const available = props.state.harnesses.filter((harness) => harness.available !== false);

  return (
    <section className="pane" aria-label="Settings">
      <header className="pane__header">
        <div className="pane__title-group">
          <h1 className="pane__title">Settings</h1>
          <div className="pane__meta">
            <span className="chip chip--quiet" title={props.state.hello?.stateDir ?? "Not connected"}>
              {props.state.hello ? `State in ${shortPath(props.state.hello.stateDir)}` : "Not connected"}
            </span>
            <span className="chip chip--quiet" title="The daemon this window is attached to">
              {props.state.hello ? `Daemon ${props.state.hello.version}` : "No daemon"}
            </span>
          </div>
        </div>
        <div className="pane__actions">
          <button type="button" className="button button--secondary" onClick={props.onClose}>
            Close
          </button>
        </div>
      </header>

      <div className="settings">
        <Setting
          title="The agent new tasks start with"
          detail="A project can override this; this is the answer when it does not."
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
                {harness.tier === "catalogued" ? " (needs installing)" : ""}
              </option>
            ))}
          </select>
        </Setting>

        <Setting
          title="Ask before anything destructive"
          detail="Agents stop and wait for you instead of overwriting files. Turning this off means a task can change your working tree without asking."
          developerNote="settings.requireApprovalForDestructive"
        >
          <input
            type="checkbox"
            checked={settings.requireApprovalForDestructive}
            onChange={(event) => props.onUpdate({ requireApprovalForDestructive: event.target.checked })}
            aria-label="Ask before anything destructive"
          />
        </Setting>

        <Setting
          title="Share this machine's agents with your other machines"
          detail="Off by default. When it is on, a task from another of your machines can run here, in a directory of yours."
          developerNote="settings.allowRemoteRuns"
        >
          <input
            type="checkbox"
            checked={settings.allowRemoteRuns}
            onChange={(event) => props.onUpdate({ allowRemoteRuns: event.target.checked })}
            aria-label="Share this machine's agents with your other machines"
          />
        </Setting>

        <Setting
          title="Keep transcripts after a task ends"
          detail="The record of what an agent did, kept on this machine. Turning it off saves space and makes 'what did it change?' unanswerable later."
          developerNote="settings.keepTranscripts"
        >
          <input
            type="checkbox"
            checked={settings.keepTranscripts}
            onChange={(event) => props.onUpdate({ keepTranscripts: event.target.checked })}
            aria-label="Keep transcripts after a task ends"
          />
        </Setting>

        <h2 className="settings__heading">Agents on this machine</h2>
        <p className="settings__note">
          What each agent can actually do decides what EnvoyCoder offers. An agent that cannot be
          asked for permission is not given an approval dialog it would ignore.
        </p>
        <ul className="settings__agents">
          {props.state.harnesses.map((harness) => (
            <li key={harness.id} className="settings__agent">
              <div>
                <strong>{harness.label}</strong>
                <span className="settings__agent-summary">{harness.summary}</span>
              </div>
              <div className="settings__agent-facts">
                <span className={`chip ${harness.available === false ? "chip--danger" : harness.available === "unknown" ? "chip--quiet" : "chip--live"}`}>
                  {harness.available === false ? "Not installed" : harness.available === "unknown" ? "Unknown" : "Ready"}
                </span>
                {harness.capabilities.approvals ? null : (
                  <span className="chip chip--warn" title="This agent never asks before acting">
                    No approvals
                  </span>
                )}
                {harness.capabilities.cancel ? null : (
                  <span className="chip chip--warn" title="The only way to stop this agent is to end its process">
                    Cannot be cancelled
                  </span>
                )}
                {harness.installHint ? <span className="settings__hint">{harness.installHint}</span> : null}
              </div>
            </li>
          ))}
          {props.state.harnesses.length === 0 ? (
            <li className="settings__agent">The agent list has not arrived yet.</li>
          ) : null}
        </ul>

        {props.state.notes.length > 0 ? (
          <>
            <h2 className="settings__heading">Things worth knowing</h2>
            <ul className="settings__notes">
              {props.state.notes.map((note) => (
                <li key={note}>{note}</li>
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
