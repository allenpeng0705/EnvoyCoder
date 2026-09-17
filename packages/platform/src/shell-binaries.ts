/**
 * **Where the user's own shell would find one program** — asked, rather than inferred from a directory list.
 *
 * ## The gap this closes, measured before it was written
 *
 * `./path-discovery.js` asks the login shell for its `PATH` and searches it. That is *most* of what "where
 * are the user's tools" means, and it is not all of it, in one specific and reproducible way: on the machine
 * this was written on, `/bin/zsh -ilc 'command -v dsh'` prints
 * `/Users/shileipeng/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh`, and the same shell asked for `$PATH`
 * from a clean environment prints 26 directories **none of which contains it** — because the entry is in the
 * environment an `npx` invocation gives its own children, not in anything the rc files write. A `$PATH` answer
 * is a *snapshot* of a list; `command -v` is the question the user's terminal actually answers when they type
 * the name, and the two differ wherever a shell computes a lookup rather than reading a variable: a shim a
 * toolchain manager installs per directory (`nvm`, `volta`, `asdf`), a hash entry, a directory an `npx`/`bunx`
 * child inherited, a path added by a wrapper the rc files do not re-run for us.
 *
 * So this module asks the shell about **the names we care about**, in one invocation, and records the answers.
 * A binary the user's own shell resolves is *installed* — that is a fact about their machine rather than an
 * inference from a list we reconstructed — and `findBinary` finds it because the answer's directory joins the
 * search path (`composeSearchPath`), which is also the directory the child gets in its `PATH`.
 *
 * ## What it is not allowed to do
 *
 *   * **Not a second, disagreeing answer.** It does not return "is it installed"; it returns a path, and that
 *     path joins the same list the probe searches and the launch hands to the child — see
 *     `SearchPath.shellBinaries`. A resolution mechanism that the spawn did not share is exactly the defect
 *     this repository keeps paying for ("the row says missing while the launch works").
 *   * **Not unbounded.** One shell, one deadline (`LOGIN_SHELL_BINARY_TIMEOUT_MS`), a bounded amount of output
 *     (`LOGIN_SHELL_MAX_OUTPUT`), and the same marker discipline as the `PATH` probe: read the line we asked
 *     for, never "the last line", because this machine's rc files print `Restored session: …` on stdout.
 *   * **Not a shell-injection surface.** Names are **validated against a closed character set** before they
 *     reach the script, and anything else is skipped rather than escaped: a provider's command is
 *     user-controlled data, and the safe reading of "put this in a shell script" is "refuse, do not quote
 *     carefully". The set admits no shell metacharacter, so no quoting is needed — and a test asserts the
 *     refusal rather than the escaping.
 *   * **Not POSIX-blind.** Windows is out of scope for the same reason it is in `path-discovery.ts`: the
 *     registry `PATH` reaches a GUI process there, so there is nothing to repair.
 *   * **Never on the daemon's critical path.** `shellResolvedBinary()` is a synchronous read of what has
 *     already landed; only `primeShellBinaries()` spawns, and the daemon calls it at boot (off the critical
 *     path) exactly as it calls `primeSearchPath()`.
 *
 * ## Why a cache, and what "asked" means
 *
 * One login shell answers for *all* the names, and a name is asked about **once per process**: `nvm`/`volta`
 * users whose rc files take a second to run should not pay that cost on every probe. Unlike the `PATH`
 * answer — which caches `null` on failure so a hanging rc file is not retried — a *failed* ask here is not
 * remembered as "no answer for this binary": the whole invocation either answered or it did not, and a
 * timeout is recorded for the names in that invocation only, so a later ask can still succeed. That
 * asymmetry is deliberate: a missing `PATH` answer still leaves the process environment to search, while a
 * missing binary answer is only ever a *missed opportunity*, never a claim.
 */

import { execFile } from "node:child_process";

import { type PlatformId, detectPlatform, isPosix } from "./index.js";

/**
 * The marker the script prints in front of each answer.
 *
 * One line per name, so a name whose answer is empty (the shell could not find it) is *stated* rather than
 * inferred from an absence — the same reason the `PATH` probe prints its value behind a marker.
 */
export const LOGIN_SHELL_BINARY_MARKER = "__ENVOYDEV_LOGIN_BINARY__=";

/** How long one shell may take to answer for every name before we stop waiting. */
export const LOGIN_SHELL_BINARY_TIMEOUT_MS = 2500;

