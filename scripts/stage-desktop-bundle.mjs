/**
 * Stage what the three installer scripts ship beside the Tauri app.
 *
 *   * the daemon, embedded so a packaged app has no checkout to import from
 *   * a Node runtime, because the shell starts the daemon with node
 *   * Envoy Harness, cloned from its repo and built, the way EnvoyMesh clones
 *     OpenClaw when the tree is missing and fetches Pi at package time
 *
 * The shell already starts that daemon with the first window and stops it when
 * the last window closes. This script only puts the files where that lookup
 * finds them (`apps/desktop/src-tauri/resources/`).
 *
 * Env:
 *   ENVOY_HARNESS_REPO_URL   clone URL (default the public repo)
 *   ENVOY_HARNESS_DIR        use this checkout instead of cloning. Not reset.
 *   ENVOYDEV_NODE_VERSION    Node runtime to download (default 22.19.0)
 *   FETCH_NODE_SIDECAR=1     download Node again even if one is already staged
 */

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resources = path.join(root, "apps", "desktop", "src-tauri", "resources");
const harnessUrl = process.env.ENVOY_HARNESS_REPO_URL ?? "https://github.com/allenpeng0705/envoy-harness.git";
const nodeVersion = process.env.ENVOYDEV_NODE_VERSION ?? "22.19.0";
const cache = path.join(root, "build", "cache", "envoy-harness");

function say(line) {
  process.stdout.write(`${line}\n`);
}

function fail(line) {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
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

function pnpm(args, cwd) {
  const corepack = spawnSync("corepack", ["pnpm", ...args], { cwd, stdio: "inherit" });
  if (corepack.status === 0) return;
  const direct = spawnSync("pnpm", args, { cwd, stdio: "inherit" });
  if (direct.status === 0) return;
  fail("pnpm is required to build Envoy Harness. Install it (`corepack enable`, or `npm install -g pnpm`) and run this again.");
}

function stageHarness() {
  const local = process.env.ENVOY_HARNESS_DIR;
  let source = local;
  if (local) {
    if (!existsSync(path.join(local, "packages", "envoy-harness", "package.json"))) {
      fail(`ENVOY_HARNESS_DIR is not an envoy-harness checkout: ${local}`);
    }
    say(`Using the checkout at ${local} (not fetching; unset ENVOY_HARNESS_DIR to clone the latest).`);
  } else {
    if (!existsSync(path.join(cache, ".git"))) {
      rmSync(cache, { recursive: true, force: true });
      mkdirSync(path.dirname(cache), { recursive: true });
      say(`Cloning ${harnessUrl}…`);
      run("git", ["clone", "--depth", "1", harnessUrl, cache]);
    } else {
      say("Updating the Envoy Harness checkout to the latest commit…");
      run("git", ["-C", cache, "fetch", "--depth", "1", "origin"]);
      run("git", ["-C", cache, "reset", "--hard", "FETCH_HEAD"]);
    }
    source = cache;
  }

  say("Building Envoy Harness…");
  pnpm(["install"], source);
  pnpm(["-r", "run", "build"], source);

  const dest = path.join(resources, "envoy-harness");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  say("Packing Envoy Harness for the installer…");
  pnpm(["--filter", "@envoymesh/envoy-harness", "deploy", dest], source);

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
  if (!existsSync(path.join(dest, "dist", "cli", "index.js"))) {
    fail("Envoy Harness built, but dist/cli/index.js is missing. The package layout changed.");
  }
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

function stageDaemon() {
  say("Building the daemon so it can run without this checkout…");
  run("npm", ["run", "daemon:build", "-w", "@envoydev/desktop"], {
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
