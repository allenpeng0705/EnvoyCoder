/**
 * Stage what the three installer scripts ship beside the Tauri app.
 *
 *   * the daemon, embedded so a packaged app has no checkout to import from
 *   * a Node runtime, because the shell starts the daemon with node
 *   * Envoy Harness, cloned at the commit `scripts/envoy-harness.pin` names and
 *     built, the way EnvoyMesh clones OpenClaw when the tree is missing and
 *     fetches Pi at package time
 *
 * The shell already starts that daemon with the first window and stops it when
 * the last window closes. This script only puts the files where that lookup
 * finds them (`apps/desktop/src-tauri/resources/`).
 *
 * Env:
 *   ENVOY_HARNESS_REPO_URL   clone URL (default the public repo)
 *   ENVOY_HARNESS_COMMIT     build this commit instead of the tracked pin
 *   ENVOY_HARNESS_DIR        use this checkout instead of cloning. Not reset.
 *   ENVOYDEV_NODE_VERSION    Node runtime to download (default 22.19.0)
 *   FETCH_NODE_SIDECAR=1     download Node again even if one is already staged
 *
 * When the pin clone fails and `ENVOY_HARNESS_DIR` is unset, the stager tries the sibling
 * checkout `../envoy-harness` (same layout as a local family clone) before giving up.
 *
 * The harness's pnpm overrides are `link:../EnvoyMesh/packages/…` relative to *its*
 * checkout. A pin clone under `build/cache/envoy-harness` would therefore look for
 * `build/cache/EnvoyMesh`. Before `pnpm install`, the stager points that path at the
 * family sibling `../EnvoyMesh` (symlink / junction) when needed.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { checkoutHarnessCommit, readHarnessCommit } from "./lib/harness-pin.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resources = path.join(root, "apps", "desktop", "src-tauri", "resources");
const harnessUrl = process.env.ENVOY_HARNESS_REPO_URL ?? "https://github.com/allenpeng0705/envoy-harness.git";
const nodeVersion = process.env.ENVOYDEV_NODE_VERSION ?? "22.19.0";
const cache = path.join(root, "build", "cache", "envoy-harness");
/** Family EnvoyMesh checkout — sibling of this repo, same layout the harness expects. */
const meshSibling = path.resolve(root, "..", "EnvoyMesh");

function say(line) {
  process.stdout.write(`${line}\n`);
}

function fail(line) {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

/**
 * Spawn a toolchain command. On Windows, never pass an unquoted
 * `C:\Program Files\...` path to `shell: true` — cmd.exe splits on the space
 * (`'C:\Program' is not recognized`). Prefer `node npm-cli.js` for npm; otherwise
 * build one quoted command line for `cmd.exe /d /s /c`.
 */
function spawnTool(cmd, args, options = {}) {
  const cwd = options.cwd;
  const stdio = options.stdio ?? "inherit";
  const env = options.env;

  if (process.platform !== "win32") {
    return spawnSync(cmd, args, { cwd, stdio, env });
  }

  const bare = path.basename(cmd).replace(/\.(cmd|exe|bat)$/i, "").toLowerCase();
  if (bare === "npm") {
    const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(cli)) {
      return spawnSync(process.execPath, [cli, ...args], { cwd, stdio, env });
    }
  }

  let resolved = cmd;
  if (!/[\\/]/.test(cmd) && !/\.(cmd|exe|bat)$/i.test(cmd)) {
    resolved = besideNode(cmd) ?? whichOnPath(cmd) ?? cmd;
  }

  const quote = (value) => {
    if (!/[ \t"]/.test(value)) return value;
    return `"${String(value).replace(/"/g, '""')}"`;
  };
  const line = [resolved, ...args].map(quote).join(" ");
  return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", line], {
    cwd,
    stdio,
    env,
    windowsVerbatimArguments: true,
  });
}

function run(cmd, args, options = {}) {
  const result = spawnTool(cmd, args, options);
  if (result.error) fail(`${cmd} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} ${args.join(" ")} exited ${result.status}`);
}

