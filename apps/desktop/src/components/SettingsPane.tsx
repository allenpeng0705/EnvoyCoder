/**
 * Settings: the app's defaults for new tasks, and — when the pane is opened from a project's ⋯ button —
 * **that project's** defaults.
 *
 * ## What this pane is for, and the rule that shapes every row
 *
 * Every control here either does what it says or says why it cannot. That sounds like a low bar and it
 * is the bar this pane failed: it shipped with five controls of which **two stored a preference nothing
 * read** — `requireApprovalForDestructive` (the approvals were unconditional) and `allowRemoteRuns`
 * (there is no remote path to gate) — beside three more fields the app read with no control writing
 * them (`defaults.model`, `defaults.extraArgs`, `defaultProjectPath`). `docs/settings-parity.md` §7.1 is
 * the inventory of that, §8.1 is the work, and `apps/desktop/test/settings-coverage.test.ts` is the gate
 * that keeps it from coming back.
 *
 * So the three honest answers to "can we honour this?" each have a shape here:
 *
 *   * **wired** — schema → store → effect → control. The default agent, the default model, the extra
 *     arguments and the folder "Add project…" starts in are all read at a named site, and each is
 *     asserted where its *effect* happens rather than where it is rendered: `test/settings-store.test.ts`
 *     for the app defaults reaching a created task, `test/settings-scope.test.tsx` for a project's,
 *     `test/palette-flow.test.tsx` for the seeded folder, and four cases in `test/runs.test.ts` for the
 *     approvals policy reaching the agent. That list is the reason this bullet can be believed, so it is
 *     kept exhaustive rather than illustrative.
 *   * **disabled with the reason** — "Ask before anything destructive" is delivered through the agent's
 *     own `session/set_policy`, which `envoy-harness` implements and `deepseek-harness` does not. When
 *     the default agent is one that cannot be told, the row is **disabled and says so**, naming it. A
 *     live switch there would be a preference the user believes is in force and no agent ever hears.
 *   * **removed** — `allowRemoteRuns` is gone, control and field together. Its effect could not exist
 *     (there is no remote-run path, and `coder.offerRemoteRun` had no handler), and a disabled row would
 *     have been a promise to build one on this pane's terms rather than the mesh's.
 *
 * ## Three scopes, and where each one lives
 *
 * The reference product has two settings scopes; this product has three (`CoderSettings` is the app's,
 * `Project.defaults` is a project's, and a task carries its own resolved copy). The app's are here; a
 * project's are here too, in the same pane, reached from the project's ⋯ button — because that button
 * used to open *app* settings and drop the project on the floor, which is the same defect in the UI
 * layer: a control labelled with a scope it did not have.
 *
 * The resolution order (`explicit → project → app → fallback`) is `resolveTaskDefaults`'s, and it is why
 * a project's rows say "override": a project that names an agent decides for its tasks, and a project
 * that names nothing inherits this pane's answer.
 *
 * ## Why the rows are grouped, and what is deliberately not copied
 *
 * One column with headings — not a copy of the reference product's twenty-one-section sidebar, which is
 * a navigation structure for a surface four times this size. Three groups carry the settings, and the
 * two read-only groups (the agents found on this machine, the daemon's own notes about what it could not
 * read) stay exactly as they were: the notes in particular are the best thing in this pane, because they
 * say what happened and offer no switch that pretends to fix it.
 */

import type { JSX, ReactNode } from "react";
import { useState } from "react";

import type {
  CoderSettings,
  HarnessId,
  HarnessSummary,
  Project,
  TaskDefaults,
} from "@envoycoder/protocol";

import { agentFor } from "../composer/agent-for.js";
import { composerControls, modelNote, modelOffReason } from "../composer/controls.js";
import { harnessLabel } from "../composer/harness-label.js";
import { useI18n } from "../i18n/context.js";
import { LOCALES, LOCALE_LABELS } from "../i18n/locales.js";
import { localizeText } from "../i18n/notice.js";
import { formatWhen } from "../i18n/when.js";
import type { CoderState } from "../state/coderStore.js";
import { ModelChoice } from "./ModelChoice.js";
import { FolderSetting, SettingRow, TextSetting } from "./SettingsRows.js";

export interface SettingsPaneProps {
  state: CoderState;
  onClose: () => void;
  /** The app-scope patch. Ignored while the pane is open for a project. */
  onUpdate: (patch: Partial<CoderSettings>) => void;
  /**
   * The project this pane was opened for, if any.
   *
   * Set by "Project settings" in a project row's `…` menu (`CoderSidebar`), which is what the bare `⋯`
   * used to be. The menu's trigger is named *"Actions for {project}"* rather than after this one action,
   * so the scope is promised by the item the user picks and by the project the row belongs to. Absent
   * means the app scope — the footer's Settings button and ⌘,.
   */
  project?: Project | undefined;
  /**
   * Write a project's defaults. Sent **whole** rather than as a patch, because a project's defaults
   * replace: a patch carrying only a model would leave the agent for that project undefined.
   */
  onUpdateProject?: ((defaults: TaskDefaults) => void) | undefined;
}

