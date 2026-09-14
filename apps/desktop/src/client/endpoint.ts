/**
 * Where the daemon is — decided by the **shell**, never by the window.
 *
 * ## The rule, and the bug it prevents
 *
 * The reference implementation lets its renderer name the transport it dials: a renderer-supplied
 * `transportPath` is validated only as a non-empty string and then dialled as a Unix socket or a
 * Windows named pipe (`packages/desktop/src/daemon/local-transport.ts:122-128`). In this shell the
 * window may ask for *the daemon*, and the shell decides what that means — so the window never
 * supplies a path, a host or a pipe name, and there is no code path where a compromised or merely
 * buggy renderer can point the app at an arbitrary socket.
 *
 * ## Two environments, and the weaker one says so
 *
 *   * **Inside the shell** — `daemon_endpoint` is an `invoke` into Rust, which resolved the shared
 *     home, read the claim file, and returns the host, port, path and the daemon's `instanceId`.
 *   * **In a browser** (`npm run dev`) — there is no shell, so the port comes from a build-time
 *     variable and there is no `instanceId` to check. That is a genuine reduction in guarantees and
 *     it is reported as such rather than being made to look the same: the connection accepts the
 *     product name alone, and this function's result says `verifiedBy: "none"` so nothing downstream
 *     can mistake it for the real thing.
 */

import type { DaemonEndpoint } from "./connection.js";

export interface ResolvedEndpoint {
  endpoint: DaemonEndpoint;
  /** How the endpoint was decided, and therefore how much its identity can be trusted. */
  verifiedBy: "shell" | "none";
}

/** The Tauri bridge, as this window uses it. Declared rather than pulled from a package. */
interface TauriGlobal {
  core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
}

function tauri(): TauriGlobal | undefined {
  const candidate = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return candidate?.core?.invoke ? candidate : undefined;
}

export const DEFAULT_WINDOW_DAEMON_PORT = 4770;

/**
 * Ask whoever is in charge.
 *
 * `VITE_ENVOYCODER_DAEMON_PORT` exists because the browser dev server has no shell to ask; it is a
 * *development* affordance and is not read inside the shell, where the answer must come from the
 * same place the supervisor got it.
 */
export async function resolveDaemonEndpoint(): Promise<ResolvedEndpoint> {
  const bridge = tauri();
  if (bridge?.core?.invoke) {
    let answer: {
      host?: string;
      port?: number;
      path?: string;
      instanceId?: string;
    };
    try {
      answer = (await bridge.core.invoke("daemon_endpoint")) as typeof answer;
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // Tauri v2 ACL: registered in invoke_handler but missing from capabilities → this wording.
      if (/not allowed|command not found/i.test(raw)) {
        throw new Error(
          "EnvoyCoder's window could not ask the shell where the daemon is. Rebuild the desktop app (the shell permission list is out of date).",
        );
      }
      throw error instanceof Error ? error : new Error(raw);
    }
    if (typeof answer?.port !== "number") {
      throw new Error(
        "The EnvoyCoder shell did not say where its daemon is. This window cannot connect without it.",
      );
    }
    return {
      endpoint: {
        host: answer.host ?? "127.0.0.1",
        port: answer.port,
        path: answer.path ?? "/ws",
        ...(answer.instanceId ? { instanceId: answer.instanceId } : {}),
      },
      verifiedBy: "shell",
    };
  }

  const raw = (import.meta.env as Record<string, string | undefined> | undefined)
    ?.VITE_ENVOYCODER_DAEMON_PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return {
    endpoint: {
      host: "127.0.0.1",
      port: Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_WINDOW_DAEMON_PORT,
      path: "/ws",
    },
    // No claim file was read, so there is no instance to compare against. A window in a browser is a
    // development surface; saying "verified" here would be the lie that gets copied into production.
    verifiedBy: "none",
  };
}
