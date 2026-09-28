/**
 * Open an SSH local-forward for a paired home whose daemon is only reachable through a hop.
 *
 * The window cannot spawn `ssh` itself; the Tauri shell owns the child process and returns a
 * loopback `ws://` URL. Browser / tests inject an opener or get a clear refusal.
 */

export type HomeSshForward = { host: string; port: number; path: string };

export type HomeSshForwardOpener = (
  hop: string,
  remotePort: number,
  path: string,
) => Promise<HomeSshForward>;

interface TauriGlobal {
  core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
}

function tauriInvoke(): TauriGlobal["core"] | undefined {
  const candidate = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return candidate?.core?.invoke ? candidate.core : undefined;
}

/** `user@host:port`, `host:port`, or `user@host` — same shapes Settings stores on the record. */
export function parseSshHop(raw: string): { user?: string; host: string; port: number } | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const at = text.includes("@") ? text.indexOf("@") : -1;
  const user = at > 0 ? text.slice(0, at) : undefined;
  const rest = at > 0 ? text.slice(at + 1) : text;
  const colon = rest.lastIndexOf(":");
  if (colon > 0) {
    const host = rest.slice(0, colon).trim();
    const port = Number(rest.slice(colon + 1).trim());
    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) return undefined;
    return { host, port, ...(user ? { user } : {}) };
  }
  if (!rest) return undefined;
  return { host: rest, port: 22, ...(user ? { user } : {}) };
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

/**
 * Default opener: Tauri `paired_home_ssh_forward`. Throws a readable error in the browser so the
 * rail shows offline instead of silently dialing this laptop's loopback.
 */
export const defaultHomeSshForwardOpener: HomeSshForwardOpener = async (hop, remotePort, path) => {
  const invoke = tauriInvoke()?.invoke;
  if (!invoke) {
    throw new Error(
      "This home needs an SSH hop, and only the desktop app can open that tunnel. Open EnvoyDev as the installed app (not the browser).",
    );
  }
  const localWsUrl = (await invoke("paired_home_ssh_forward", {
    hop,
    remotePort,
    path,
  })) as string;
  let parsed: URL;
  try {
    parsed = new URL(localWsUrl);
  } catch {
    throw new Error("The SSH tunnel answered with an address that is not a URL.");
  }
  const port = parsed.port ? Number(parsed.port) : 80;
  return {
    host: parsed.hostname,
    port,
    path: parsed.pathname && parsed.pathname.length > 0 ? parsed.pathname : "/ws",
  };
};
