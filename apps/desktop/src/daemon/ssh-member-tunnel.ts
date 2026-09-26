/**
 * SSH local-forward tunnels for off-LAN member channels.
 *
 * Hint form: `ssh:user@host[:sshPort][/remoteDaemonPort][/wsPath]`
 * Example: `ssh:alice@box:2222/4770/ws`
 *
 * Opens `ssh -N -L <local>:127.0.0.1:<remote>` via `buildSshArgs` (`docs/envoydev-networking.md` §5–6).
 * The returned local `ws://127.0.0.1:<port>/ws` is what peer RPC and dial probes use.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { buildSshArgs, hasSshClient, type SshTarget } from "@envoydev/platform";
import { DEFAULT_DAEMON_PATH, DEFAULT_DAEMON_PORT } from "@envoydev/protocol";

export interface ParsedSshMemberHint {
  target: SshTarget;
  remotePort: number;
  wsPath: string;
  /** Original hint string — registry key. */
  hint: string;
}

export interface SshMemberTunnel {
  localWsUrl: string;
  localPort: number;
  stop: () => void;
}

const tunnels = new Map<string, SshMemberTunnel & { child: ChildProcess }>();

/**
 * Parse `ssh:…` hostHints. Returns undefined when the string is not an SSH hint.
 */
export function parseSshMemberHint(hints: string): ParsedSshMemberHint | undefined {
  const trimmed = hints.trim();
  if (!trimmed.startsWith("ssh:")) return undefined;
  const body = trimmed.slice(4).trim();
  // user@host:sshPort/remotePort/wsPath — path and remote port are optional.
  const match =
    /^(?:([^@/]+)@)?([^:/]+)(?::(\d+))?(?:\/(\d+))?(?:(\/[\w./-]+))?$/.exec(body);
  if (!match) return undefined;
  const user = match[1];
  const host = match[2]!;
  const sshPort = match[3] ? Number(match[3]) : undefined;
  const remotePort = match[4] ? Number(match[4]) : DEFAULT_DAEMON_PORT;
  const wsPath = match[5] && match[5].length > 1 ? match[5] : DEFAULT_DAEMON_PATH;
  if (!host || !Number.isFinite(remotePort) || remotePort <= 0) return undefined;
  if (sshPort !== undefined && (!Number.isFinite(sshPort) || sshPort <= 0)) return undefined;
  return {
    hint: trimmed,
    target: {
      host,
      ...(user ? { user } : {}),
      ...(sshPort !== undefined ? { port: sshPort } : {}),
      // accept-new: first connect learns the host key without blocking on a TTY prompt
      // (BatchMode has no user). Rejects later key changes. Same stance as phone SSH hops.
      extraOptions: ["BatchMode=yes", "StrictHostKeyChecking=accept-new"],
    },
    remotePort,
    wsPath: wsPath.startsWith("/") ? wsPath : `/${wsPath}`,
  };
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function waitChildReady(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(); // Forward may already be up; probe decides reachability.
    }, Math.min(400, timeoutMs));
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`ssh exited before the tunnel was ready (code=${code}, signal=${signal})`));
    });
  });
}

/**
 * Open (or reuse) a local-forward tunnel for an `ssh:` hint.
 * Injectable `spawnSsh` keeps tests off the real binary.
 */
export async function openSshMemberTunnel(
  hints: string,
  options: {
    spawnSsh?: (args: string[]) => ChildProcess;
    allocatePort?: () => Promise<number>;
    readyMs?: number;
  } = {},
): Promise<SshMemberTunnel> {
  const parsed = parseSshMemberHint(hints);
  if (!parsed) {
    throw new Error(`Not an ssh: member hint: ${hints}`);
  }

  const existing = tunnels.get(parsed.hint);
  if (existing && existing.child.exitCode === null && !existing.child.killed) {
    return { localWsUrl: existing.localWsUrl, localPort: existing.localPort, stop: existing.stop };
  }
  if (existing) {
    existing.stop();
  }

  if (!hasSshClient() && !options.spawnSsh) {
    throw new Error("No ssh client on this machine.");
  }

  const localPort = await (options.allocatePort ?? freeLoopbackPort)();
  const args = buildSshArgs(parsed.target, {
    localPort,
    remoteHost: "127.0.0.1",
    remotePort: parsed.remotePort,
  });

  const spawnSsh =
    options.spawnSsh ??
    ((sshArgs: string[]) =>
      spawn("ssh", sshArgs, {
        stdio: "ignore",
        detached: false,
      }));

  const child = spawnSsh(args);
  const localWsUrl = `ws://127.0.0.1:${localPort}${parsed.wsPath}`;

  const stop = () => {
    tunnels.delete(parsed.hint);
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  };

  try {
    await waitChildReady(child, options.readyMs ?? 2_000);
  } catch (error) {
    stop();
    throw error;
  }

  const entry = { localWsUrl, localPort, stop, child };
  tunnels.set(parsed.hint, entry);
  return { localWsUrl, localPort, stop };
}

/** Drop every open tunnel (daemon shutdown / tests). */
export function closeAllSshMemberTunnels(): void {
  for (const entry of [...tunnels.values()]) {
    entry.stop();
  }
  tunnels.clear();
}

/** Test seam: how many tunnels are live. */
export function sshMemberTunnelCount(): number {
  return tunnels.size;
}
