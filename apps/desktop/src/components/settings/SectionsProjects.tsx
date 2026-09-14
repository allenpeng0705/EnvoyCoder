/**
 * The two pages of the **Projects** section: the list of registered projects, and one project's own
 * defaults.
 *
 * ## Why a section is a list and a level below it
 *
 * A list that grows with the number of projects does not belong inside a page of settings: with thirty
 * projects it is thirty rows of someone else's folders between two controls a user came for. So the
 * Projects item in the bar carries **how many** (its second band) and opens the list, and a row of the
 * list opens *that* project's defaults. The reference product has the same shape — a section whose rows
 * are the way into a per-project screen — and this is our version of it, with the difference that our
 * third level is the pane's own scope rather than a route of its own.
 *
 * ## The list is navigation and only navigation
 *
 * A project's controls (folder, agent, model, arguments) live at the project scope, because a control
 * that edits a project while the pane is titled *Projects* is a control labelled with a scope it does
 * not have — the defect this pane was rebuilt to remove, in the layer it was actually shipped in.
 *
 * ## A count is a claim about the list
 *
 * `state.projects` is an empty array for two different reasons — nobody has added a project, or this
 * window never managed to read them — so the page never says "No projects" over a list nobody read: it
 * says the rail's own sentence about the same value (`projectsUnavailable`), which is computed once in
 * the shell and handed to both surfaces. The teaching empty state is only for the case where the answer
 * really is "there are none".
 */

import type { JSX } from "react";

import type { HarnessId, Project, TaskDefaults } from "@envoycoder/protocol";

import { useI18n } from "../../i18n/context.js";
import type { SettingsScope } from "../../state/settings-scope.js";
import { projectScope } from "../../state/settings-scope.js";
import { SettingNavRow, SettingRow, TextSetting } from "../SettingsRows.js";
import { shortPath } from "../SettingsShell.js";
import type { SettingsSectionProps } from "./SectionProps.js";
import { labelForHarness, ModelRow, summaryFor } from "./SettingsRowParts.js";

/** What the two project pages need beyond the settings they share: the live list, and the way down. */
export interface ProjectSectionProps extends SettingsSectionProps {
  projects: readonly Project[];
  projectsUnavailable?: string | undefined;
  /** The pane's own navigation — a row says *where* it goes and the shell stores it. */
  onNavigate: (scope: SettingsScope) => void;
  /**
   * Write a project's defaults, **whole** rather than as a patch, because a project's defaults replace:
   * a patch carrying only a model would leave that project's agent undefined.
   */
  onUpdateProject?: ((defaults: TaskDefaults) => void) | undefined;
}

/**
 * The list of projects.
 *
 * With many projects the body scrolls under a header that stays put — no virtual list, no paging, no
 * cap. The scrolling half of that is measured in a real window rather than asserted here (jsdom has no
 * layout to measure), and the point at which a plain list stops being enough is a filter, which is a
 * later decision than this one.
 */
export function ProjectsSection(props: ProjectSectionProps): JSX.Element {
  const { t } = useI18n();
  const projects = props.projects;

  return (
    <>
      <p className="settings__note">{t("settings.projects.note")}</p>
      {projects.length === 0 && props.projectsUnavailable !== undefined ? (
        // **Not the empty state.** The page reached with a list nobody could read must not teach what a
        // project is — that sentence answers "why is this empty?" and the honest answer is "it is not
        // empty, it is unknown". The two keys are the rail's (`sidebar.empty.cannotLoad*`) rather than
        // copies: the rail says this about the same list in the same window, and a second copy would be
        // a second thing to keep translated and true.
        <>
          <p className="settings__note">{t("sidebar.empty.cannotLoadTitle")}</p>
          <p className="settings__note">{t("sidebar.empty.cannotLoadBody")}</p>
          <p className="settings__note">{props.projectsUnavailable}</p>
        </>
      ) : projects.length === 0 ? (
        // Design law 6, at the one place in this pane a user can arrive at nothing: the page says how a
        // project gets here instead of rendering an empty box. It names the rail's own control through
        // that control's label (`sidebar.footer.add`), so renaming or translating the button cannot
        // leave this sentence pointing at a word that is not on screen.
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
                // it shows. Same key as the project page's heading, which is the point: one name for one
                // place, and the same rule the bar's items follow.
                actionLabel={t("settings.project.title", { project: project.label })}
                onSelect={() => props.onNavigate(projectScope(project.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * One project's defaults — the third level, reached from the list or from the rail's project menu.
 *
 * The two routes are one function in the shell (`openProjectSettings`), which is the only arrangement
 * in which they cannot come to mean different things.
 */
export function ProjectSection(props: ProjectSectionProps & { project: Project }): JSX.Element {
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
   * is what makes each control edit one thing — and the reason this page reads the *live* project
   * (`scopeProject`) rather than the object the row was clicked with.
   */
  const write = (patch: Partial<TaskDefaults>): void => {
    props.onUpdateProject?.({ ...defaults, ...patch });
  };

  return (
    <>
      <p className="settings__note">{t("settings.project.detail")}</p>

      {/* The folder is a fact about the project, not a control: a project's path is what identifies it,
          and moving it would be a different project. It is rendered so the page says which folder these
          defaults belong to. */}
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
    </>
  );
}
