/**
 * Peer directory for collaborative tasks (M5b).
 *
 * Until mesh discovery lands, the owner registers peers explicitly. `coder.listPeers` reads this
 * store; unreachable peers refuse offers with `envoydev.peer-refused`.
 * See `docs/envoydev-collaboration.md`.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CoderPeer } from "@envoydev/protocol";

const FILE = "peers.json";

interface PeerFile {
  peers: Record<string, { id: string; label: string; reachable: boolean; lastSeenAt?: string }>;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT";
}

async function readPeers(stateDir: string): Promise<PeerFile> {
  try {
    const raw = await readFile(join(stateDir, FILE), "utf8");
    const parsed = JSON.parse(raw) as PeerFile;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.peers !== "object") {
      return { peers: {} };
    }
    return parsed;
  } catch (error) {
    if (isMissing(error)) return { peers: {} };
    return { peers: {} };
  }
}

async function writePeers(stateDir: string, file: PeerFile): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const path = join(stateDir, FILE);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function listPeers(stateDir: string): Promise<CoderPeer[]> {
  const file = await readPeers(stateDir);
  return Object.values(file.peers)
    .map((peer) => ({
      id: peer.id,
      label: peer.label,
      reachable: peer.reachable,
      ...(peer.lastSeenAt ? { lastSeenAt: peer.lastSeenAt } : {}),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function registerPeer(
  stateDir: string,
  input: { id: string; label: string; reachable?: boolean },
  now: () => string = () => new Date().toISOString(),
): Promise<CoderPeer> {
  const file = await readPeers(stateDir);
  const at = now();
  const peer = {
    id: input.id,
    label: input.label,
    reachable: input.reachable !== false,
    lastSeenAt: at,
  };
  file.peers[input.id] = peer;
  await writePeers(stateDir, file);
  return {
    id: peer.id,
    label: peer.label,
    reachable: peer.reachable,
    lastSeenAt: peer.lastSeenAt,
  };
}

export async function forgetPeer(stateDir: string, id: string): Promise<boolean> {
  const file = await readPeers(stateDir);
  if (file.peers[id] === undefined) return false;
  delete file.peers[id];
  await writePeers(stateDir, file);
  return true;
}

export async function getPeer(stateDir: string, id: string): Promise<CoderPeer | undefined> {
  const file = await readPeers(stateDir);
  const peer = file.peers[id];
  if (peer === undefined) return undefined;
  return {
    id: peer.id,
    label: peer.label,
    reachable: peer.reachable,
    ...(peer.lastSeenAt ? { lastSeenAt: peer.lastSeenAt } : {}),
  };
}