/** The most a login shell may write to stdout before its answer is treated as hostile. */
export const LOGIN_SHELL_BINARY_MAX_OUTPUT = 64 * 1024;

/**
 * The characters a name may contain, and the reason this is a closed set rather than an escaping helper.
 *
 * The names come from two places: our own catalogue (`dsh`, `codex-acp`, `cursor-agent`) and **a command line
 * a user typed** (`AgentProviderConfig.command`). Interpolating the second into a shell script and relying on
 * quoting is a defect waiting for one clever string; refusing anything that is not a plain command name is a
 * decision that cannot fail that way. A name containing `/` is skipped too — an absolute path is resolved
 * without a shell at all (`findBinary`), so there is nothing to ask about.
 */
const SHELL_SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** Is this a name we will put in front of a shell at all? */
export function isShellAskeableName(name: string): boolean {
  return SHELL_SAFE_NAME.test(name.trim());
}

/**
 * The `argv` for one invocation that answers for every name.
 *
 * `-i` runs the user's rc files, which is the whole point (they are what sets a toolchain manager up); `-l`
 * matches what a terminal window opens. Each name gets its own marked line, so a name the shell cannot find
 * arrives as an empty value rather than as a missing line, and `command -v` is used rather than `which`:
 * `which` is an external program with its own bugs and its own exit codes, while `command -v` is the shell's
 * own lookup — the thing a user's terminal does.
 */
export function loginShellBinaryCommand(
  shell: string,
  names: readonly string[],
  options: { platform?: PlatformId; marker?: string } = {},
): { command: string; args: string[] } {
  const platform = options.platform ?? detectPlatform();
  const marker = options.marker ?? LOGIN_SHELL_BINARY_MARKER;
  const wanted = names.map((name) => name.trim()).filter(isShellAskeableName);
  // Every name is inside the safe set, so it needs no quoting — and `printf`'s marker plus a tab is what makes
  // the line unambiguous without depending on `command -v`'s own output shape.
  const script = wanted
    .map((name) => `printf '\\n%s%s\\t%s\\n' '${marker}' '${name}' "$(command -v '${name}' 2>/dev/null)"`)
    .join("; ");
  // An empty script is not a script: `sh -c ''` succeeds and prints nothing, which reads as "no answer" and
  // would cache a miss for names nobody asked about. The caller filters first; this is the second line.
  if (platform === "windows") return { command: shell, args: ["/d", "/s", "/c", script] };
  return { command: shell, args: ["-ilc", script || "true"] };
}

/**
 * Is this what the shell's answer looks like, or is it an alias, a function or prose?
 *
 * `command -v` prints three different kinds of thing: an absolute path (what we want), `name: aliased to …`
 * (an alias has no path to spawn), and a function's whole body (ditto). A value that is not an absolute path
 * is therefore **not** a defect to report — it is a resolution we cannot use, and the honest response is to
 * ignore it so the ordinary search decides. A relative path is refused with them: `spawn` resolves a relative
 * command against the daemon's own working directory, which is not the user's shell's.
 */
export function looksLikeBinaryPath(value: string, platform: PlatformId = detectPlatform()): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4096) return false;
  // A newline or a tab means we captured more than the value: a function body, or a second command.
  if (/[\r\n\t]/.test(trimmed)) return false;
  if (platform === "windows") {
    return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\");
  }
  return trimmed.startsWith("/");
}

/**
 * Read the answers out of what the shell printed.
 *
 * Read **by marker**, like the `PATH` probe, and the **last** occurrence of a name wins so an rc file that
 * printed our marker itself cannot shadow the answer our own `printf` produced after it. Names we did not ask
 * about are ignored rather than trusted: a line is only believed if it answers one of our questions.
 */
export function parseShellBinaries(
  stdout: string,
  names: readonly string[],
  options: { marker?: string; platform?: PlatformId } = {},
): Map<string, string> {
  const marker = options.marker ?? LOGIN_SHELL_BINARY_MARKER;
  const platform = options.platform ?? detectPlatform();
  const wanted = new Set(names.map((name) => name.trim()).filter(isShellAskeableName));
  const out = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const at = line.lastIndexOf(marker);
    if (at < 0) continue;
    const rest = line.slice(at + marker.length);
    const tab = rest.indexOf("\t");
    if (tab < 0) continue;
    const name = rest.slice(0, tab).trim();
    const value = rest.slice(tab + 1).trim();
    if (!wanted.has(name)) continue;
    if (!looksLikeBinaryPath(value, platform)) continue;
    out.set(name, value);
  }
  return out;
}