export function SettingsPane(props: SettingsPaneProps): JSX.Element {
  return props.project ? (
    <ProjectSettings {...props} project={props.project} />
  ) : (
    <AppSettings {...props} />
  );
}

/* ────────────────────────────── the app scope ────────────────────────────── */

function AppSettings(props: SettingsPaneProps): JSX.Element {
  const { t, locale, preference } = useI18n();
  const { settings } = props.state;
  const available = props.state.harnesses.filter((harness) => harness.available !== false);
  // A value the daemon has not stored yet reads as `system`, which is what the daemon will apply.
  const language = settings.language ?? "system";
  const defaultHarness = settings.defaults.harness ?? "envoy-harness";
  // The folder the chooser would not open in, or `undefined`. Kept here rather than in the row so the
  // sentence survives a re-render: a problem the user has to read must not vanish on the next paint.
  const [folderProblem, setFolderProblem] = useState<string | undefined>(undefined);

  return (
    <SettingsShell
      title={t("settings.title")}
      ariaLabel={t("settings.title")}
      state={props.state}
      onClose={props.onClose}
    >
      <h2 className="settings__heading">{t("settings.group.general")}</h2>

      {/* **The language, and why it is a daemon setting rather than `localStorage`.**
          It is a per-user preference, and the daemon already owns this user's settings: a value in
          the webview's own storage would be invisible to the phone, would not survive a webview
          cache clear, and would have to be re-sent to whichever surface renders a refusal. Stored
          with the rest, it follows the user to every window and every client — which is what
          "the language must be unified" requires, since the daemon's refusals are rendered by
          whoever is looking. */}
      <SettingRow
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
      </SettingRow>

      {/* **The one setting that is read by a workflow rather than by the app.**
          `defaultProjectPath` sat in the schema, was advertised on the wire and was read by nobody until
          slice 1. It is read now by the palette's own `project.add` row, which seeds its text stage with
          it — so the field a user meets when they add a project starts from the folder they nominated
          instead of asking them to paste one they have already told us about. */}
      <SettingRow
        title={t("settings.defaultPath.title")}
        detail={t("settings.defaultPath.detail")}
        developerNote="settings.defaultProjectPath"
        note={folderProblem}
      >
        <FolderSetting
          ariaLabel={t("settings.defaultPath.title")}
          value={settings.defaultProjectPath}
          placeholder={t("settings.defaultPath.placeholder")}
          onCommit={(value) => {
            setFolderProblem(undefined);
            // `""` is "clear it": a user who nominated a folder must be able to un-nominate one, and a
            // JSON patch cannot carry an absent key (`daemon/store.ts` records why).
            props.onUpdate({ defaultProjectPath: value });
          }}
          pickPrompt={t("palette.addProject.pickPrompt")}
          onProblem={setFolderProblem}
        />
      </SettingRow>

      <h2 className="settings__heading">{t("settings.group.newTasks")}</h2>

      <SettingRow
        title={t("settings.defaultHarness.title")}
        detail={t("settings.defaultHarness.detail")}
        developerNote="settings.defaults.harness"
      >
        <select
          className="select"
          value={defaultHarness}
          aria-label={t("settings.defaultHarness.title")}
          onChange={(event) =>
            props.onUpdate({ defaults: { harness: event.target.value as HarnessId } })
          }
        >
          {available.length === 0 ? (
            // An empty picker is a lie by omission: it suggests nothing is installed when the
            // truth is that we have not been told yet.
            <option value={defaultHarness}>{defaultHarness}</option>
          ) : null}
          {available.map((harness) => (
            <option key={harness.id} value={harness.id}>
              {harness.label}
              {harness.tier === "catalogued" ? ` ${t("settings.needsInstalling")}` : ""}
            </option>
          ))}
        </select>
      </SettingRow>

      {/* **Read but unsettable, until now.** `resolveTaskDefaults` has honoured `defaults.model` since
          it was written, and no control wrote one — a capability a user was told about by the docs and
          could not reach. The shapes are the composer's, from the same `ModelChoice`, so the app's
          default model, a project's default model and a task's model cannot come to mean three things. */}
      <ModelRow
        idPrefix="setting-app"
        harness={defaultHarness}
        summary={summaryFor(props.state, defaultHarness)}
        value={settings.defaults.model}
        title={t("settings.defaultModel.title")}
        detail={t("settings.defaultModel.detail")}
        developerNote="settings.defaults.model"
        onChoose={(model) => props.onUpdate({ defaults: { model } })}
      />

      {/* And its sibling, which is free text by nature: argv belongs to the agent's own CLI, and the row
          therefore has to say what it is for rather than pretend to know what is valid. */}
      <SettingRow
        title={t("settings.extraArgs.title")}
        detail={t("settings.extraArgs.detail")}
        developerNote="settings.defaults.extraArgs"
      >
        <TextSetting
          ariaLabel={t("settings.extraArgs.title")}
          value={settings.defaults.extraArgs}
          placeholder={t("settings.extraArgs.placeholder")}
          onCommit={(value) => props.onUpdate({ defaults: { extraArgs: value } })}
        />
      </SettingRow>

      <h2 className="settings__heading">{t("settings.group.safety")}</h2>

      <ApprovalRow
        state={props.state}
        harness={defaultHarness}
        checked={settings.requireApprovalForDestructive}
        onToggle={(checked) => props.onUpdate({ requireApprovalForDestructive: checked })}
      />

      <SettingRow
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
      </SettingRow>

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

      <StoreNotes notes={props.state.notes} />
    </SettingsShell>
  );
}

