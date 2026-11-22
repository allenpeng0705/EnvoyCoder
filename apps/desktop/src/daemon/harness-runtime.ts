/**
 * What EnvoyDev knows about the Envoy Harness revision it will launch.
 *
 * Package versions alone are not unique; `scripts/envoy-harness.pin` is the handle.
 * The version string (e.g. `0.1.0`) is still useful on screen next to the short commit —
 * it matches what ACP `initialize` / `getConfig` advertise as `agentInfo.version`.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type HarnessRuntimeInfo = {
  /** Semver (or placeholder) from packages/envoy-harness/package.json. */
  version: string;
  /** Full 40-char pin when readable. */
  commit: string;
  /** First 7 chars for UI. */
  shortCommit: string;
};

const FULL_COMMIT = /^[0-9a-f]{40}$/;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

function readPin(root: string): string | undefined {
  try {
    const raw = readFileSync(path.join(root, "scripts", "envoy-harness.pin"), "utf8").trim();
    return FULL_COMMIT.test(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function readPackageVersion(pkgJson: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve runtime info from the pin + sibling or staged package.json. */
export function resolveEnvoyHarnessRuntime(root: string = repoRoot()): HarnessRuntimeInfo | undefined {
  const commit = readPin(root);
  if (commit === undefined) return undefined;

  const candidates = [
    path.join(root, "..", "envoy-harness", "packages", "envoy-harness", "package.json"),
    path.join(root, "build", "cache", "envoy-harness", "packages", "envoy-harness", "package.json"),
    path.join(
      root,
      "apps",
      "desktop",
      "src-tauri",
      "resources",
      "envoy-harness",
      "package.json",
    ),
  ];
  let version = "0.0.0";
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const found = readPackageVersion(candidate);
    if (found !== undefined) {
      version = found;
      break;
    }
  }

  return { version, commit, shortCommit: commit.slice(0, 7) };
}
