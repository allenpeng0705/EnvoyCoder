/**
 * Project + task tree used by both This machine and a paired home on the rail.
 *
 * Same chrome (mark, chevron, TaskRow, + New) in both places so a paired home does not look like a
 * second product. Empty / unread copy stays the same sentences as the local rail.
 */

import { Fragment, type Dispatch, type JSX, type SetStateAction } from "react";
import {
  type AgentId,
  type AgentProviderSummary,
  type CatalogEntry,
  type HarnessSummary,
  type Job,
  type Project,
  type TaskDefaults,
  isHarnessId,
} from "@envoydev/protocol";
import type { ProjectGroup } from "@envoydev/task-model";

import { harnessBadge } from "../composer/harness-label.js";
import { useT } from "../i18n/context.js";
import { localize, type Notice, type Refusal } from "../i18n/notice.js";
import type { GitSnapshot } from "../state/coderStore.js";
import { ProjectAgentPicker } from "./ProjectAgentPicker.js";
import { ProjectBranches } from "./ProjectBranches.js";
import { RowMenu } from "./RowMenu.js";

export function projectMark(label: string): string {
  const letter = label.trim().charAt(0);
  return letter === "" ? "?" : letter.toUpperCase();
}

const MARK_TONES = ["violet", "sky", "emerald", "orange", "pink", "indigo", "teal", "red", "amber", "blue"] as const;

export function projectMarkTone(id: string): (typeof MARK_TONES)[number] {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return MARK_TONES[hash % MARK_TONES.length] ?? "violet";
}

export interface ProjectListProps {
  groups: readonly ProjectGroup[];
  jobs?: readonly Job[];
  query: string;
  projectsEmpty: boolean;
  unavailable?: string | undefined;
  tasksUnknown?: boolean | undefined;
  collapsed: readonly string[];
  setCollapsed: Dispatch<SetStateAction<readonly string[]>>;
  activeTaskId?: string | undefined;
  activeJobId?: string | undefined;
  listTestId?: string;
  compact?: boolean;
  /**
   * Prefix for collapse keys so This machine and paired homes do not share one open/closed set
   * when project ids collide across daemons.
   */
  collapseKeyPrefix?: string;
  onActivateProject?: (projectId: string) => void;
  onSelect: (taskId: string) => void;
  onSelectJob?: (jobId: string) => void;
  onNewTask: (projectId: string) => void;
  onTeamJob?: (projectId: string) => void;
  onOpenProjectSettings: (project: Project) => void;
  onChangeProjectAgent?: (
    project: Project,
    defaults: TaskDefaults,
  ) => Promise<{ ok: true } | Refusal>;
  git?: Readonly<Record<string, GitSnapshot>>;
  onReadGit?: (projectId: string) => Promise<{ ok: true } | Refusal>;
  onGitCheckout?: (projectId: string, branch: string) => Promise<{ ok: true } | Refusal>;
  onGitCreateBranch?: (projectId: string, name: string) => Promise<{ ok: true } | Refusal>;
  onGitMerge?: (projectId: string, branch: string) => Promise<{ ok: true; into?: string } | Refusal>;
  onGitFetch?: (projectId: string) => Promise<{ ok: true; summary: string } | Refusal>;
  onGitPull?: (projectId: string) => Promise<{ ok: true; summary: string } | Refusal>;
  onGitResolveMerge?: CoderSidebarGitResolve;
  onGitMergeContinue?: (projectId: string) => Promise<{ ok: true; sha: string } | Refusal>;
  onGitMergeAbort?: (projectId: string) => Promise<{ ok: true } | Refusal>;
  harnesses?: readonly HarnessSummary[];
  providers?: readonly AgentProviderSummary[];
  catalog?: readonly CatalogEntry[];
  appHarness?: AgentId;
  onOpenProjectInNewWindow?: ((project: Project) => void) | undefined;
  onRemoveProject: (projectId: string) => void;
  onRenameTask: (taskId: string, title: string) => void;
  onChangeTaskHarness?: (taskId: string, harness: AgentId) => void;
  onRemoveTask: (taskId: string) => void;
  failure?: { rowId: string; notice: Notice } | undefined;
  TaskRow: (input: {
    row: ProjectGroup["rows"][number];
    active: boolean;
    onSelect: (taskId: string) => void;
    onRenameTask: (taskId: string, title: string) => void;
    onChangeTaskHarness?: (taskId: string, harness: AgentId) => void;
    onRemoveTask: (taskId: string) => void;
    harnesses?: readonly HarnessSummary[];
    providers?: readonly AgentProviderSummary[];
    catalog?: readonly CatalogEntry[];
  }) => JSX.Element;
}

