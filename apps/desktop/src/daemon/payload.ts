/**
 * The daemon's payload, installed where a supervisor can point at it.
 *
 * ## Why a copy, and not the app
 *
 * A service unit has to name a program. Every path inside the app bundle is the wrong answer:
 *
 *   * a macOS app run from a DMG is **translocated** to a per-run `/private/var/folders/...` path, so a unit
 *     written against it breaks the moment the DMG is ejected;
 *   * an AppImage is mounted per run, for the same reason;
 *   * an update replaces the bundle, so a stable unit would point at a version that is no longer there;
 *   * and on **Windows a running `node.exe` locks its own binary**, so updating in place is not merely untidy,
 *     it is impossible.
 *
 * So the payload is copied to `<stateDir>/runtime/<version>/` and the service points at that. An update writes
 * the next version beside the last one, flips the pointer, restarts, and can go back by flipping it back — which
 * is also why nothing here ever rewrites a version directory that already exists. A running daemon is executing
 * out of one of them.
 *
 * ## The pointer is a file, not a symlink
 *
 * `current` is a small text file holding the version, and the launcher resolves it. A symlink would be the
 * obvious choice and is the wrong one: creating one needs elevation or developer mode on Windows, and the whole
 * point of this directory is to be the thing that works on all three platforms. Reading a file needs nothing.
 *
 * ## What this module does not do
 *
 * It does not write a service unit, restart anything, or decide which version is current — it copies a payload,
 * records which version is current, and prunes what the caller says is no longer needed. The unit text and the
 * supervisor calls are the next slice (`docs/daemon-lifecycle.md` §6, checklist item 9).
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CoderPaths } from "@envoydev/host-bridge";

/** `<shared home>/EnvoyDev/runtime` — beside the state files, not inside the app. */
export function runtimeRoot(paths: CoderPaths): string {
  return join(paths.stateDir, "runtime");
}

/** One installed payload version. */
export function versionDir(paths: CoderPaths, version: string): string {
  return join(runtimeRoot(paths), version);
}

/** The file naming the version a supervisor should be running. */
export function currentPointer(paths: CoderPaths): string {
  return join(runtimeRoot(paths), "current");
}

/**
 * The program and entry point inside an installed version, as a unit would name them.
 *
 * **The entry is inside the bundle when there is one**, and that is not tidiness: Node resolves a bare import
 * (`@envoydev/protocol`, `zod`) by walking up from the *importing file's* own directory, so an entry copied to the
 * version root sits beside no `node_modules` and cannot resolve anything — measured, after a payload that had all
 * 69 dependency packages copied next to it still failed with `Cannot find package 'zod' imported from
 * …/runtime/0.1.0/main.mjs`. The root form is kept for a bundle-less payload (a self-contained file, if the build
 * ever produces one). */
export function payloadPaths(dir: string): { node: string; entry: string } {
  const inBundle = join(dir, "app", "main.mjs");
  return { node: join(dir, "node"), entry: existsSync(inBundle) ? inBundle : join(dir, "main.mjs") };
}

export interface PayloadSource {
  version: string;
  /** The Node runtime to run the daemon with. */
  node: string;
  /** The daemon's entry point (`main.mjs`). */
  entry: string;
  /**
   * The daemon's **built directory**, copied whole into `<version>/app/`.
   *
   * Not optional in practice, and its absence was a real bug: a daemon bundle imports its workspace packages by
   * name, so `main.mjs` alone cannot start outside the checkout — the first version of this copied just the entry
   * and the node runtime, and running the result failed with `ERR_MODULE_NOT_FOUND: @envoydev/protocol`. This is
   * the same directory the packaging script stages beside the app (`stage-desktop-bundle.mjs` copies
   * `dist-daemon/**`, including its own `node_modules`, and refuses to build without them).
   */
  bundle?: string;
  /** The staged agent binaries (`Envoy Harness`, and whatever the build put beside it), when there are any. */
  harness?: string;
}

export interface InstalledPayload {
  version: string;
  dir: string;
  /** False when this version was already installed, which is not a failure — it is the update case. */
  installed: boolean;
}

