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

import { useT } from "../i18n/context.js";
import { localizeText } from "../i18n/notice.js";
import type { Translator } from "../i18n/translate.js";
import type { MeshStatus } from "../state/useCoderState.js";

export function MeshStatusBar(props: { mesh: MeshStatus }): JSX.Element {
  const t = useT();
  const { mesh } = props;
  const tone = mesh.kind === "attached" ? "ok" : mesh.kind === "refused" ? "warn" : "quiet";
  const line = describe(t, mesh);
  return (
    <footer className="statusbar">
      <span className={`dot dot--${tone}`} aria-hidden />
      {/* The headline is ours and translated; the daemon's own sentence about *why* travels with it
          as the tooltip, which is where the family's wording rule puts developer detail. */}
      <span className="statusbar__text" title={line.detail}>
        {line.text}
      </span>
      {mesh.kind === "attached" ? (
        <span className="statusbar__detail" title={t("mesh.scope.title", { scope: mesh.scopeKey })}>
          {mesh.peerCount === undefined ? "" : t("mesh.peers", { count: mesh.peerCount })}
        </span>
      ) : null}
      <span className="statusbar__spacer" />
      <span className="statusbar__detail">{t("mesh.agentsHere")}</span>
    </footer>
  );
}

/**
 * The mesh, in one line — and the reason behind it, kept but demoted.
 *
 * `refused` and `no-node` used to render the daemon's English sentence as the status line itself, so
 * a German window had one permanent English sentence along its bottom edge. The sentence is still
 * the honest answer to "why?", so it is not dropped: it becomes the line's tooltip, where a user who
 * needs it finds it and nobody else reads it in the wrong language.
 */
function describe(t: Translator["t"], mesh: MeshStatus): { text: string; detail?: string } {
  switch (mesh.kind) {
    case "attached":
      return {
        text:
          mesh.peerCount && mesh.peerCount > 0
            ? t("mesh.attached.peers", { count: mesh.peerCount })
            : t("mesh.attached.none"),
      };
    case "no-node":
      return { text: t("mesh.noNode"), detail: localizeText(t, mesh.reason) };
    case "refused":
      return { text: t("mesh.refused"), detail: localizeText(t, mesh.reason) };
  }
  // No `default`: the three cases above are the whole union, so a fourth state added to the protocol
  // becomes a compile error here rather than a status line that silently says nothing.
}
