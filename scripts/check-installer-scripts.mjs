/**
 * The installer scripts, checked by the parser of the shell that will run them.
 *
 * `scripts/build-dmg.sh`, `build-exe.ps1` and `build-linux.sh` are the only path that produces a
 * *distributable* app — they stage the daemon, the Node runtime and Envoy Harness into the bundle resources and
 * build against `tauri.conf.bundle.json` — and nothing typechecks them. A shell script is not compiled until it
 * runs, and the run that matters is on somebody else's machine, at release time, after `git tag`. `bash -n` and
 * PowerShell's own parser cost nothing and catch the class of mistake that otherwise waits until then: a typo, an
 * unbalanced `if`, a missing `fi`.
 *
 * **A checker that cannot run says so.** PowerShell is not installed everywhere and `bash` may be missing on a
 * stripped Windows image; "could not check" and "is wrong" are different answers and only one should turn a build
 * red, so an absent parser prints a skip with the reason. The release lane runs the parser for its own platform,
 * which is where the real coverage comes from.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SHELL_SCRIPTS = ["scripts/build-dmg.sh", "scripts/build-linux.sh"];
const POWERSHELL_SCRIPTS = ["scripts/build-exe.ps1"];

/** Run a parser whose absence is a *skip*, not a failure. */
async function attempt(command, args) {
  try {
    await run(command, args);
    return { ok: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { skipped: `${command} is not installed here` };
    const output = `${error?.stdout ?? ""}${error?.stderr ?? ""}`.trim();
    return { ok: false, detail: output || String(error?.message ?? error) };
  }
}

/** Whichever PowerShell this machine has, without asking the platform: `pwsh` first, then the Windows name. */
async function parsePowerShell(file) {
  const command = `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile(${JSON.stringify(
    file,
  )}, [ref]$null, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { $_.Message }; exit 1 }`;
  const tried = [];
  for (const candidate of ["pwsh", "powershell.exe"]) {
    const result = await attempt(candidate, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command,
    ]);
    if (result.skipped === undefined) return result;
    tried.push(candidate);
  }
  return { skipped: `no PowerShell found (tried ${tried.join(", ")})` };
}

let failures = 0;
for (const relative of SHELL_SCRIPTS) {
  const file = path.join(root, relative);
  if (!existsSync(file)) {
    console.error(`installer scripts: ${relative} is missing`);
    failures += 1;
    continue;
  }
  const result = await attempt("bash", ["-n", file]);
  if (result.ok) console.log(`  ok   ${relative} (bash -n)`);
  else if (result.skipped !== undefined) console.log(`  skip ${relative} — ${result.skipped}`);
  else {
    console.error(`  FAIL ${relative} does not parse:\n${result.detail}`);
    failures += 1;
  }
}

for (const relative of POWERSHELL_SCRIPTS) {
  const file = path.join(root, relative);
  if (!existsSync(file)) {
    console.error(`installer scripts: ${relative} is missing`);
    failures += 1;
    continue;
  }
  const result = await parsePowerShell(file);
  if (result.ok) console.log(`  ok   ${relative} (PowerShell parser)`);
  else if (result.skipped !== undefined) console.log(`  skip ${relative} — ${result.skipped}`);
  else {
    console.error(`  FAIL ${relative} does not parse:\n${result.detail}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`installer scripts: ${failures} script(s) do not parse`);
  process.exit(1);
}
console.log("installer scripts OK — every parser available here accepted its script");