/* ────────────────────────────── the project scope ────────────────────────────── */

function ProjectSettings(props: SettingsPaneProps & { project: Project }): JSX.Element {
  const { t } = useI18n();
  const { project, state } = props;
  const available = state.harnesses.filter((harness) => harness.available !== false);
  const defaults = project.defaults ?? {};
  // The project's own agent decides which models it offers, exactly as the composer reads a task's.
  const harness = defaults.harness ?? state.settings.defaults.harness ?? "envoy-harness";

  /**
   * Write one of the three, **with the other two carried along**.
   *
   * A project's defaults replace rather than merge (`Store.updateProject`), so a patch that said only
   * "the agent is now DeepSeek" would silently clear that project's model. Spreading the current values
   * is what makes each control edit one thing.
   */
  const write = (patch: Partial<TaskDefaults>): void => {
    props.onUpdateProject?.({ ...defaults, ...patch });
  };

  return (
    <SettingsShell
      title={t("settings.project.title", { project: project.label })}
      ariaLabel={t("settings.project.title", { project: project.label })}
      state={state}
      onClose={props.onClose}
    >
      <p className="settings__note">{t("settings.project.detail")}</p>

      <SettingRow
        title={t("settings.project.folder.title")}
        detail={t("settings.project.folder.detail")}
        developerNote="project.path"
      >
        <span className="chip chip--quiet" title={project.path}>
          {shortPath(project.path)}
        </span>
      </SettingRow>

      <SettingRow
        title={t("settings.project.harness.title")}
        detail={t("settings.project.harness.detail")}
        developerNote="project.defaults.harness"
      >
        <select
          className="select"
          value={harness}
          aria-label={t("settings.project.harness.title")}
          onChange={(event) => write({ harness: event.target.value as HarnessId })}
        >
          {available.length === 0 || available.every((entry) => entry.id !== harness) ? (
            <option value={harness}>{labelForHarness(harness, state)}</option>
          ) : null}
          {available.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
              {entry.tier === "catalogued" ? ` ${t("settings.needsInstalling")}` : ""}
            </option>
          ))}
        </select>
      </SettingRow>

      <ModelRow
        idPrefix="setting-project"
        harness={harness}
        summary={summaryFor(state, harness)}
        value={defaults.model}
        title={t("settings.project.model.title")}
        detail={t("settings.project.model.detail")}
        developerNote="project.defaults.model"
        onChoose={(model) => write({ model })}
      />

      <SettingRow
        title={t("settings.extraArgs.title")}
        detail={t("settings.project.extraArgs.detail")}
        developerNote="project.defaults.extraArgs"
      >
        <TextSetting
          ariaLabel={t("settings.extraArgs.title")}
          value={defaults.extraArgs}
          placeholder={t("settings.extraArgs.placeholder")}
          onCommit={(value) => write({ extraArgs: value })}
        />
      </SettingRow>
    </SettingsShell>
  );
}

/* ────────────────────────────── rows with a decision in them ────────────────────────────── */

/**
 * The model a run will start on — the app's default, or a project's.
 *
 * The three shapes and the reasons are `composer/controls.ts`'s, and that is the point: this row asks
 * the *same* function the composer does, with a state that says "nothing is running and no approval is
 * waiting". A second implementation of "which shape is this control" is how the pane and the composer
 * would come to disagree about whether an agent takes a model at all — which is the one disagreement
 * that turns a supported feature into a disabled control.
 */