/** What one ask produced, and — when it produced nothing — why, in the order the checks run. */
export interface ShellBinariesRead {
  /**
   * Names the shell answered an absolute path for. A name it could not find is simply absent.
   *
   * Always present, and empty when nothing was learned: a caller that had to check for `undefined` would be
   * one `??` away from reading "no answer" as "no programs", which is the exact confusion the `reason` field
   * exists to prevent.
   */
  binaries: ReadonlyMap<string, string>;
  /** Why there is no answer at all, for the log and a bug report. Never rendered to a user. */
  reason?: "no-shell" | "not-posix" | "no-names" | "failed" | "no-output" | "too-large";
  /** The raw stdout, truncated, for the log. */
  raw?: string;
}

/**
 * Ask a login shell where it would find each of these names.
 *
 * Every failure mode returns a `reason` rather than throwing, because the caller's next step is the same for
 * all of them: the ordinary search decides, and nothing is claimed about the machine. The one case that is
 * *not* a failure is a name the shell could not find — that arrives as an empty value, and the result simply
 * has no entry for it.
 */
export async function readLoginShellBinaries(
  names: readonly string[],
  options: {
    platform?: PlatformId;
    env?: NodeJS.ProcessEnv;
    /** The shell to ask. Defaults to `$SHELL`. */
    shell?: string;
    timeoutMs?: number;
    /** Injectable for a test that wants a deadline, garbage or a scripted answer without writing an rc file. */
    command?: { command: string; args: readonly string[] };
    exec?: typeof execFile;
  } = {},
): Promise<ShellBinariesRead> {
  const platform = options.platform ?? detectPlatform();
  const env = options.env ?? process.env;
  const nothing = (reason: ShellBinariesRead["reason"], raw?: string): ShellBinariesRead => ({
    binaries: new Map(),
    ...(reason !== undefined ? { reason } : {}),
    ...(raw !== undefined ? { raw } : {}),
  });
  if (!isPosix(platform)) return nothing("not-posix");
  const wanted = names.map((name) => name.trim()).filter(isShellAskeableName);
  if (wanted.length === 0) return nothing("no-names");
  const shell = (options.shell ?? env.SHELL ?? "").trim();
  const spec = options.command ?? (shell ? loginShellBinaryCommand(shell, wanted, { platform }) : undefined);
  if (!spec) return nothing("no-shell");

  const run = options.exec ?? execFile;
  type Outcome = { text?: string; reason?: ShellBinariesRead["reason"] };
  const read = await new Promise<Outcome>((resolve) => {
    let settled = false;
    const finish = (value: Outcome) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child: ReturnType<typeof execFile>;
    try {
      child = run(
        spec.command,
        [...spec.args],
        {
          env: { ...env },
          timeout: options.timeoutMs ?? LOGIN_SHELL_BINARY_TIMEOUT_MS,
          maxBuffer: LOGIN_SHELL_BINARY_MAX_OUTPUT,
          windowsHide: true,
        },
        (error, stdout) => {
          const text = stdout === undefined ? "" : typeof stdout === "string" ? stdout : String(stdout);
          // A shell that exited non-zero *after* printing answers is still worth reading — `command -v`
          // failing for one name does not fail the script — so this only gives up on an empty result.
          if (error && text === "") {
            finish({ reason: "failed" });
            return;
          }
          finish({ text });
        },
      );
      child.on("error", () => finish({ reason: "failed" }));
    } catch {
      finish({ reason: "failed" });
    }
  });

  if (read.reason !== undefined && read.text === undefined) return nothing(read.reason);
  const stdout = read.text ?? "";
  if (stdout === "") return nothing("no-output");
  if (stdout.length >= LOGIN_SHELL_BINARY_MAX_OUTPUT) return nothing("too-large");
  const binaries = parseShellBinaries(stdout, wanted, { platform });
  if (binaries.size === 0) return nothing("no-output", stdout.slice(-512));
  return { binaries };
}

/* ────────────────────────────── the cache ────────────────────────────── */

/**
 * The answers, once they have landed — module state for the same reason `path-discovery.ts` uses it: every
 * consumer is on a path too hot and too synchronous to await a shell.
 */
const answers = new Map<string, string>();
/** The names already asked about, so a second ask for the same name costs nothing. */
const asked = new Set<string>();
let inFlight: Promise<ReadonlyMap<string, string>> | undefined;
/**
 * How many times the answers have changed.
 *
 * Read by `composeSearchPath`'s snapshot, and the reason it is a counter rather than a callback: the `PATH`
 * prime and the per-name prime are two separate shell invocations landing at two different times, so a
 * snapshot composed after the first must be recomposed after the second — and `path-discovery.ts` imports
 * *this* module rather than the other way round, so there is no cycle to carry a notification through.
 */