function host() {
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : "";
  if (!arch) fail(`This machine's architecture (${process.arch}) is not one the installer supports.`);
  if (process.platform === "darwin") return { platform: "darwin", arch, nodeName: path.join("bin", "node") };
  if (process.platform === "linux") return { platform: "linux", arch, nodeName: path.join("bin", "node") };
  if (process.platform === "win32") return { platform: "win", arch, nodeName: "node.exe" };
  fail(`This machine's system (${process.platform}) is not one the installer supports.`);
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok || !response.body) fail(`Could not download ${url} (${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

async function stageNode() {
  const info = host();
  const destDir = path.join(resources, "node-runtime");
  const dest = path.join(destDir, info.nodeName);
  if (existsSync(dest) && process.env.FETCH_NODE_SIDECAR !== "1") {
    say(`Node runtime already staged (${execFileSync(dest, ["--version"], { encoding: "utf8" }).trim()}).`);
    return;
  }
  say(`Downloading Node ${nodeVersion}…`);
  mkdirSync(destDir, { recursive: true });
  const stamp = path.join(tmpdir(), `envoydev-node-${nodeVersion}`);
  rmSync(stamp, { recursive: true, force: true });
  mkdirSync(stamp, { recursive: true });
  const folder = `node-v${nodeVersion}-${info.platform}-${info.arch}`;
  const archive = info.platform === "win" ? `${folder}.zip` : `${folder}.tar.gz`;
  const file = path.join(stamp, archive);
  await download(`https://nodejs.org/dist/v${nodeVersion}/${archive}`, file);
  run("tar", ["-xf", file, "-C", stamp]);
  const extracted = path.join(stamp, folder, info.nodeName);
  if (!existsSync(extracted)) fail(`The Node archive did not contain ${info.nodeName}.`);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(extracted, dest);
  if (process.platform !== "win32") chmodSync(dest, 0o755);
  rmSync(stamp, { recursive: true, force: true });
  say(`Node runtime staged at ${path.relative(root, dest)}.`);
}

/**
 * Absolute path of a Node-toolchain shim sitting next to `node` (Windows:
 * `corepack.cmd` / `pnpm.cmd`). Official Node installs put them there even when
 * the shell PATH is incomplete.
 */
