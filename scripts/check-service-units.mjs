/**
 * The three service definitions, checked the way the supervisor will read them.
 *
 * `packages/platform/test/service.test.ts` asserts what the text *says*. It cannot assert that launchd, systemd and
 * the Task Scheduler will *accept* it: an unescaped `&` in a path, a missing `</dict>`, or an XML declaration that
 * disagrees with the file's actual encoding is well-formed as far as JavaScript is concerned and a refusal to load
 * as far as the supervisor is concerned. This instrument writes each definition to a temporary file and hands it to
 * the tool that owns the format — on the lane that has that tool, which is what the CI matrix is for.
 *
 * Two checks do not need a native tool and therefore run everywhere:
 *
 *   * **the bytes on disk.** `checkServiceUnitBytes` compares the encoding the XML declares with the encoding the
 *     file actually has. A `encoding="UTF-16"` declaration over UTF-8 bytes looks perfect when read through
 *     `readFile(…, "utf8")`, and is exactly what `schtasks /Create /XML`, expat and .NET refuse.
 *   * **the linter's exit code and its own lines.** `plutil` and the PowerShell XML load are honest through the
 *     exit code; `systemd-analyze verify` is not — it prints `Unknown key name … ignoring` and still exits `0` on
 *     versions this repository supports, so `serviceUnitLintProblems` reads its output too.
 *
 * Every check is **honest about not being checkable**: a tool that is not installed prints why and does not fail,
 * because "could not check" and "is wrong" are different answers and only one of them should turn a build red.
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  checkServiceUnitBytes,
  detectPlatform,
  serviceDefinition,
  serviceUnitLintProblems,
} from "@envoydev/platform";

const run = promisify(execFile);

/**
 * Paths that are deliberately awkward: a space, an `&`, and a home that is not at the filesystem root.
 *
 * `node` must be a program systemd-analyze can actually execute, or its `ExecStart` check reports the fixture
 * rather than the definition; the caller creates one with the same awkward characters.
 */
function fixture(platform, node) {
  return {
    platform,
    node,
    entry: "/opt/Envoy Dev/runtime/0.1.0/app/main.mjs",
    home: "/home/anna & co/EnvoyMesh",
    logPath: "/home/anna & co/.local/state/envoydev/service.log",
  };
}

/**
 * Run a linter whose absence is a *skip*, not a failure.
 *
 * Both streams are merged: systemd writes its diagnostics to stderr, while the XML parsers write to stdout. The
 * caller judges the result with `serviceUnitLintProblems`, never the exit code alone.
 */
async function lint(command, args) {
  const detail = `${command} ${args.join(" ")}`;
  try {
    const { stdout, stderr } = await run(command, args);
    return { code: 0, output: `${stdout}${stderr}`, detail };
  } catch (error) {
    if (error?.code === "ENOENT") return { skipped: `${command} is not installed here` };
    return {
      code: typeof error?.code === "number" ? error.code : 1,
      output: `${error?.stdout ?? ""}${error?.stderr ?? ""}`.trim() || String(error?.message ?? error),
      detail,
    };
  }
}

const directory = await mkdtemp(join(tmpdir(), "envoydev-service-units-"));
const platform = detectPlatform();

try {
  // `systemd-analyze verify` refuses a unit whose `ExecStart` program does not exist, so the fixture's program is
  // real — a shell script inside the same deliberately awkward directory — while still exercising the quoting of a
  // path with a space and an `&`.
  const runtime = join(directory, "Envoy Dev & co");
  await mkdir(runtime, { recursive: true });
  const node = join(runtime, "node");
  await writeFile(node, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(node, 0o755);

  const definition = serviceDefinition(fixture(platform, node));
  if (definition === undefined) {
    console.log(`service units: nothing to check on ${platform} (this build installs no service there)`);
    process.exit(0);
  }

  const file = join(directory, definition.relativePath.split("/").pop() ?? "unit");
  await writeFile(file, definition.contents, "utf8");

  // Two things are always checkable, on every lane: the text names the flag that makes the claim a service's, and it
  // is not empty. The rest is the encoding check and the native linter's job.
  if (!definition.contents.includes("--managed-by")) {
    console.error("service units: the definition does not pass --managed-by service");
    process.exit(1);
  }

  // The bytes on disk, never a decoded string: this is the check that would have caught a UTF-16 declaration over a
  // UTF-8 file, which no string-level check can see.
  const encoding = checkServiceUnitBytes(await readFile(file));
  if (!encoding.ok) {
    console.error(`service units: the ${definition.kind} definition was refused:\n  ${encoding.detail}`);
    process.exit(1);
  }

  const result =
    platform === "macos"
      ? await lint("plutil", ["-lint", file])
      : platform === "linux"
        ? // No `--recursive-errors=`: its exit-code effect differs between systemd versions, and the verdict this
          // gate relies on comes from the linter's own lines (see `serviceUnitLintProblems`).
          await lint("systemd-analyze", ["verify", file])
        : platform === "windows"
          ? // `XmlDocument.Load` on a *stream* — not `[xml](Get-Content -Raw …)`, which parses a .NET string and
            // therefore never applies the declaration or checks for the byte order mark it requires.
            await lint("powershell.exe", [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `$x = New-Object System.Xml.XmlDocument; $x.Load((Get-Item -LiteralPath '${file.replace(/'/g, "''")}').OpenRead())`,
            ])
          : { skipped: `${platform} has no service manager this build knows` };

  if (result.skipped !== undefined) {
    console.log(`service units: not checked — ${result.skipped} (the text itself is asserted by the suite)`);
  } else {
    const problems = serviceUnitLintProblems(definition.kind, result.code, result.output);
    if (problems.length > 0) {
      console.error(`service units: the ${definition.kind} definition was refused:\n${problems.join("\n")}`);
      process.exit(1);
    }
    // An empty problem list is "this check found nothing wrong", not "the linter is infallible" — and when the
    // declaration is one this check cannot compare, that is said rather than papered over.
    const encodingNote = encoding.checked ? "" : ` (encoding not verified: ${encoding.detail})`;
    console.log(`service units OK — ${definition.kind} text accepted by ${result.detail}${encodingNote}`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