let generation = 0;

/** The answers that have landed, for `composeSearchPath`. Synchronous, and spawns nothing. */
export function shellResolvedBinaries(): ReadonlyMap<string, string> {
  return answers;
}

/** The generation of `shellResolvedBinaries()` — see `generation`. */
export function shellBinariesGeneration(): number {
  return generation;
}

/**
 * Ask about every name we have not asked about yet, and cache what came back.
 *
 * Serialised, and the names are read **before** the await: two callers arriving together (the boot prime and
 * a provider just added) would otherwise both ask about the same name, which is one more login shell than the
 * user's rc files deserve. Names already asked are dropped, so the second call is often a no-op.
 *
 * A call that names its own world (`env`, `home`, `platform`, `shell`) is answered for that world and
 * **not** cached, following `namesItsOwnWorld` in `path-discovery.ts` for the same reason: a test's shell must
 * not become the daemon's answer. Injecting `command`/`timeoutMs` says *how* to ask, not *which* world — so a
 * scripted shell still caches, which is what lets a test prove the mechanism end to end.
 */
export async function primeShellBinaries(
  names: readonly string[],
  options: Parameters<typeof readLoginShellBinaries>[1] = {},
): Promise<ReadonlyMap<string, string>> {
  const ownWorld =
    options?.env !== undefined || options?.platform !== undefined || options?.shell !== undefined;
  const wanted = names.map((name) => name.trim()).filter(isShellAskeableName);
  if (ownWorld) {
    const read = await readLoginShellBinaries(wanted, options);
    return read.binaries;
  }
  const missing = wanted.filter((name) => !asked.has(name));
  for (const name of missing) asked.add(name);
  if (missing.length === 0) return answers;
  if (inFlight) return inFlight;
  const run = readLoginShellBinaries(missing, options)
    .then((read) => {
      /**
       * A failed **invocation** is not an answer, so it is not remembered as one: the names go back on the
       * unasked list and a later call asks again. The asymmetry with the `PATH` probe is deliberate and points
       * the other way — there a timeout caches `null` forever, because the process environment is still a list
       * worth searching; here a miss costs only the opportunity the shell offered, so a shell that timed out
       * once during boot (a slow `nvm` rc file, a machine under load) must not disable the mechanism for the
       * life of the daemon.
       */
      const failed = read.reason !== undefined && read.binaries.size === 0;
      if (failed) for (const name of missing) asked.delete(name);
      if (read.binaries.size > 0) generation += 1;
      for (const [name, path] of read.binaries) answers.set(name, path);
      return answers;
    })
    .finally(() => {
      inFlight = undefined;
    });
  inFlight = run;
  return run;
}

/**
 * **Ask again about names that have already been asked about.**
 *
 * `primeShellBinaries` remembers every name it has asked, so a name the shell could not find is never looked
 * for again for the life of the process. That is right at boot — one login shell is expensive and a user's rc
 * files should pay for it once — and it is wrong the moment the user installs something while the app is
 * open: *"I ran `npm install -g …` and it still says missing"* is this cache, and the fix is not a cleverer
 * search but the willingness to ask a second time.
 *
 * Only names already asked are forgotten, so a re-ask cannot invent work nobody wanted: a name that has never
 * been asked about is asked by the ordinary path, and one the daemon does not care about is not asked at all.
 * Names the shell *did* resolve keep their answer — a successful resolution is not in question, and dropping
 * it would make every re-ask re-derive what a real installation already told us.
 */
export async function reaskShellBinaries(
  names: readonly string[],
  options: Parameters<typeof readLoginShellBinaries>[1] = {},
): Promise<ReadonlyMap<string, string>> {
  for (const name of names) {
    const trimmed = name.trim();
    if (answers.has(trimmed)) continue;
    asked.delete(trimmed);
  }
  return primeShellBinaries(names, options);
}

/**
 * Forget everything, for tests.
 *
 * Named as a warning rather than a generic `reset()`: this is module state production code must never clear,
 * and a test that leaves it dirty makes the next suite depend on the order it ran in.
 */
export function resetShellBinaryCacheForTests(): void {
  answers.clear();
  asked.clear();
  inFlight = undefined;
  generation += 1;
}
