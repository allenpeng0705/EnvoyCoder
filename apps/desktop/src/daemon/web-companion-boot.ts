/**
 * Start/stop the loopback companion beside the daemon socket.
 *
 * Lives apart from `serve.ts` so the boot file stays under the module-size hard cap.
 */

import type { RunManager } from "./runs.js";
import type { CoderStore } from "./store.js";
import { startWebCompanion, type WebCompanionHandle } from "./web-companion.js";

export async function bootWebCompanion(input: {
  store: CoderStore;
  runs: RunManager;
  port?: number;
  skip?: boolean;
}): Promise<WebCompanionHandle | undefined> {
  if (input.skip) return undefined;
  try {
    return await startWebCompanion({
      store: input.store,
      runs: input.runs,
      ...(input.port !== undefined ? { port: input.port } : {}),
    });
  } catch (error) {
    console.warn(
      `web companion did not start: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

export async function stopWebCompanion(handle: WebCompanionHandle | undefined): Promise<void> {
  if (handle === undefined) return;
  try {
    await handle.close();
  } catch {
    /* already closed */
  }
}