/** Is this a usable payload directory? The entry point is the thing a unit needs to exist. */
async function isPayload(dir: string): Promise<boolean> {
  try {
    // Either shape counts: inside the bundle beside its dependencies, or the entry on its own (see
    // `payloadPaths`). `existsSync` rather than `stat`, because two `await`s inside one `try` meant a missing root
    // entry threw before the bundle path was ever looked at — a check that failed for the shape it was written for.
    return existsSync(join(dir, "main.mjs")) || existsSync(join(dir, "app", "main.mjs"));
  } catch {
    return false;
  }
}

/**
 * Copy a payload into `runtime/<version>`, atomically, and point `current` at it.
 *
 * Atomic in the sense that matters: the copy happens in a temporary directory beside the destination and is
 * renamed into place, so a failure (a source that vanished, a full disk, a kill) leaves **no** half-installed
 * version and leaves `current` exactly where it was. A version that already exists is left untouched and reported
 * as `installed: false` — it may be the one a live daemon is running from.
 */
export async function installPayload(paths: CoderPaths, source: PayloadSource): Promise<InstalledPayload> {
  const root = runtimeRoot(paths);
  const dir = versionDir(paths, source.version);
  if (await isPayload(dir)) {
    await writeCurrent(paths, source.version);
    return { version: source.version, dir, installed: false };
  }

  await mkdir(root, { recursive: true });
  const temp = join(root, `.${source.version}.tmp-${process.pid}`);
  await rm(temp, { recursive: true, force: true });
  await mkdir(temp, { recursive: true });
  try {
    await cp(source.node, join(temp, "node"));
    // The bundle first, so the entry copied below is a file that exists (it lives inside it).
    if (source.bundle !== undefined) {
      await cp(source.bundle, join(temp, "app"), { recursive: true, dereference: true });
    } else {
      // Only when there is no bundle: with one, the entry stays where its imports resolve.
      await cp(source.entry, join(temp, "main.mjs"));
    }
    if (source.harness !== undefined) await cp(source.harness, join(temp, "harness"), { recursive: true });
    // Fail here rather than leaving a directory that looks installed but cannot start.
    if (!(await isPayload(temp))) throw new Error(`the payload has no main.mjs: ${source.entry}`);
    try {
      await rename(temp, dir);
    } catch (error) {
      // Another process installed this version while we were copying. Its directory is the good one.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
        throw error;
      }
      await rm(temp, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }

  await writeCurrent(paths, source.version);
  return { version: source.version, dir, installed: true };
}

/** Record which version a supervisor should run. Written through a temporary file so a reader never sees half. */
export async function writeCurrent(paths: CoderPaths, version: string): Promise<void> {
  const pointer = currentPointer(paths);
  const temp = `${pointer}.tmp-${process.pid}`;
  await writeFile(temp, `${version}\n`, { encoding: "utf8" });
  await rename(temp, pointer);
}

/**
 * The version `current` names, or nothing.
 *
 * **Nothing is an answer, not a failure.** A pointer naming a version whose directory has been removed by hand
 * has to read as "not installed" — the caller then reinstalls or reports it — rather than as a path that is about
 * to fail at exec time.
 */
export async function readCurrent(paths: CoderPaths): Promise<string | undefined> {
  let version: string;
  try {
    version = (await readFile(currentPointer(paths), "utf8")).trim();
  } catch {
    return undefined;
  }
  if (version === "" || version.includes("/") || version.includes("\\")) return undefined;
  return (await isPayload(versionDir(paths, version))) ? version : undefined;
}

/**
 * Remove installed versions the caller no longer wants, and say which.
 *
 * The caller owns the policy — it knows which version is running and which one it keeps for rollback — and this
 * function owns the two things that must never happen: removing `current`, and removing a version the caller
 * named in `protect`. A version string used as a path is validated for the same reason `readCurrent` validates
 * it: this deletes directories.
 */
export async function pruneVersions(
  paths: CoderPaths,
  options: { protect?: readonly string[] } = {},
): Promise<string[]> {
  const root = runtimeRoot(paths);
  const current = await readCurrent(paths);
  const protect = new Set([...(options.protect ?? []), ...(current !== undefined ? [current] : [])]);

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (entry === "current" || entry.startsWith(".") || protect.has(entry)) continue;
    if (entry.includes("/") || entry.includes("\\")) continue;
    const dir = join(root, entry);
    if (!(await stat(dir)).isDirectory()) continue;
    await rm(dir, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}
