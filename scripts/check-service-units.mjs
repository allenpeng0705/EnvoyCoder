/**
 * The three service definitions, checked by the **native linter** of whichever OS is running this.
 *
 * `packages/platform/test/service.test.ts` asserts what the text *says*. It cannot assert that launchd, systemd and
 * the Task Scheduler will *accept* it: an unescaped `&` in a path, a missing `</dict>`, or a stray BOM is
 * well-formed as far as JavaScript is concerned and a refusal to load as far as the supervisor is concerned. This
 * instrument writes each definition to a temporary file and hands it to the tool that owns the format — on the lane
 * that has that tool, which is what the CI matrix is for.
 *
 * Every check is **honest about being skipped**: a tool that is not installed prints why and does not fail, because
 * "could not check" and "is wrong" are different answers and only one of them should turn a build red.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { detectPlatform, serviceDefinition } from "@envoydev/platform";

const run = promisify(execFile);

/** Paths that are deliberately awkward: a space, an `&`, and a home that is not at the filesystem root. */
function fixture(platform) {
  return {
    platform,
    node: "/opt/Envoy Dev/runtime/0.1.0/node",
    entry: "/opt/Envoy Dev/runtime/0.1.0/app/main.mjs",
    home: "/home/anna & co/EnvoyMesh",
    logPath: "/home/anna & co/.local/state/envoydev/service.log",
  };
}

/** Run a linter whose absence is a *skip*, not a failure. */
async function lint(command, args) {
  try {
    await run(command, args);
    return { ok: true, detail: `${command} ${args.join(" ")}` };
  } catch (error) {
    if (error?.code === "ENOENT") return { skipped: `${command} is not installed here` };
    return { ok: false, detail: `${command}: ${String(error?.stderr ?? error?.message ?? error).trim()}` };
  }
}

const directory = await mkdtemp(join(tmpdir(), "envoydev-service-units-"));
const platform = detectPlatform();

try {
  const definition = serviceDefinition(fixture(platform));
  if (definition === undefined) {
    console.log(`service units: nothing to check on ${platform} (this build installs no service there)`);
    process.exit(0);
  }

  const file = join(directory, definition.relativePath.split("/").pop() ?? "unit");
  await writeFile(file, definition.contents, "utf8");

  // Two things are always checkable, on every lane: the text names the flag that makes the claim a service's, and it
  // is not empty. The rest is the native linter's job.
  if (!definition.contents.includes("--managed-by")) {
    console.error("service units: the definition does not pass --managed-by service");
    process.exit(1);
  }

  const result =
    platform === "macos"
      ? await lint("plutil", ["-lint", file])
      : platform === "linux"
        ? await lint("systemd-analyze", ["verify", file])
        : platform === "windows"
          ? // PowerShell is on every Windows lane and validates the XML without *installing* a task — `schtasks
            // /Create` would have side effects on the runner and need privileges this must not require.
            await lint("powershell.exe", [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `[xml](Get-Content -Raw -LiteralPath '${file}') | Out-Null`,
            ])
          : { skipped: `${platform} has no service manager this build knows` };

  if (result.ok) {
    console.log(`service units OK — ${definition.kind} text accepted by ${result.detail}`);
  } else if (result.skipped !== undefined) {
    console.log(`service units: not checked — ${result.skipped} (the text itself is asserted by the suite)`);
  } else {
    console.error(`service units: the ${definition.kind} definition was refused:\n${result.detail}`);
    process.exit(1);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