function ModelRow(props: {
  idPrefix: string;
  harness: HarnessId;
  summary: HarnessSummary | undefined;
  value: string | undefined;
  title: string;
  detail: string;
  developerNote: string;
  onChoose: (model: string) => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const agent = agentFor(props.harness, props.summary);
  // One call, exactly as the composer makes it — see the doc above for why that matters.
  const controls = composerControls(agent, { running: false, approvalPending: false }, {
    ...(props.value !== undefined ? { selectedModelId: props.value } : {}),
  });
  const off = modelOffReason(controls.model, {
    known: props.summary !== undefined,
    agent: agent.label,
  });
  const noteKey = modelNote(controls.model, { enabled: off === undefined });
  const at =
    controls.model.observedAt !== undefined
      ? formatWhen(controls.model.observedAt, locale)
      : undefined;

  const note =
    off !== undefined
      ? t(off.key, off.values)
      : noteKey !== undefined
        ? t(noteKey, { agent: agent.label, at: at ?? "" })
        : undefined;

  const titleId = `${props.idPrefix}-model`;

  return (
    <SettingRow
      title={props.title}
      detail={props.detail}
      developerNote={props.developerNote}
      titleId={titleId}
      note={note}
    >
      <ModelChoice
        labelId={titleId}
        kind={controls.model.kind}
        options={controls.model.options}
        selected={props.value}
        off={off}
        title={t("task.composer.model.title")}
        onChoose={props.onChoose}
      />
    </SettingRow>
  );
}

/**
 * "Ask before anything destructive" — the row the whole slice exists for.
 *
 * **What it does now.** The value is handed to the agent as its own session policy at the start of every
 * run (`session/set_policy { autoRun }`), which is the only mechanism that can change whether an agent
 * stops to ask: `envoy-harness` validates `always-confirm | safe-only | off` and its live permission hook
 * asks per tool call on the result. `true` states the fail-closed posture, `false` asks it to stop
 * asking; `resolveApprovalPolicy` in the daemon owns the mapping and records why the strict value is the
 * one for `true`.
 *
 * **What it does not do, said on screen.** Only `envoy-harness` documents such a method —
 * `deepseek-harness` registers nine ACP methods and `session/set_policy` is not among them — so when the
 * default agent is one of the others, the row is **disabled and names it**. The alternative, a live
 * switch that stores a preference no agent hears, is precisely the lie this slice removes.
 */
function ApprovalRow(props: {
  state: CoderState;
  harness: HarnessId;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}): JSX.Element {
  const { t } = useI18n();
  const summary = summaryFor(props.state, props.harness);
  const agent = summary?.label ?? harnessLabel(props.harness);
  const supported = summary?.capabilities.approvalPolicy === true;
  const note = supported
    ? t("settings.approvals.reaches", { agent })
    : summary === undefined
      ? t("settings.approvals.unknown", { agent })
      : t("settings.approvals.unsupported", { agent });

  return (
    <SettingRow
      title={t("settings.approvals.title")}
      detail={t("settings.approvals.detail")}
      developerNote="settings.requireApprovalForDestructive"
      titleId="setting-approvals"
      note={note}
    >
      <input
        type="checkbox"
        checked={props.checked}
        disabled={!supported}
        onChange={(event) => props.onToggle(event.target.checked)}
        aria-labelledby="setting-approvals"
      />
    </SettingRow>
  );
}

/* ────────────────────────────── the shell and the read-only groups ────────────────────────────── */

function SettingsShell(props: {
  title: string;
  ariaLabel: string;
  state: CoderState;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section className="pane" aria-label={props.ariaLabel}>
      <header className="pane__header">
        <div className="pane__title-group">
          <h1 className="pane__title">{props.title}</h1>
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
      <div className="settings">{props.children}</div>
    </section>
  );
}

/**
 * The daemon's own sentences — what it could not read, and what it did about it.
 *
 * Not a setting, and deliberately below every control: it is the one part of this pane that says what
 * happened without offering a switch that pretends to fix it. A note is rendered through its key when
 * the daemon sent one, so a quarantined file is explained in German with the parse error it cited left
 * as it is.
 */
function StoreNotes(props: { notes: readonly string[] }): JSX.Element | null {
  const { t } = useI18n();
  if (props.notes.length === 0) return null;
  return (
    <>
      <h2 className="settings__heading">{t("settings.notes.heading")}</h2>
      <ul className="settings__notes">
        {props.notes.map((note) => (
          <li key={note}>{localizeText(t, note)}</li>
        ))}
      </ul>
    </>
  );
}

/* ────────────────────────────── formatting ────────────────────────────── */

function summaryFor(state: CoderState, harness: HarnessId): HarnessSummary | undefined {
  return state.harnesses.find((entry) => entry.id === harness);
}

function labelForHarness(harness: HarnessId, state: CoderState): string {
  return summaryFor(state, harness)?.label ?? harnessLabel(harness);
}

/** Home directories are long and the middle is the interesting part; keep the tail. */
function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}
