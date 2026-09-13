/**
 * The window shell: rail on the left, work on the right, status at the foot.
 *
 * The regions are Paseo's, because they are the ones users already know: a collapsible left rail,
 * a tab strip across the work area, panes inside it, and a status line. Two things are
 * deliberately *not* Paseo's:
 *
 *   * the **rail is the project tree** (see `CoderSidebar`), not a flat task list;
 *   * the **status line names the mesh**, because this product's distinguishing feature is that
 *     your other machines are part of it. A Paseo-like shell has nothing to put there; we do, and
 *     "am I attached to the mesh, and as whom" is a question a distributed control plane should
 *     answer without opening settings.
 */

import type { JSX } from "react";

import { useMemo, useState } from "react";
import type { Project, Workspace } from "@envoycoder/protocol";
import { CoderSidebar } from "./CoderSidebar.js";
import { WorkspacePane } from "./WorkspacePane.js";
import { MeshStatusBar } from "./MeshStatusBar.js";
import type { MeshAttachment } from "../state/useCoderState.js";

export interface CoderAppProps {
  projects: readonly Project[];
  workspaces: readonly Workspace[];
  /** What the mesh looks like right now, as the daemon last reported it. */
  mesh: MeshAttachment;
  /** How many windows are open, including this one (multi-window is a first-class mode). */
  windowCount: number;
}

export function CoderApp(props: CoderAppProps): JSX.Element {
  const [activeId, setActiveId] = useState<string | undefined>(props.workspaces[0]?.id);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);

  const active = useMemo(
    () => props.workspaces.find((workspace) => workspace.id === activeId),
    [props.workspaces, activeId],
  );

  return (
    <div className={`shell${railOpen ? "" : " shell--rail-hidden"}`}>
      <header className="titlebar">
        <button
          type="button"
          className="button button--ghost button--icon"
          aria-label={railOpen ? "Hide projects" : "Show projects"}
          onClick={() => setRailOpen((value) => !value)}
          title="Toggle the project rail"
        >
          ▤
        </button>
        <span className="titlebar__title">EnvoyCoder</span>
        <span className="titlebar__spacer" />
        {props.windowCount > 1 ? (
          <span className="chip chip--quiet" title="This daemon serves every EnvoyCoder window">
            {props.windowCount} windows
          </span>
        ) : null}
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setPaletteOpen(true)}
          title="Command Center"
        >
          Command Center
        </button>
      </header>

      <div className="shell__body">
        {railOpen ? (
          <CoderSidebar
            projects={props.projects}
            workspaces={props.workspaces}
            activeWorkspaceId={activeId}
            onSelect={setActiveId}
            onNewWorkspace={() => setPaletteOpen(true)}
            onAddProject={() => setPaletteOpen(true)}
            onOpenProjectSettings={() => setPaletteOpen(true)}
            onOpenCommandCenter={() => setPaletteOpen(true)}
            onOpenSettings={() => setPaletteOpen(true)}
          />
        ) : null}

        <main className="work">
          {active ? (
            <WorkspacePane workspace={active} project={projectFor(props.projects, active)} />
          ) : (
            <div className="work__empty">
              <h2>No task open</h2>
              <p>
                Pick a task on the left, or start one in a project. Agents run on this machine and,
                when the mesh is attached, on your other machines too.
              </p>
            </div>
          )}
        </main>
      </div>

      <MeshStatusBar mesh={props.mesh} />

      {paletteOpen ? (
        <div
          className="palette-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Command Center"
          onClick={() => setPaletteOpen(false)}
        >
          <div className="palette" onClick={(event) => event.stopPropagation()}>
            <input className="input palette__input" placeholder="Type a command or a path" autoFocus />
            <ul className="palette__list">
              <li className="palette__item">
                <strong>New task…</strong>
                <span className="palette__hint">Start an agent in a project</span>
              </li>
              <li className="palette__item">
                <strong>Add project…</strong>
                <span className="palette__hint">Register a directory you work in</span>
              </li>
              <li className="palette__item">
                <strong>Pair a phone</strong>
                <span className="palette__hint">Show a QR code for the mobile app</span>
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function projectFor(projects: readonly Project[], workspace: Workspace): Project | undefined {
  return projects.find((project) => project.id === workspace.projectId);
}