function besideNode(base) {
  const dir = path.dirname(process.execPath);
  const names =
    process.platform === "win32" ? [`${base}.cmd`, `${base}.exe`, base] : [base];
  for (const name of names) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** First hit from `where.exe` (Windows) or `command -v` (POSIX). */
function whichOnPath(base) {
  if (process.platform === "win32") {
    const result = spawnSync("where.exe", [base], { encoding: "utf8" });
    if (result.status !== 0) return null;
    const hit = (result.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return hit ?? null;
  }
  const result = spawnSync("sh", ["-c", `command -v ${base}`], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const hit = (result.stdout ?? "").trim();
  return hit.length > 0 ? hit : null;
}

/**
 * Run a PATH / Node-adjacent command (see spawnTool for the Windows quoting rules).
 */
function spawnPath(cmd, args, cwd) {
  return spawnTool(cmd, args, { cwd });
}

function pnpm(args, cwd) {
  const corepackBin = besideNode("corepack") ?? whichOnPath("corepack");
  const pnpmBin = besideNode("pnpm") ?? whichOnPath("pnpm");

  // Prefer an existing pnpm. `corepack enable` tries to symlink into a system
  // bin dir (`/usr/local/bin` on macOS Homebrew Node) and fails with EACCES for
  // unprivileged builds — noisy and unnecessary when pnpm is already on PATH.
  // `corepack pnpm …` still works without that global shim.
  const attempts = [];
  if (pnpmBin) attempts.push([pnpmBin, args]);
  if (corepackBin) attempts.push([corepackBin, ["pnpm", ...args]]);
  // Bare names last — covers POSIX and a PATH that `where` missed.
  attempts.push(["pnpm", args]);
  attempts.push(["corepack", ["pnpm", ...args]]);

  /** @type {import("node:child_process").SpawnSyncReturns<Buffer> | null} */
  let lastMissing = null;
  const tried = [];
  for (const [cmd, cmdArgs] of attempts) {
    const key = `${cmd} ${cmdArgs.join(" ")}`;
    if (tried.includes(key)) continue;
    tried.push(key);
    const result = spawnPath(cmd, cmdArgs, cwd);
    if (result.status === 0) return;
    // Only fall through to the next binary when this one is missing. A real
    // non-zero exit (install/build failure) must not be retried four times.
    if (result.error?.code === "ENOENT") {
      lastMissing = result;
      continue;
    }
    fail(`pnpm ${args.join(" ")} failed (exit ${result.status ?? "?"}).`);
  }

  if (lastMissing) {
    fail(`pnpm ${args.join(" ")} failed (exit ${lastMissing.status ?? "?"}).`);
  }

  const pathEnv = process.env.PATH ?? process.env.Path ?? "(empty)";
  fail(
    "pnpm is required to build Envoy Harness. Install it (`corepack enable`, or `npm install -g pnpm`) and run this again.\n" +
      `  node:     ${process.execPath}\n` +
      `  corepack: ${corepackBin ?? "(not found beside node or on PATH)"}\n` +
      `  pnpm:     ${pnpmBin ?? "(not found beside node or on PATH)"}\n` +
      `  tried:    ${tried.join(" | ")}\n` +
      `  PATH:     ${pathEnv}`,
  );
}

/**
 * Pack a runnable envoy-harness tree without `pnpm deploy`.
 *
 * pnpm 10+ only allows `deploy` when the workspace was installed with
 * `inject-workspace-packages=true`. The harness sibling does not use that
 * setting (and we must not rewrite its `.npmrc`), so we copy `dist/`, install
 * the npm-registry production deps into the staged tree, and vendor the one
 * workspace dependency (`@envoymesh/envoy-process`) beside them.
 */
function packHarnessForInstaller(source, dest) {
  const pkgRoot = path.join(source, "packages", "envoy-harness");
  const processRoot = path.join(source, "packages", "envoy-process");
  const distCli = path.join(pkgRoot, "dist", "cli", "index.js");
  if (!existsSync(distCli)) {
    fail("Envoy Harness built, but dist/cli/index.js is missing. The package layout changed.");
  }
  if (!existsSync(path.join(processRoot, "dist", "index.js"))) {
    fail("envoy-process built, but dist/index.js is missing.");
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(path.join(pkgRoot, "dist"), path.join(dest, "dist"), { recursive: true });

  const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
  const registryDeps = {};
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    if (typeof range !== "string") continue;
    if (range.startsWith("file:") || range.startsWith("link:") || range.startsWith("workspace:")) continue;
    registryDeps[name] = range;
  }
  writeFileSync(
    path.join(dest, "package.json"),
    `${JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version ?? "0.0.0",
        type: "module",
        private: true,
        dependencies: registryDeps,
      },
      null,
      2,
    )}\n`,
  );

  say("Installing Envoy Harness production deps into the staged tree…");
  run("npm", ["install", "--omit=dev", "--no-package-lock", "--ignore-scripts"], { cwd: dest });

  const processPkg = JSON.parse(readFileSync(path.join(processRoot, "package.json"), "utf8"));
  const processDest = path.join(dest, "node_modules", "@envoymesh", "envoy-process");
  mkdirSync(processDest, { recursive: true });
  cpSync(path.join(processRoot, "dist"), path.join(processDest, "dist"), { recursive: true });
  writeFileSync(
    path.join(processDest, "package.json"),
    `${JSON.stringify(
      {
        name: processPkg.name,
        version: processPkg.version ?? "0.0.0",
        type: "module",
        main: "./dist/index.js",
        exports: processPkg.exports ?? { ".": { import: "./dist/index.js" } },
      },
      null,
      2,
    )}\n`,
  );

  const launcher = path.join(dest, "bin", "envoy-harness.mjs");
  mkdirSync(path.dirname(launcher), { recursive: true });
  writeFileSync(
    launcher,
    [
      "import { CliError, run } from \"../dist/cli/index.js\";",
      "try {",
      "  await run();",
      "} catch (error) {",
      "  if (error instanceof CliError) {",
      "    process.stderr.write(`envoy-harness: ${error.message}\\n`);",
      "    process.exit(error.exitCode);",
      "  }",
      "  process.stderr.write(`envoy-harness: ${error instanceof Error ? error.message : String(error)}\\n`);",
      "  process.exit(1);",
      "}",
      "",
    ].join("\n"),
  );
}

/** A usable envoy-harness tree: has the package the installer packs. */
function isHarnessCheckout(dir) {
  return existsSync(path.join(dir, "packages", "envoy-harness", "package.json"));
}

/** A usable EnvoyMesh tree: has the packages the harness overrides link. */
function isMeshCheckout(dir) {
  return (
    existsSync(path.join(dir, "packages", "protocol", "package.json")) &&
    existsSync(path.join(dir, "packages", "identity", "package.json")) &&
    existsSync(path.join(dir, "packages", "agent-adapter", "package.json"))
  );
}

/** Sibling checkout next to this repo — `../envoy-harness`. */
function siblingHarnessDir() {
  return path.resolve(root, "..", "envoy-harness");
}

/** Best-effort HEAD of a local checkout, for the build log when falling back. */
function localHarnessHead(dir) {
  try {
    const result = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" });
    if (result.status === 0) return (result.stdout ?? "").trim() || undefined;
  } catch {
    // Not a git tree, or git missing — the pack still works from sources on disk.
  }
  return undefined;
}

/**
 * The harness's pnpm-workspace overrides are `link:../EnvoyMesh/packages/…`
 * relative to the harness root. A family clone already sits beside EnvoyMesh; a
 * pin clone under `build/cache/` does not — wire that relative path to the
 * EnvoyCoder sibling `../EnvoyMesh` before `pnpm install`.
 *
 * @returns {string} absolute path of the EnvoyMesh tree the harness will link
 */
function ensureHarnessMeshLink(harnessSource) {
  const expected = path.resolve(harnessSource, "..", "EnvoyMesh");
  if (isMeshCheckout(expected)) {
    if (path.resolve(expected) !== path.resolve(meshSibling)) {
      say(`Harness will link EnvoyMesh at ${expected}.`);
    }
    return expected;
  }

  if (!isMeshCheckout(meshSibling)) {
    fail(
      `Envoy Harness needs EnvoyMesh at ${expected} (pnpm overrides: link:../EnvoyMesh/packages/…),\n` +
        `  and the family sibling is missing or incomplete: ${meshSibling}.\n` +
        "  Clone it beside this repo, then build the packages the harness links:\n" +
        `    git clone <EnvoyMesh> ${meshSibling}\n` +
        "    cd ../EnvoyMesh && npm install && npx tsc -b packages/protocol packages/identity packages/agent-adapter\n" +
        "  Or set ENVOY_HARNESS_DIR to a checkout that already sits next to EnvoyMesh.",
    );
  }

  // expected is missing or not a mesh tree — replace with a link to the sibling.
  try {
    const st = lstatSync(expected);
    if (st.isSymbolicLink() || st.isDirectory()) {
      rmSync(expected, { recursive: true, force: true });
    } else {
      fail(
        `Cannot link EnvoyMesh: ${expected} exists and is not a directory or symlink.\n` +
          `  Remove it, or place a real EnvoyMesh checkout there.`,
      );
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      throw error;
    }
  }

  mkdirSync(path.dirname(expected), { recursive: true });
  const relativeTarget = path.relative(path.dirname(expected), meshSibling);
  // Prefer a relative symlink so the cache moves with the repo; on Windows use a
  // directory junction (no admin) when relative symlinks are unavailable.
  try {
    symlinkSync(relativeTarget, expected, "dir");
  } catch (error) {
    if (process.platform === "win32") {
      try {
        symlinkSync(meshSibling, expected, "junction");
      } catch (junctionError) {
        fail(
          `Could not link ${expected} → ${meshSibling}.\n` +
            `  symlink: ${error instanceof Error ? error.message : String(error)}\n` +
            `  junction: ${junctionError instanceof Error ? junctionError.message : String(junctionError)}`,
        );
      }
    } else {
      fail(
        `Could not link ${expected} → ${meshSibling}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  say(`Linked ${path.relative(root, expected)} → ${meshSibling} (harness pnpm overrides).`);
  return expected;
}

/**
 * Harness build imports `@envoymesh/*` from the linked mesh `dist/`. A mesh that
 * was only `npm install`ed will fail the harness compile with opaque resolve errors.
 *
 * @param {string} meshDir absolute EnvoyMesh checkout the harness links
 */
function ensureMeshPackagesForHarness(meshDir) {
  const needed = ["protocol", "identity", "agent-adapter"];
  const missing = needed.filter((name) => {
    const pkg = path.join(meshDir, "packages", name);
    return !(
      existsSync(path.join(pkg, "dist", "index.js")) ||
      existsSync(path.join(pkg, "dist", `${name}.js`)) ||
      existsSync(path.join(pkg, "dist", "src", "index.js"))
    );
  });
  if (missing.length === 0) return;
  fail(
    `EnvoyMesh is linked, but these packages have no dist/ yet: ${missing.join(", ")}.\n` +
      `  From ${meshDir}:\n` +
      "    npm install && npx tsc -b packages/protocol packages/identity packages/agent-adapter\n" +
      "  Then re-run the installer script.",
  );
}

function stageHarness() {
  const explicit = process.env.ENVOY_HARNESS_DIR?.trim();
  let source;
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!isHarnessCheckout(resolved)) {
      fail(`ENVOY_HARNESS_DIR is not an envoy-harness checkout: ${resolved}`);
    }
    say(
      `Using the checkout at ${resolved} (not fetching; unset ENVOY_HARNESS_DIR to build the pinned commit).`,
    );
    source = resolved;
  } else {
    let pin;
    try {
      pin = readHarnessCommit();
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    say(
      `Checking out Envoy Harness ${pin.commit} (${pin.from}` +
        `${pin.source === "override" ? " — an override of the tracked pin" : ""})…`,
    );
    try {
      checkoutHarnessCommit({ dest: cache, url: harnessUrl, commit: pin.commit });
      source = cache;
    } catch (error) {
      const cloneError = error instanceof Error ? error.message : String(error);
      const sibling = siblingHarnessDir();
      if (!isHarnessCheckout(sibling)) {
        fail(
          `${cloneError}\n` +
            `  No sibling fallback either — looked for ${sibling}.\n` +
            "  Clone the pin when the network works, or set ENVOY_HARNESS_DIR to a local checkout,\n" +
            "  or place envoy-harness next to this repo as ../envoy-harness.",
        );
      }
      const head = localHarnessHead(sibling);
      say(
        `Clone of pinned ${pin.commit} failed; falling back to sibling ${sibling}` +
          `${head ? ` (HEAD ${head})` : ""}.`,
      );
      say(`  Clone error was: ${cloneError.split("\n")[0]}`);
      if (head && head !== pin.commit) {
        say(
          `  Warning: sibling HEAD is not the pin (${pin.commit}). ` +
            "This build is not reproducible from scripts/envoy-harness.pin.",
        );
      }
      source = sibling;
    }
  }

  const meshDir = ensureHarnessMeshLink(source);
  ensureMeshPackagesForHarness(meshDir);

  // Root `pnpm run build` → scripts/build-workspace.mjs (topo order). Do not use
  // `pnpm -r run build`: pnpm 10 starts dependents before deps emit dist/, and
  // this workspace's cycles make that fail with TS2307 on a clean checkout.
  say("Building Envoy Harness…");
  pnpm(["install"], source);
  pnpm(["run", "build"], source);

  const dest = path.join(resources, "envoy-harness");
  say("Packing Envoy Harness for the installer…");
  packHarnessForInstaller(source, dest);
  say(`Envoy Harness staged at ${path.relative(root, dest)}.`);
}

function stageLaunchers() {
  const bin = path.join(resources, "bin");
  mkdirSync(bin, { recursive: true });
  const sh = [
    "#!/bin/sh",
    "HERE=$(CDPATH= cd -- \"$(dirname \"$0\")\" && pwd)",
    "ROOT=$(CDPATH= cd -- \"$HERE/..\" && pwd)",
    "if [ -x \"$ROOT/node-runtime/bin/node\" ]; then",
    "  NODE=\"$ROOT/node-runtime/bin/node\"",
    "elif [ -x \"$ROOT/node-runtime/node.exe\" ]; then",
    "  NODE=\"$ROOT/node-runtime/node.exe\"",
    "else",
    "  NODE=node",
    "fi",
    "exec \"$NODE\" \"$ROOT/envoy-harness/bin/envoy-harness.mjs\" \"$@\"",
    "",
  ].join("\n");
  writeFileSync(path.join(bin, "envoy-harness"), sh);
  if (process.platform !== "win32") chmodSync(path.join(bin, "envoy-harness"), 0o755);
  writeFileSync(
    path.join(bin, "envoy-harness.cmd"),
    [
      "@echo off",
      "set \"ROOT=%~dp0..\"",
      "if exist \"%ROOT%\\node-runtime\\node.exe\" (",
      "  \"%ROOT%\\node-runtime\\node.exe\" \"%ROOT%\\envoy-harness\\bin\\envoy-harness.mjs\" %*",
      ") else (",
      "  \"%ROOT%\\node-runtime\\bin\\node.exe\" \"%ROOT%\\envoy-harness\\bin\\envoy-harness.mjs\" %*",
      ")",
      "",
    ].join("\r\n"),
  );
}

function ensureWorkspaceInstalled() {
  const markers = [
    path.join(root, "node_modules", "esbuild"),
    path.join(root, "apps", "desktop", "node_modules", "esbuild"),
  ];
  if (markers.some((p) => existsSync(p))) return;
  say("Workspace deps missing (no esbuild); running npm install at the EnvoyCoder root…");
  run("npm", ["install"], { cwd: root });
  if (!markers.some((p) => existsSync(p))) {
    fail(
      "npm install finished, but esbuild is still missing. From the EnvoyCoder root run `npm install` and try again.",
    );
  }
}

/**
 * Package mode resolves `@envoydev/*` through each package's `exports` → `./dist/…`.
 * A fresh Windows clone often has `npm install` but never `tsc -b`, so dist is empty
 * and esbuild reports "Could not resolve @envoydev/protocol".
 *
 * EnvoyMesh is a linked sibling: its packages must also have `dist/` or `@envoymesh/*`
 * types collapse and `tsc -b` reports implicit-any on every callback parameter.
 */
function ensureWorkspaceBuilt() {
  const meshReuseHostDts = path.join(
    root,
    "node_modules",
    "@envoymesh",
    "reuse-host",
    "dist",
    "src",
    "index.d.ts",
  );
  if (!existsSync(meshReuseHostDts)) {
    fail(
      "EnvoyMesh packages are linked but not built (missing @envoymesh/reuse-host dist).\n" +
        "  From the EnvoyMesh sibling, build only the packages EnvoyDev links (skip apps/*):\n" +
        "    npx tsc -b packages/protocol packages/identity packages/vault packages/network packages/api packages/node-core packages/harness packages/host-connect packages/reuse-host\n" +
        "  Then back here: npm install && npx tsc -b\n" +
        "  (A plain `npx tsc -b` in EnvoyMesh also typechecks apps/node and apps/social — not required for EnvoyDev.)",
    );
  }
  const tscJs = path.join(root, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tscJs)) {
    fail("typescript is not installed. From the EnvoyCoder root run `npm install`, then try again.");
  }
  say("Building workspace packages (tsc -b)…");
  const result = spawnSync(process.execPath, [tscJs, "-b"], { cwd: root, stdio: "inherit" });
  if (result.error) fail(`tsc failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`tsc -b exited ${result.status}`);
  const protocolDist = path.join(root, "packages", "protocol", "dist", "index.js");
  if (!existsSync(protocolDist)) {
    fail("tsc -b finished, but packages/protocol/dist/index.js is still missing.");
  }
}

function stageDaemon() {
  ensureWorkspaceInstalled();
  ensureWorkspaceBuilt();
  say("Building the daemon so it can run without this checkout…");
  // Prefer `daemon:package` (--package) over ENVOYDEV_DAEMON_PACKAGE alone: the
  // flag travels with argv; env can be dropped by a Windows spawn helper.
  run("npm", ["run", "daemon:package", "-w", "@envoydev/desktop"], {
    cwd: root,
    env: { ...process.env, ENVOYDEV_DAEMON_PACKAGE: "1" },
  });
  const built = path.join(root, "apps", "desktop", "dist-daemon", "main.mjs");
  if (!existsSync(built)) fail("The daemon bundle was not written.");
  const text = readFileSync(built, "utf8");
  if (/["']@envoydev\//.test(text) || /["']@envoymesh\//.test(text)) {
    fail("The packaged daemon still imports a workspace package. It would not start inside the installer.");
  }
  const destDir = path.join(resources, "daemon");
  rmSync(destDir, { recursive: true, force: true });
  cpSync(path.dirname(built), destDir, { recursive: true, dereference: true });
  if (!existsSync(path.join(destDir, "node_modules"))) {
    fail("The packaged daemon has no node_modules beside it. It would not start inside the installer.");
  }
  say(`Daemon staged at ${path.relative(root, path.join(destDir, "main.mjs"))}.`);
}

say("Staging the desktop bundle…");
mkdirSync(resources, { recursive: true });
await stageNode();
stageHarness();
stageLaunchers();
stageDaemon();
say("Staged. The installer scripts can package the app now.");
