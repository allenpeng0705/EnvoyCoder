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
 * ## Three scopes and three levels, and what separates them
 *
 * The reference product has two settings scopes; this product has three (`CoderSettings` is the app's,
 * `Project.defaults` is a project's, and a task carries its own resolved copy). The app's are here; a
 * project's are here too, in the same pane, reached from the project's ⋯ button — because that button
 * used to open *app* settings and drop the project on the floor, which is the same defect in the UI
 * layer: a control labelled with a scope it did not have.
 *
 * The levels are the **navigation depth** of that model, and they exist because a list of every project
 * does not scale inside a page of settings: with thirty projects the app scope becomes thirty rows of
 * someone else's folders between "Keep transcripts" and the agent list. So the list is its own level —
 * the same thing Paseo does, where a section is a page with a back affordance rather than a block of
 * rows on the page you were reading.
 *
 * | level | title | reached from | back control |
 * |---|---|---|---|
 * | 1 — this machine's settings | *Settings* | the rail's footer button, or `⌘,` | none: it is the root |
 * | 2 — the projects page | *Projects* | the **Projects** row at level 1 | *← All settings* (level 1) |
 * | 3 — one project's settings | *Project settings for api* | a row of level 2, or the rail's `…` menu | *← Projects* (level 2) |
 *
 * **Each back control names its destination**, and the two differ because their destinations differ: a
 * back control that said "All settings" while landing on the list of projects would be a lie of exactly
 * the kind this pane was rebuilt to remove. Level 2's is the existing `settings.back` pair — that *is*
 * the way back to the app scope, and it is where it always pointed. Level 3's label is not a new string
 * at all: it is the level-2 page's own title, which is the same rule the project rows use for their
 * accessible names — one place, one name.
 *
 * ## How the levels are wired together, which is one model and not two
 *
 * `settings-scope.ts` owns the state, and `CoderApp` holds one value of it: `SettingsScope | undefined`,
 * where `undefined` is "the pane is closed". So "which level" and "is it open" are one piece of data
 * rather than a boolean beside a payload, and this pane takes the scope as a prop together with **one**
 * callback (`onNavigate`) instead of a callback per destination. The pane says where a press goes by
 * naming the level — `APP_SCOPE`, `PROJECTS_SCOPE`, `projectScope(id)` — and the shell stores it.
 *
 * That leaves exactly two routes into a project's settings, the rail's project `…` menu (*"Project
 * settings"*) and a row of the projects page, both of which are the **same** function
 * (`CoderApp`'s `openProjectSettings`): the only arrangement in which they cannot come to mean
 * different things. Leaving is symmetric: the back controls and the Close button all work.
 *
 * `onNavigate` is a **required** prop. An optional one would allow a caller to render rows that press
 * into nothing, and this pane's entire history is a list of controls that did not do what they said.
 *
 * ## What happens when the project is gone, and why it is the projects page
 *
 * The pane resolves the scope against `state.projects` on **every render**, so a project removed while
 * its settings are open — in another window, or from its own `…` menu in this one — cannot leave the
 * pane showing rows that write to something that is not there. It lands on the **projects page**: the
 * level the project scope's own back control returns to, so the rule is the one sentence a user
 * already knows ("when the thing you are looking at disappears, the pane does what the back control
 * would have done"). Not the app scope, which would skip a level and leave the user reading this
 * machine's defaults with no list in front of them to pick the project they meant.
 * `settings-scope.ts`'s module doc is the full argument, and `test/settings-scope.test.tsx` asserts it
 * both ways: removed deliberately from the row menu, and vanished from the list underneath the pane.
 *
 * ## What this pane does with many projects
 *
 * Nothing clever: level 2 is a plain list, one row per project, in the pane's own scrolling body — no
 * virtual list, no paging, no search. The body is the part that scrolls and the header stays put, which
 * is what makes a long list usable and is measured rather than asserted (`docs/settings-parity.md`
 * §7.5). A window with thirty projects scrolls; a window with three hundred would want a filter, and
 * that is the day to build one.
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

import type { JSX } from "react";
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
import type { Translator } from "../i18n/translate.js";
import { formatWhen } from "../i18n/when.js";
import type { CoderState } from "../state/coderStore.js";
import {
  APP_SCOPE,
  PROJECTS_SCOPE,
  projectScope,
  resolveScope,
  scopeProject,
  type SettingsScope,
} from "../state/settings-scope.js";
import { ModelChoice } from "./ModelChoice.js";
import { SettingsShell, StoreNotes, shortPath } from "./SettingsShell.js";
import { FolderSetting, SettingNavRow, SettingRow, TextSetting } from "./SettingsRows.js";

export interface SettingsPaneProps {
  state: CoderState;
  onClose: () => void;
  /** The app-scope patch. Ignored while the pane is open for a project. */
  onUpdate: (patch: Partial<CoderSettings>) => void;
  /**
   * Which level the pane is showing — this machine's settings, the projects page, or one project's.
   *
   * Held by the shell (`CoderApp`) and resolved **here**, against `state.projects`, on every render.
   * The id in a `project` scope is what makes a second edit carry the first (`settings-scope.ts`), and
   * resolving it here rather than in the shell means there is one place that decides what an absent
   * project shows. A `Project` object in this position could not do either.
   */
  scope: SettingsScope;
  /**
   * Go to another level of this pane, by naming it.
   *
   * One callback rather than one per destination: a row that goes somewhere says *where*, as data, and
   * this is what stores it. **Required, and not merely present** — an optional callback would let a
   * caller render the Projects row, or the list of projects, without a destination, which is the defect
   * this pane was rebuilt to remove: a control that does not do what it says. The shell always knows
   * where each level is (`settings-scope.ts`), so there is no honest caller without one.
   */
  onNavigate: (scope: SettingsScope) => void;
  /**
   * Write a project's defaults. Sent **whole** rather than as a patch, because a project's defaults
   * replace: a patch carrying only a model would leave the agent for that project undefined.
   */
  onUpdateProject?: ((defaults: TaskDefaults) => void) | undefined;
  /**
   * Why `state.projects` is empty for a reason other than "nobody has added one" — the shell's own
   * sentence, already in the user's language, or `undefined` when the list really is empty (or is still
   * arriving).
   *
   * **Optional, because it is data rather than a destination.** An absent destination is a control that
   * presses into nothing, which is why `onNavigate` is required; an absent reason simply means there is no
   * reason to give, and a caller with nothing to say must not have to invent one.
   *
   * It is a prop rather than something this pane derives from `state` on purpose: the rail and this pane
   * make the same claim about the same list, and two derivations of "why is it empty" are two answers that
   * can come apart — the rail reading "could not read your projects" beside a count band reading "No
   * projects". `CoderApp` computes it once and hands it to both (`projectsUnavailable`).
   */
  projectsUnavailable?: string | undefined;
}

/**
 * The three levels, chosen by the scope.
 *
 * The `switch` is exhaustive on purpose: a fourth level would not compile until it was answered here,
 * which is the property a boolean could not have.
 */
export function SettingsPane(props: SettingsPaneProps): JSX.Element {
  const resolved = resolveScope(props.scope, props.state.projects);
  switch (resolved.kind) {
    case "projects":
      return <ProjectsSettings {...props} />;
    case "project": {
      const project = scopeProject(resolved, props.state.projects);
      // `resolveScope` answers `project` only for an id the live list holds, so the fallback here is
      // unreachable — and it falls back the *same way* rather than asserting, so a list that changed
      // between the two reads cannot crash a window.
      return project !== undefined ? (
        <ProjectSettings {...props} project={project} />
      ) : (
        <ProjectsSettings {...props} />
      );
    }
    case "app":
      return <AppSettings {...props} />;
  }
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

      <h2 className="settings__heading">{t("settings.group.projects")}</h2>
      {/* **The row that gives the projects their own level.** With three projects the list fits here and
          with thirty it does not: thirty rows of someone else's folders between "Keep transcripts" and
          the agent list is not a section, it is the page. So level 1 carries one row — its second band
          is the count, which is the fact a user wants before deciding to go in — and the list itself is
          level 2 (`ProjectsSettings` below).
          It says how many and goes there. Nothing else about this scope changed, and the note that used
          to sit here ("selecting one opens its own") moved to level 2 with the list, because that is
          where selecting one is what happens.
          **A count is a claim about the list, which is why this band is four strings and not one
          interpolated `{count} projects`**: "40 projects", "1 project", "No projects", and — when the
          window could not read the list at all — "Could not be read", because "No projects" over a list
          nobody read is the rail's own historical defect wearing a different hat. */}
      <SettingNavRow
        title={t("settings.projects.title")}
        detail={projectsCount(t, props.state.projects.length, props.projectsUnavailable)}
        // The developer fact: the method whose answer the count is, which is the number a support
        // question about a missing project turns on.
        developerNote="coder.listProjects"
        // The destination's own title — the same key the level-2 heading uses — so the row announces
        // where it goes rather than only how many things are there.
        actionLabel={t("settings.projects.title")}
        onSelect={() => props.onNavigate(PROJECTS_SCOPE)}
      />

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

/* ────────────────────────────── the projects page ────────────────────────────── */

/**
 * Level 2: the list of projects, and nothing else.
 *
 * This is the block that used to sit at the end of level 1, moved one level down unchanged — the same
 * rows, the same two bands, the same accessible names, the same empty state — because its shape was
 * never the problem. Its *address* was: a list that grows with the number of projects belongs on a page
 * of its own, not between two settings.
 *
 * It is still navigation and only navigation: a project's own controls (folder, agent, model, arguments)
 * live at level 3, because a control that edits a project while the pane is titled "Projects" is a
 * control labelled with a scope it does not have.
 *
 * **With many projects, the body scrolls.** No virtual list, no paging, no cap: the rows are plain
 * `<li>`s in the pane's scrolling body (`.settings`, `overflow-y: auto`), which is what keeps the
 * header — and the back control in it — on screen while the list moves under it. That is measured in a
 * real window rather than asserted here (§7.5 of `docs/settings-parity.md` has the numbers); the point
 * at which a plain list stops being enough is a filter, and that is a later decision than this one.
 */
function ProjectsSettings(props: SettingsPaneProps): JSX.Element {
  const { t } = useI18n();
  const projects = props.state.projects;

  return (
    <SettingsShell
      title={t("settings.projects.title")}
      ariaLabel={t("settings.projects.title")}
      state={props.state}
      // The way back to the root, and it names it — "All settings", the destination rather than the
      // direction. This is the same label and the same pair of keys the project scope used to carry;
      // what changed is which level owns it, because level 3 now returns *here* and has to say so.
      back={{
        label: t("settings.back"),
        title: t("settings.back.title"),
        onClick: () => props.onNavigate(APP_SCOPE),
      }}
      onClose={props.onClose}
    >
      <p className="settings__note">{t("settings.projects.note")}</p>
      {projects.length === 0 && props.projectsUnavailable !== undefined ? (
        // **Not the empty state.** The page reached with a list nobody could read must not teach what a
        // project is — that sentence answers "why is this empty?" and the honest answer is "it is not
        // empty, it is unknown". The two keys are the rail's (`sidebar.empty.cannotLoad*`) rather than
        // copies: the rail says this about the same list in the same window, and a second copy would be a
        // second thing to keep translated and true. A `sidebar.*` key rendered in the pane is the same
        // reuse `settings.projects.empty` already makes of `sidebar.footer.add`.
        <>
          <p className="settings__note">{t("sidebar.empty.cannotLoadTitle")}</p>
          <p className="settings__note">{t("sidebar.empty.cannotLoadBody")}</p>
          <p className="settings__note">{props.projectsUnavailable}</p>
        </>
      ) : projects.length === 0 ? (
        // Design law 6, at the one place in this pane a user can arrive at nothing: the page says how a
        // project gets here instead of rendering an empty box. It names the rail's own control through
        // that control's label (`sidebar.footer.add`), so renaming or translating the button cannot leave
        // this sentence pointing at a word that is not on screen.
        <p className="settings__note">{t("settings.projects.empty", { add: t("sidebar.footer.add") })}</p>
      ) : (
        <ul className="settings__projects">
          {projects.map((project) => (
            <li key={project.id}>
              <SettingNavRow
                title={project.label}
                // The second line is the path, abbreviated the way the project scope abbreviates it
                // (`shortPath`), with the whole path on hover: two projects called `api` are told apart
                // by where they live, and the tail is the part that differs.
                detail={shortPath(project.path)}
                detailTitle={project.path}
                developerNote={project.id}
                // The destination's own title, so the row announces where it goes rather than only what
                // it shows. Same key as the level-3 heading, which is the point: one name for one place.
                actionLabel={t("settings.project.title", { project: project.label })}
                onSelect={() => props.onNavigate(projectScope(project.id))}
              />
            </li>
          ))}
        </ul>
      )}
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
      // The way back, and the reason it is in the header rather than at the end of the rows: the scope
      // was entered *from* the list of projects (the row that named this project, or the rail's project
      // menu), so leaving it belongs where the pane says where you are. It names its destination —
      // **"Projects"**, the level-2 page's own title, not "All settings" and not "Back" — because a
      // control named after the direction you are moving is one a user has to press to find out what it
      // does, and because "All settings" here would be a lie: it lands on the list, not on the root.
      // Reusing the page's title as the label is the same rule the project rows follow for their
      // accessible names: one place, one name.
      back={{
        label: t("settings.projects.title"),
        title: t("settings.project.back.title"),
        onClick: () => props.onNavigate(PROJECTS_SCOPE),
      }}
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

/* ────────────────────────────── formatting ────────────────────────────── */

function summaryFor(state: CoderState, harness: HarnessId): HarnessSummary | undefined {
  return state.harnesses.find((entry) => entry.id === harness);
}

function labelForHarness(harness: HarnessId, state: CoderState): string {
  return summaryFor(state, harness)?.label ?? harnessLabel(harness);
}

/**
 * How many projects, in words — the second band of the level-1 row.
 *
 * Three keys rather than one interpolated `{count} projects`, because "1 projects" and "0 projects" are
 * the two forms every language gets wrong and neither is fixable by a formatter the catalogue does not
 * have: a translator needs "1 project" and "No projects" as sentences of their own, and Japanese and
 * Korean do not pluralise at all (their forms differ from the English ones, which is the point). The
 * zero form is a sentence rather than a number with a noun after it for the same reason the empty state
 * is: "No projects" is what a person says.
 */
function projectsCount(t: Translator["t"], count: number, unavailable?: string): string {
  // The list could not be read: a number is a claim this window cannot make, and the honest band is the
  // one that says so. (`unavailable` is the shell's own sentence about the same list — this band needs a
  // short form of it, and the full sentence plus the reason are on level 2.)
  if (count === 0 && unavailable !== undefined) return t("settings.projects.count.unknown");
  if (count === 0) return t("settings.projects.count.none");
  if (count === 1) return t("settings.projects.count.one");
  return t("settings.projects.count", { count });
}
