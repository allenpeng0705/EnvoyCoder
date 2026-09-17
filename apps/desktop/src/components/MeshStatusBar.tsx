/**
 * The status line, and the one place the mesh is always visible.
 *
 * Paseo's equivalent shows the daemon you are talking to. EnvoyDev has one more thing worth
 * showing permanently: **what this machine is on the mesh** — attached to somebody else's node, or
 * hosting its own. That single line decides whether "run it on the workstation" is even possible,
 * and a user who has to open Settings to find out will instead assume the feature is broken.
 *
 * The wording rule is the family's: a sentence a user can act on, with the developer detail
 * (scope key, owner id, the shared mesh network's connection count) only in the tooltip. That last one
 * is load-bearing: `peerCount` is how many connections libp2p holds — relays, DHT peers, other families'
 * nodes — and a headline that called them "machines connected" told every standalone daemon's owner that
 * dozens of machines were attached to them when they had paired nothing (`describe`, below).
 */

import type { JSX } from "react";

import { useT } from "../i18n/context.js";
import { localizeText } from "../i18n/notice.js";
import type { Translator } from "../i18n/translate.js";
import type { MeshStatus } from "../state/useCoderState.js";

export function MeshStatusBar(props: { mesh: MeshStatus }): JSX.Element {
  const t = useT();
  const { mesh } = props;
  // `hosting` is healthy, not a fallback: our own peer is listening, which is exactly what a phone
  // needs. Only `refused` is a warning; `no-node` is quiet — nothing is wrong, there is simply no node.
  const tone =
    mesh.kind === "attached" || mesh.kind === "hosting"
      ? "ok"
      : mesh.kind === "refused"
        ? "warn"
        : "quiet";
  const line = describe(t, mesh);
  return (
    <footer className="statusbar">
      <span className={`dot dot--${tone}`} aria-hidden />
      {/* The headline is ours and translated; the daemon's own sentence about *why*, and every developer
          detail (peer id, scope key, the shared network's peer total), travel with it as the tooltip,
          which is where the family's wording rule puts them. `multiaddrs` and `relayHints` are still
          deliberately absent: they are dial addresses for a peer, they can run to a dozen lines, and a
          status bar is not where a user reads them — the phone gets them from `coder.meshStatus`. */}
      <span className="statusbar__text" title={line.detail}>
        {line.text}
      </span>
      {/* A badge only where the number is a claim we can stand behind — see `describe`. `hosting`
          therefore has none: its `peerCount` counts the shared mesh, not the user's machines. */}
      {line.badge === undefined ? null : (
        <span className="statusbar__detail" title={line.badge.title}>
          {line.badge.text}
        </span>
      )}
      <span className="statusbar__spacer" />
      <span className="statusbar__detail">{t("mesh.agentsHere")}</span>
    </footer>
  );
}

/** One status line: the sentence a user reads, its tooltip, and the number shown beside it (if any). */
interface MeshLine {
  text: string;
  /** Where a developer detail belongs. Never the sentence (AGENTS.md §5). */
  detail?: string;
  /** A count shown beside the line — only when it is a count of *this* window's mesh. */
  badge?: { text: string; title?: string };
}

/**
 * The mesh, in one line — and the reason behind it, kept but demoted.
 *
 * `refused` and `no-node` used to render the daemon's English sentence as the status line itself, so
 * a German window had one permanent English sentence along its bottom edge. The sentence is still
 * the honest answer to "why?", so it is not dropped: it becomes the line's tooltip, where a user who
 * needs it finds it and nobody else reads it in the wrong language.
 *
 * `hosting` is where the same rule met a **false claim**. Its count came from
 * `node.getConnectedPeerIds().length` — every libp2p connection the daemon's own peer holds, which for
 * a standalone daemon joining the community relays and a DHT client is dozens (the relays, DHT-discovered
 * peers, other families' nodes). "30 machines connected" told a user who had paired nothing that thirty
 * machines were theirs, which is a capability the protocol never granted (non-negotiable #4). So the
 * headline states the durable fact and the total moves to the tooltip, labelled for what it is.
 */
function describe(t: Translator["t"], mesh: MeshStatus): MeshLine {
  switch (mesh.kind) {
    case "attached":
      return {
        text:
          mesh.peerCount && mesh.peerCount > 0
            ? t("mesh.attached.peers", { count: mesh.peerCount })
            : t("mesh.attached.none"),
        // `attached` means a node that is not ours reported these peers, and "reachable" is what the
        // count honestly says; the badge keeps it with the session it belongs to.
        badge:
          mesh.peerCount !== undefined
            ? {
                text: t("mesh.peers", { count: mesh.peerCount }),
                title: t("mesh.scope.title", { scope: mesh.scopeKey }),
              }
            : undefined,
      };
    case "hosting":
      // The headline says the thing that changed for a self-hosting desktop: this machine *is* the node
      // a phone connects to. It carries **no count** on purpose (see above); the peer id is still the
      // identity a client pairs against, and the shared network's total keeps its honest label.
      return { text: t("mesh.hosting"), detail: hostingDetail(t, mesh) };
    case "no-node":
      return { text: t("mesh.noNode"), detail: localizeText(t, mesh.reason) };
    case "refused":
      return { text: t("mesh.refused"), detail: localizeText(t, mesh.reason) };
  }
  // No `default`: the four cases above are the whole union, so a fifth state added to the protocol
  // becomes a compile error here rather than a status line that silently says nothing.
}

/**
 * What the hosting line's tooltip says: which peer we are, and how many connections the shared mesh
 * network holds right now.
 *
 * The order is the family's (the identity first, the developer count last), and the count is *here*
 * rather than in the sentence because it is not a number about the user's own devices. Kept rather than
 * dropped: it is the fact a user debugging "can my phone reach me" actually wants, and a fact is safe
 * once it is labelled as one.
 */
function hostingDetail(
  t: Translator["t"],
  mesh: Extract<MeshStatus, { kind: "hosting" }>,
): string {
  const parts = [t("mesh.hosting.title", { peerId: mesh.peerId })];
  if (mesh.peerCount !== undefined) parts.push(t("mesh.peers", { count: mesh.peerCount }));
  return parts.join(" · ");
}