type CoderSidebarGitResolve = (
  projectId: string,
  branch: string,
) => Promise<
  | { ok: true; outcome: "merged"; into?: string }
  | { ok: true; outcome: "resolving"; task: string }
  | Refusal
>;

export function ProjectList(props: ProjectListProps): JSX.Element {
  const t = useT();
  const TaskRow = props.TaskRow;
  const collapseKey = (projectId: string): string =>
    props.collapseKeyPrefix ? `${props.collapseKeyPrefix}${projectId}` : projectId;
  const empty = (
    <div className="sidebar__empty">
      {props.unavailable !== undefined ? (
        <>
          <p className="sidebar__empty-title">{t("sidebar.empty.cannotLoadTitle")}</p>
          <p className="sidebar__empty-body">{t("sidebar.empty.cannotLoadBody")}</p>
          <p className="sidebar__empty-reason">{props.unavailable}</p>
        </>
      ) : props.projectsEmpty ? (
        <>
          <p className="sidebar__empty-title">{t("sidebar.empty.title")}</p>
          <p className="sidebar__empty-body">{t("sidebar.empty.body")}</p>
        </>
      ) : (
        <p className="sidebar__empty-body">{t("sidebar.empty.noMatch", { query: props.query })}</p>
      )}
    </div>
  );

  return (
    <div
      className={props.compact ? "sidebar__paired-list" : "sidebar__list"}
      data-testid={props.listTestId}
    >
      {props.groups.length === 0 ? (
        props.compact ? null : empty
      ) : (
        props.groups.map((group) => {
          const key = collapseKey(group.project.id);
          const isCollapsed = props.collapsed.includes(key);
          const projectJobs = (props.jobs ?? []).filter((job) => job.projectId === group.project.id);
          return (
            <section
              key={group.project.id}
              className="project"
              data-testid={`project-${group.project.label}`}
            >
              <div className="project__header-row">
                <button
                  type="button"
                  className="project__header"
                  aria-expanded={!isCollapsed}
                  title={group.project.path}
                  onClick={() => {
                    props.onActivateProject?.(group.project.id);
                    props.setCollapsed((current) =>
                      current.includes(key)
                        ? current.filter((id) => id !== key)
                        : [...current, key],
                    );
                  }}
                >
                  <span className="project__chevron" aria-hidden>
                    {isCollapsed ? "▶" : "▼"}
                  </span>
                  <span className="project__mark" data-tone={projectMarkTone(group.project.id)} aria-hidden>
                    {projectMark(group.project.label)}
                  </span>
                  <span className="project__label">{group.project.label}</span>
                  {group.counts.needsAttention > 0 ? (
                    <span className="badge badge--warn" title={t("sidebar.project.attention")}>
                      {group.counts.needsAttention}
                    </span>
                  ) : null}
                </button>
                {props.onChangeProjectAgent !== undefined && props.harnesses !== undefined ? (
                  <ProjectAgentPicker
                    project={group.project}
                    appHarness={props.appHarness ?? "envoy-harness"}
                    harnesses={props.harnesses}
                    {...(props.providers !== undefined ? { providers: props.providers } : {})}
                    {...(props.catalog !== undefined ? { catalog: props.catalog } : {})}
                    appearance="rail"
                    onChoose={(defaults) => props.onChangeProjectAgent!(group.project, defaults)}
                  />
                ) : (
                  <span className="project__agent" title={t("sidebar.project.agent")}>
                    {isHarnessId(group.defaultHarness)
                      ? harnessBadge(group.defaultHarness)
                      : group.defaultHarness}
                  </span>
                )}
                {props.onReadGit !== undefined &&
                props.onGitCheckout !== undefined &&
                props.onGitCreateBranch !== undefined &&
                props.onGitMerge !== undefined &&
                props.onGitFetch !== undefined &&
                props.onGitPull !== undefined &&
                props.onGitResolveMerge !== undefined &&
                props.onGitMergeContinue !== undefined &&
                props.onGitMergeAbort !== undefined ? (
                  <ProjectBranches
                    project={group.project}
                    snapshot={props.git?.[group.project.id]}
                    onRead={() => props.onReadGit!(group.project.id)}
                    onCheckout={(branch) => props.onGitCheckout!(group.project.id, branch)}
                    onCreate={(name) => props.onGitCreateBranch!(group.project.id, name)}
                    onMerge={(branch) => props.onGitMerge!(group.project.id, branch)}
                    onFetch={() => props.onGitFetch!(group.project.id)}
                    onPull={() => props.onGitPull!(group.project.id)}
                    onResolve={(branch) => props.onGitResolveMerge!(group.project.id, branch)}
                    onFinishMerge={() => props.onGitMergeContinue!(group.project.id)}
                    onAbortMerge={() => props.onGitMergeAbort!(group.project.id)}
                  />
                ) : null}
                <RowMenu
                  label={t("sidebar.project.menu.aria", { project: group.project.label })}
                  title={t("sidebar.project.menu.title")}
                  actions={[
                    {
                      id: "settings",
                      label: t("sidebar.project.settings"),
                      onSelect: () => props.onOpenProjectSettings(group.project),
                    },
                    {
                      id: "new-task",
                      label: t("sidebar.project.menu.newTask"),
                      onSelect: () => props.onNewTask(group.project.id),
                    },
                    ...(props.onTeamJob
                      ? [
                          {
                            id: "team-job",
                            label: t("sidebar.project.menu.teamJob"),
                            onSelect: () => props.onTeamJob?.(group.project.id),
                          },
                        ]
                      : []),
                    ...(props.onOpenProjectInNewWindow
                      ? [
                          {
                            id: "open-new-window",
                            label: t("sidebar.project.menu.openNewWindow"),
                            onSelect: () => props.onOpenProjectInNewWindow?.(group.project),
                          },
                        ]
                      : []),
                  ]}
                  confirm={{
                    label: t("sidebar.project.remove"),
                    ariaLabel: t("sidebar.project.remove.aria"),
                    question: t("sidebar.project.remove.confirm", { project: group.project.label }),
                    cta: t("sidebar.project.remove.cta"),
                    onConfirm: () => props.onRemoveProject(group.project.id),
                  }}
                />
              </div>

              {props.failure?.rowId === group.project.id ? (
                <p className="sidebar__failure" role="status">
                  {localize(t, props.failure.notice)}
                </p>
              ) : null}

              {isCollapsed ? null : (
                <>
                  <div className="project__tasks-bar">
                    <span className="project__tasks-title">{t("sidebar.section.tasks")}</span>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => props.onNewTask(group.project.id)}
                      title={t("sidebar.project.newTask.title", { project: group.project.label })}
                    >
                      {t("sidebar.project.newTask")}
                    </button>
                  </div>
                  {group.rows.map((row) => (
                    <Fragment key={row.task.id}>
                      <TaskRow
                        row={row}
                        active={row.task.id === props.activeTaskId}
                        onSelect={props.onSelect}
                        onRenameTask={props.onRenameTask}
                        onChangeTaskHarness={props.onChangeTaskHarness}
                        onRemoveTask={props.onRemoveTask}
                        harnesses={props.harnesses}
                        providers={props.providers}
                        catalog={props.catalog}
                      />
                      {props.failure?.rowId === row.task.id ? (
                        <p className="sidebar__failure" role="status">
                          {localize(t, props.failure.notice)}
                        </p>
                      ) : null}
                    </Fragment>
                  ))}
                  {group.rows.length === 0 && props.tasksUnknown !== true ? (
                    <p className="project__empty">{t("sidebar.tasks.empty")}</p>
                  ) : null}
                  {projectJobs.length === 0 ? null : (
                    <>
                      <div
                        className="project__tasks-bar"
                        data-testid={`project-team-jobs-${group.project.id}`}
                      >
                        <span className="project__tasks-title">{t("sidebar.section.teamJobs")}</span>
                        {props.onTeamJob ? (
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            data-testid={`team-job-${group.project.id}`}
                            onClick={() => props.onTeamJob?.(group.project.id)}
                            title={t("sidebar.project.teamJob.title", {
                              project: group.project.label,
                            })}
                          >
                            {t("sidebar.project.teamJob")}
                          </button>
                        ) : null}
                      </div>
                      <ul className="sidebar__job-rows" data-testid={`job-list-${group.project.id}`}>
                        {projectJobs.map((job) => (
                          <li key={job.id}>
                            <button
                              type="button"
                              className={
                                props.activeJobId === job.id
                                  ? "sidebar__task sidebar__task--active"
                                  : "sidebar__task"
                              }
                              onClick={() => props.onSelectJob?.(job.id)}
                            >
                              <span className="dot" data-status={job.status} aria-hidden />
                              <span className="sidebar__task-title">{job.title}</span>
                              <span className="sidebar__task-meta">{job.status}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
