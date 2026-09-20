/**
 * The Envoy Harness commit a shipped bundle is built from — and the clone that puts exactly that
 * commit on disk.
 *
 * ## Why a pin, when the harness is only a peer
 *
 * The packaged desktop app **stages a built harness at package time** (`stage-desktop-bundle.mjs`), so
 * an installed EnvoyDev carries the agent runtime it was built with. `docs/upgrading.md` §3.5 is the
 * contract: the commit is the *only* handle on that runtime, because all ten of the harness's packages
 * are version `0.0.0` — a version number identifies nothing. Cloning the default branch HEAD at
 * package time means two builds of the same tag can ship two different agent runtimes with nothing in
 * the artifact to say so. `scripts/envoy-harness.pin` is that missing handle: one line, the full
 * commit. `ENVOY_HARNESS_COMMIT` is the deliberate override (a release candidate, a bisect, the local
 * verification in §3.5); the pin is the default.
 *
 * ## Why the fetch names the commit, and what happens when it cannot be reached
 *
 * `git fetch --depth 1 <url> <sha>` is a *server* capability
 * (`uploadpack.allowReachableSHA1InWant` / `allowAnySHA1InWant`). GitHub answers it for a reachable
 * commit; a bare local clone may not, so a refusal falls back to a full fetch and then demands the
 * **same** commit. A branch tip is never an acceptable substitute — silently shipping `main` when the
 * pin is old is the exact failure this file exists to prevent — so an unreachable commit is a failed
 * build that names the sha and carries git's own words.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** This repo's root (`scripts/lib/` → up two). */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The tracked pin. One line, the full commit; the only file a deliberate bump has to touch. */
export const HARNESS_PIN_FILE = path.join(repoRoot, "scripts", "envoy-harness.pin");

const FULL_COMMIT = /^[0-9a-f]{40}$/;

/** The first non-empty line of git's stderr, so an error stays a sentence instead of a wall. */
function firstLine(text) {
  return (
    (text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "(no output)"
  );
}

function git(dest, args) {
  const result = spawnSync("git", ["-C", dest, ...args], { encoding: "utf8" });
  if (result.error) throw new Error(`git ${args.join(" ")} failed to start: ${result.error.message}`);
  return result;
}

function must(dest, args) {
  const result = git(dest, args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${dest}: ${firstLine(result.stderr)}`);
  }
  return result;
}

/**
 * The commit to build, from the pin or from `ENVOY_HARNESS_COMMIT`.
 *
 * Returned with its *source* as well as its value: the stager prints which of the two it is about to
 * build, because "which harness is in this artifact" is the question the pin exists to answer, and a
 * build log that does not say whether an override was in play answers it only halfway.
 */
export function readHarnessCommit(env = process.env) {
  const override = (env.ENVOY_HARNESS_COMMIT ?? "").trim();
  if (override.length > 0) {
    if (!FULL_COMMIT.test(override)) {
      throw new Error(
        `ENVOY_HARNESS_COMMIT is not a full 40-character commit: ${JSON.stringify(override)}.\n` +
          "  The harness's packages are all version 0.0.0, so only a commit identifies a revision.",
      );
    }
    return { commit: override, from: "ENVOY_HARNESS_COMMIT", source: "override" };
  }
  let pinned;
  try {
    pinned = readFileSync(HARNESS_PIN_FILE, "utf8").trim();
  } catch {
    throw new Error(
      `the Envoy Harness pin is missing: ${path.relative(repoRoot, HARNESS_PIN_FILE)}\n` +
        "  Recreate it with the commit to ship (docs/upgrading.md §3.5), or set ENVOY_HARNESS_COMMIT.",
    );
  }
  if (!FULL_COMMIT.test(pinned)) {
    throw new Error(
      `${path.relative(repoRoot, HARNESS_PIN_FILE)} does not name a full 40-character commit: ` +
        `${JSON.stringify(pinned)}.\n` +
        "  Fix the pin (docs/upgrading.md §3.5), or set ENVOY_HARNESS_COMMIT to override it.",
    );
  }
  return { commit: pinned, from: path.relative(repoRoot, HARNESS_PIN_FILE), source: "pin" };
}

/**
 * Clone `url` at exactly `commit` into `dest`, which is wiped first.
 *
 * The wipe is deliberate rather than tidy: a reused tree can carry a previous commit's sources or a
 * stale `dist/`, and a pin that inherits either is not reproducible. The pnpm store lives outside the
 * checkout, so the fresh `pnpm install` that follows still links from cache.
 *
 * Throws — never falls back to a branch — when the commit cannot be fetched or checked out.
 */
export function checkoutHarnessCommit({ dest, url, commit }) {
  if (!FULL_COMMIT.test(commit)) {
    throw new Error(`refusing to check out a non-commit: ${JSON.stringify(commit)}`);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  must(dest, ["init", "--quiet"]);
  must(dest, ["remote", "add", "origin", url]);

  // Shallow first: one commit instead of the repository's whole history. A server that refuses an
  // arbitrary sha (see the module head) sends us to the full fetch, which still ends at `commit`.
  const shallow = git(dest, ["fetch", "--depth", "1", "origin", commit]);
  if (shallow.status !== 0) {
    const full = git(dest, ["fetch", "origin"]);
    if (full.status !== 0) {
      throw new Error(
        `could not fetch Envoy Harness from ${url} to reach ${commit}.\n` +
          `  shallow fetch: ${firstLine(shallow.stderr)}\n` +
          `  full fetch:    ${firstLine(full.stderr)}`,
      );
    }
  }

  const checkout = git(dest, ["checkout", "--detach", "--force", commit]);
  if (checkout.status !== 0) {
    throw new Error(
      `Envoy Harness ${commit} is not a commit in ${url}.\n` +
        `  git: ${firstLine(checkout.stderr)}\n` +
        "  Fix the pin deliberately (docs/upgrading.md §3.5) — this build refuses to fall back to a " +
        "branch tip.",
    );
  }

  const head = (must(dest, ["rev-parse", "HEAD"]).stdout ?? "").trim();
  if (head !== commit) {
    throw new Error(
      `Envoy Harness checkout landed on ${head || "(nothing)"}, not the pinned ${commit}.`,
    );
  }
  return { commit: head };
}
