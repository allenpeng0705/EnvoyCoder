/**
 * The window's data, as React sees it.
 *
 * Local daemon work goes through the active home when focus is **This machine**; paired homes each
 * have their own `CoderStore` behind `HomeRegistry` (`docs/envoydev-paired-homes.md`).
 */

import { useEffect, useSyncExternalStore } from "react";

import { getHomeRegistry, type HomeRegistry } from "./home-registry.js";
import { PairedHomeStore } from "./paired-homes.js";
import { defaultPairedHomesStorage } from "./paired-homes-storage.js";
import { getCoderStore, type CoderState, type CoderStore } from "./coderStore.js";

export type { CoderState, MeshStatus } from "./coderStore.js";

function ensureRegistry(): HomeRegistry {
  try {
    return getHomeRegistry();
  } catch {
    return getHomeRegistry(new PairedHomeStore(defaultPairedHomesStorage()));
  }
}

/** Active home's state — what the work surface (task pane, composer) binds to. */
export function useCoderState(): CoderState {
  const registry = ensureRegistry();
  useEffect(() => {
    void registry.start();
  }, [registry]);
  const tree = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  if (tree.activeHomeId === "local") return tree.local;
  const remote = tree.homes.find((h) => h.record.id === tree.activeHomeId);
  return remote?.state ?? tree.local;
}

/** Active home's store — createTask / startRun / approvals for the focused home. */
export function useCoderActions(): CoderStore {
  const registry = ensureRegistry();
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  return registry.activeStore();
}

/** Always the laptop daemon — Settings mint/pairing, local Agents/LLM. */
export function useLocalCoderActions(): CoderStore {
  ensureRegistry();
  return getCoderStore();
}

/** Rail + home switcher. */
export function useHomeRegistry(): HomeRegistry {
  const registry = ensureRegistry();
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  return registry;
}
