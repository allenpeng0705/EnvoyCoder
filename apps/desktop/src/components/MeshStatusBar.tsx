/**
 * The status line, and the one place the mesh is always visible.
 *
 * Paseo's equivalent shows the daemon you are talking to. EnvoyCoder has one more thing worth
 * showing permanently: **whether this machine is attached to the mesh, and as whom**. That single
 * line decides whether "run it on the workstation" is even possible, and a user who has to open
 * Settings to find out will instead assume the feature is broken.
 *
 * The wording rule is the family's: a sentence a user can act on, with the developer detail
 * (scope key, owner id) only in the tooltip.
 */

import type { JSX } from "react";

import type { MeshStatus } from "../state/useCoderState.js";

export function MeshStatusBar(props: { mesh: MeshStatus }): JSX.Element {
  const { mesh } = props;
  const tone = mesh.kind === "attached" ? "ok" : mesh.kind === "refused" ? "warn" : "quiet";
  return (
    <footer className="statusbar">
      <span className={`dot dot--${tone}`} aria-hidden />
      <span className="statusbar__text">{describe(props.mesh)}</span>
      {mesh.kind === "attached" ? (
        <span className="statusbar__detail" title={`Session scope ${mesh.scopeKey}`}>
          {mesh.peerCount === undefined ? "" : `${mesh.peerCount} peers`}
        </span>
      ) : null}
      <span className="statusbar__spacer" />
      <span className="statusbar__detail">Agents run on this machine</span>
    </footer>
  );
}

function describe(mesh: MeshStatus): string {
  switch (mesh.kind) {
    case "attached":
      return mesh.peerCount && mesh.peerCount > 0
        ? `Mesh connected — ${mesh.peerCount} machines reachable`
        : "Mesh connected — no other machines reachable yet";
    case "no-node":
      return "EnvoyMesh is not running — tasks stay on this machine";
    case "refused":
      return mesh.reason;
  }
  // No `default`: the three cases above are the whole union, so a fourth state added to the protocol
  // becomes a compile error here rather than a status line that silently says nothing.
}
