/**
 * Where the UI's data comes from.
 *
 * One seam, deliberately: the components take plain arrays, so the same components render from
 * fixtures today and from the daemon's RPC tomorrow. Everything the app shows is *derived* in
 * `@envoycoder/workspace-model`, so wiring the daemon changes this file and nothing else.
 *
 * The daemon is not implemented in this scaffold — `apps/desktop/src/daemon/` holds its entry
 * point and the method list lives in `@envoycoder/protocol`. Until it serves, the UI runs on
 * `data/sample.ts`, which is why the sample set includes every status: a scaffold whose fixture
 * only has "running" rows hides the states that are hardest to render.
 */

import { useMemo } from "react";
import type { Project, Workspace } from "@envoycoder/protocol";
import { SAMPLE_PROJECTS, SAMPLE_WORKSPACES } from "../data/sample.js";

/** What the mesh looks like right now. Mirrors `MeshAttachOutcome` in `@envoycoder/host-bridge`. */
export type MeshAttachment =
  | { kind: "attached"; scopeKey: string; ownerId: string; peerCount?: number }
  | { kind: "no-node"; reason: string }
  | { kind: "refused"; code: string; reason: string };

export interface CoderState {
  projects: readonly Project[];
  workspaces: readonly Workspace[];
  mesh: MeshAttachment;
  windowCount: number;
}

export function useCoderState(): CoderState {
  return useMemo(
    () => ({
      projects: SAMPLE_PROJECTS,
      workspaces: SAMPLE_WORKSPACES,
      mesh: { kind: "no-node", reason: "" },
      windowCount: 1,
    }),
    [],
  );
}
