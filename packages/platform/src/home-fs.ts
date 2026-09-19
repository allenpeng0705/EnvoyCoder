/**
 * Browse directories on the daemon's machine — the phone's "folder picker".
 *
 * Desktop uses the OS chooser; the phone cannot. These helpers answer the same shape EnvoyGo /
 * Social already speak (`getHomeFsInfo` / `listHomeFsEntries`), so the Flutter browser can stay a
 * thin twin rather than inventing a second wire.
 *
 * Platform wire values match that family (`darwin` / `linux` / `win32`), not this package's
 * `macos` / `windows` ids — a client that branches on `win32` for drive roots must not see `windows`.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { platform as nodePlatform } from "node:os";

export type HomeFsPlatform = "darwin" | "linux" | "win32" | "other";

export type HomeFsEntryKind = "dir" | "file";

export interface HomeFsEntry {
  name: string;
  kind: HomeFsEntryKind;
  path: string;
  /** Bytes. A directory's own stat size, not the size of everything inside it. */
  size: number;
  /** ISO time from the filesystem. The explorer sorts by this. */
  modifiedAt: string;
}

export interface HomeFsInfo {
  platform: HomeFsPlatform;
  pathSep: string;
  homeDir: string;
  roots: string[];
}

export interface ListHomeFsEntriesParams {
  path?: string;
  dirsOnly?: boolean;
}

export interface ListHomeFsEntriesResult {
  path: string;
  parent?: string;
  entries: HomeFsEntry[];
}

function detectHomeFsPlatform(): HomeFsPlatform {
  const p = nodePlatform();
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  return "other";
}

/** Enumerate Windows drive roots that exist (C:\, D:\, …). */
export function listWindowsDriveRoots(): string[] {
  const roots: string[] = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const root = `${letter}:\\`;
    try {
      if (existsSync(root)) roots.push(root);
    } catch {
      // inaccessible drive
    }
  }
  return roots;
}

export function getHomeFsInfo(): HomeFsInfo {
  const platform = detectHomeFsPlatform();
  const homeDir = path.resolve(homedir());
  const roots: string[] = platform === "win32" ? listWindowsDriveRoots() : ["/"];
  return {
    platform,
    pathSep: path.sep,
    homeDir,
    roots: roots.length > 0 ? roots : platform === "win32" ? ["C:\\"] : ["/"],
  };
}

/**
 * Resolve and validate an absolute directory path on the daemon.
 * Returns null if missing, not absolute, or not a directory.
 */
export function resolveHomeFsDirectory(projectPath: string | undefined | null): string | null {
  const raw = projectPath?.trim();
  if (!raw || raw.includes("\0")) return null;
  if (!path.isAbsolute(raw)) return null;
  let abs: string;
  try {
    abs = path.resolve(raw);
  } catch {
    return null;
  }
  if (!existsSync(abs)) return null;
  try {
    if (!statSync(abs).isDirectory()) return null;
  } catch {
    return null;
  }
  return abs;
}

function parentOf(absPath: string): string | undefined {
  const parent = path.dirname(absPath);
  if (parent === absPath) return undefined;
  if (detectHomeFsPlatform() === "win32") {
    const normalized = path.resolve(absPath);
    if (/^[A-Za-z]:\\$/i.test(normalized)) return undefined;
  }
  return parent;
}

/**
 * List entries in a directory.
 * - undefined / "" → homeDir
 * - dirsOnly → directories only (what a folder picker wants)
 */
export function listHomeFsEntries(
  params: ListHomeFsEntriesParams = {},
): ListHomeFsEntriesResult {
  const info = getHomeFsInfo();
  const raw = params.path?.trim();
  const target = raw
    ? resolveHomeFsDirectory(raw)
    : resolveHomeFsDirectory(info.homeDir);

  if (!target) {
    throw new Error(
      raw
        ? `Path is missing or is not a directory: ${raw}`
        : "Home directory is not available",
    );
  }

  let names: string[];
  try {
    names = readdirSync(target);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Cannot list directory: ${msg}`);
  }

  const entries: HomeFsEntry[] = [];
  for (const name of names) {
    if (name === "." || name === "..") continue;
    const full = path.join(target, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    const kind: HomeFsEntryKind = st.isDirectory() ? "dir" : "file";
    if (params.dirsOnly && kind !== "dir") continue;
    entries.push({
      name,
      kind,
      path: full,
      size: st.size,
      modifiedAt: st.mtime.toISOString(),
    });
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const parent = parentOf(target);
  return {
    path: target,
    ...(parent ? { parent } : {}),
    entries,
  };
}
