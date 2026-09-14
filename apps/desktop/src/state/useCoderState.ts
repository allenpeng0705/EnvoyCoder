/**
 * The window's data, as React sees it.
 *
 * One hook over one store (`coderStore.ts`), which is why the components stayed the same shape while
 * the data source changed from `data/sample.ts` to a running daemon: they were always given plain
 * arrays, and where those arrays come from was always somebody else's problem.
 *
 * `useSyncExternalStore` is React's own primitive for exactly this — an external store with a
 * `subscribe` and a snapshot — so there is no state library here and no effect that copies the store
 * into component state (which is how two copies of one list start to disagree).
 *
 * ## `start()` happens once per window, and its failure is visible
 *
 * A window that cannot reach its daemon must **say so**, not render an empty rail: "no projects yet"
 * and "I could not ask" are different sentences, and showing the first for the second is how a user
 * concludes the app lost their work. So the connection state is part of the state the UI renders,
 * and the components branch on it.
 */

import { useEffect, useSyncExternalStore } from "react";

import { getCoderStore, type CoderState, type CoderStore } from "./coderStore.js";

export type { CoderState, MeshStatus } from "./coderStore.js";

/** The whole state. Consumers re-render on any change — fine at this size, see the store's doc. */
export function useCoderState(): CoderState {
  const store = getCoderStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    void store.start();
    // Deliberately no `dispose()` on unmount: this store is a per-window singleton, and a React
    // strict-mode double-mount would otherwise close the socket it had just opened. The window's
    // lifetime is the store's lifetime.
  }, [store]);

  return state;
}

/** The store itself, for components that need to call actions rather than read state. */
export function useCoderActions(): CoderStore {
  return getCoderStore();
}
