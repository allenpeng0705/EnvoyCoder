/**
 * What the bundle config embeds must exist after staging — and be runnable, not merely present.
 *
 * A packaged app is only self-contained if four directories are staged beside it
 * (`apps/desktop/src-tauri/resources/`): the **daemon**, a **Node runtime** to run it with, **Envoy Harness**, and
 * the **bin** shims. `tauri.conf.bundle.json` embeds exactly those globs, and the failure mode this guards is the
 * one that shipped once: a build that embeds nothing, succeeds, and produces an app whose daemon cannot start on
 * any machine but the developer's — where the shell falls back to the checkout.
 *
 * It is deliberately **not** part of `npm run gates`: it can only pass after `stage-desktop-bundle.mjs` has run,
 * which needs the network (a Node runtime download and an Envoy Harness clone and build). The release lane runs
 * staging and then this; a person checks a build with the same two commands.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFile = path.join(root, "apps/desktop", "src-tauri", "tauri.conf.bundle.json");
const resources = path.join(root, "apps", "desktop", "src-tauri", "resources");

const config = JSON.parse(readFileSync(configFile, "utf8"));
const embedded = (config?.bundle?.resources ?? [])
  .filter((entry) => typeof entry === "string" && entry.startsWith("resources/"))
  .map((entry) => entry.split("/")[1]);
if (embedded.length === 0) {
  console.error(`bundle resources: ${path.relative(root, configFile)} embeds no resources/ paths`);
  process.exit(1);
}

const failures = [];
for (const name of [...new Set(embedded)].sort()) {
  const dir = path.join(resources, name);
  if (!existsSync(dir)) {
    failures.push(`${name}: not staged (${path.relative(root, dir)} does not exist)`);
    continue;
  }
  const entries = readdirSync(dir);
  if (entries.length === 0) {
    failures.push(`${name}: staged but empty`);
    continue;
  }
  const bytes = entries.reduce((total, entry) => {
    try {
      return total + statSync(path.join(dir, entry)).size;
    } catch {
      return total;
    }
  }, 0);
  console.log(`  ok   ${name} (${entries.length} entr${entries.length === 1 ? "y" : "ies"}, ${bytes} bytes)`);
}

/**
 * **The daemon is the one resource whose shape matters, not just its presence.**
 *
 * It must be an *installed-style* bundle: the entry point plus the `node_modules` beside it, because the daemon
 * imports its workspace packages by name and Node resolves a bare import upward from the importing file. A copy of
 * `main.mjs` alone is exactly the payload that once failed with `Cannot find package 'zod'`.
 */
const daemon = path.join(resources, "daemon");
if (existsSync(daemon)) {
  if (!existsSync(path.join(daemon, "main.mjs"))) {
    failures.push("daemon: no main.mjs — the bundle config would embed a daemon with no entry point");
  }
  if (!existsSync(path.join(daemon, "node_modules"))) {
    failures.push(
      "daemon: no node_modules beside it — the daemon imports its packages by name and cannot start without them",
    );
  }
}

if (failures.length > 0) {
  console.error("bundle resources: the app would ship without something it embeds:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("Stage them first: node scripts/stage-desktop-bundle.mjs");
  process.exit(1);
}
console.log("bundle resources OK — everything the bundle config embeds is staged, and the daemon can start");
