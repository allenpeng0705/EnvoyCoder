/**
 * The `PATH` a GUI-launched daemon should search — **found rather than inherited.**
 *
 * ## The bug this exists for
 *
 * EnvoyCoder's daemon is started by the Tauri shell, and on macOS a process started by a **GUI** launch
 * inherits launchd's environment rather than the user's. Measured on the machine this was written on:
 * `launchctl getenv PATH` prints nothing at all, and every Finder-launched process sampled (loginwindow,
 * the Xcode Python shim, …) has **no `PATH` in its environment**. So "is `claude` installed?" was computed
 * from a search list that did not contain the directory `claude` lives in — `claude` at `~/.local/bin`,
 * `codex` at `~/.npm-global/bin`, `cursor-agent` at `~/.local/bin`. The user had installed all of them and
 * the window said "Not installed", which is the wrong word about a program that is there.
 *
 * The same measurement showed the second half: a daemon started from a terminal (`npm run tauri:dev`, the
 * development arrangement) inherits the shell's `PATH` and therefore answered differently from the same
 * daemon started from Finder. Two launches of one product disagreeing about what is installed is how a bug
 * report becomes "it works for me".
 *
 * ## What this module decides, and in what order
 *
 * The rule is **prefer what a login shell would see, then widen to the well-known directories, then to the
 * caches another tool left behind**, because "the user's tools are where their terminal finds them" is the
 * honest definition of installed, and each later source is what rescues a launch the earlier ones cannot
 * describe:
 *
 *   0. **The directories of the programs the login shell named for us, one name at a time** —
 *      `./shell-binaries.js` asks `$SHELL -ilc 'command -v NAME'` about the names the catalogue cares about,
 *      and each answer that is really there contributes its own directory **first**. This is a *different*
 *      fact from step 1 rather than a refinement of it, and the receipt is on this machine: with a clean
 *      environment the login shell's `PATH` has 26 entries and **none of them contains `dsh`**, while
 *      `command -v dsh` in the same shell names `/Users/…/.npm/_npx/<hash>/node_modules/.bin/dsh`. A shell
 *      asked for `$PATH` reports a variable; a shell asked for a name reports *the lookup it performs*.
 *   1. **The login shell's own answer** — `$SHELL -ilc 'printf …'`, with a timeout. The only *list* source
 *      that includes what the user's rc files add.
 *   2. **The daemon's own `PATH`** — what the asking process actually inherited. Honest by definition, and
 *      the only POSIX source on Windows, where the registry `PATH` *is* delivered to GUI processes, so
 *      there is nothing to repair and `wellKnownBinDirs` returns nothing.
 *   3. **The well-known directories that exist on this machine** — see `wellKnownBinDirs`.
 *   4. **npm's `npx` cache** — see `cacheBinDirs`. Last, because it is the least like an installation, and
 *      present at all because without it `dsh` on this machine reads as *not installed* while the owner is
 *      running it: the directory is created by somebody's `npx` invocation, so it is in no `PATH` this
 *      process can reconstruct, and a program that is genuinely runnable is not absent.
 *
 * The result is a **deduplicated union in that order**, so the user's own answer always wins a name collision
 * and later sources can only *add* candidates. Step 2's directories are kept even when step 1 answered: a
 * profile that *replaces* `PATH` instead of extending it would otherwise make the daemon forget where it
 * was launched from.
 *
 * ## Bounded, and never on the daemon's critical path
 *
 * A login shell runs the user's rc files, and this repository has the receipt for what those do: on the
 * machine this was written on, `/bin/zsh -ilc 'printf %s "$PATH"'` prints **`Restored session: Mon Sep 14
 * 23:42:52 CST 2026` on stdout, before the `PATH`**. So the output is read by **marker**, not by taking
 * the last line, and the extracted value is validated as a plausible `PATH` before it is believed. An rc
 * file that hangs, exits non-zero, writes megabytes, or prints nonsense all end the same way: no answer,
 * and the fallbacks above.
 *
 *   * `LOGIN_SHELL_TIMEOUT_MS` bounds the wait and the child is killed on expiry.
 *   * `LOGIN_SHELL_MAX_OUTPUT` bounds what it may write; past that we walk away.
 *   * **The synchronous accessor never spawns.** `currentSearchPath()` answers from what has already
 *     landed; `refreshSearchPath()` is the async half a daemon primes at boot. That split is what makes
 *     "never block the daemon on a shell" a property of the module rather than a promise about callers —
 *     no code path exists by which a request handler can wait for a shell.
 *
 * ## What "unknown" means here, and why it is not "not installed"
 *
 * `searchable` is false when **no source yielded a single directory**: an unset `HOME`, an empty `PATH`,
 * and a machine where none of the well-known directories exist (a stripped container, a service account).
 * Then the daemon genuinely could not look, and the probe that consumes this reports `unknown`. A login
 * shell that timed out is **not** that case — the fallbacks still ran, so a search did happen and its
 * negative result is real. Collapsing the two would turn "we could not look" into "it is not installed".
 *
 * ## Why it does not import its own package's index
 *
 * It needs `detectPlatform`, `capabilitiesFor` and `isPosix`, which live in `./index.js`, and `index.ts`
 * re-exports this module — a cycle. A **type-only** import of `PlatformId` is erased at compile time and
 * costs nothing; for the three runtime helpers the cycle is real, so it is broken here by declaring the
 * two facts this module actually uses (the path delimiter and the support matrix's shape) and reading the
 * matrix entry through the accessor `index.ts` exports lazily, inside functions. `vitest` and `tsc` both
 * accept the cycle; this comment exists because the next reader will otherwise wonder, and because a
 * *function-level* cycle has no initialisation order to get wrong — the failure mode a cycle usually has.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import * as path from "node:path";

import { capabilitiesFor, detectPlatform, isPosix, type PlatformId } from "./index.js";
import { shellBinariesGeneration, shellResolvedBinaries } from "./shell-binaries.js";

/** How long a login shell may take before we stop waiting for it. */
export const LOGIN_SHELL_TIMEOUT_MS = 2500;

/** The most a login shell may write to stdout before we give up on it as hostile. */
export const LOGIN_SHELL_MAX_OUTPUT = 64 * 1024;

/**
 * The marker the login-shell script prints in front of the `PATH`.
 *
 * A marker rather than "the last line", because rc files write to stdout — see the module header for the
 * measured example. The **last** occurrence wins, so an rc file that prints the marker itself cannot
 * shadow the answer our own `printf` produced after it.
 */
export const LOGIN_SHELL_PATH_MARKER = "__ENVOYCODER_LOGIN_PATH__=";

/** Where the answer came from. The first thing a bug report needs. */
export type SearchPathSource = "login-shell" | "process-env" | "well-known" | "cache" | "none";

export interface SearchPath {
  /**
   * The list, ready for a child process, in search order.
   *
   * Empty when `searchable` is false — a `PATH` of `""` is what an unset `PATH` looks like to `execvp`,
   * and inventing something would have a spawn search directories nobody chose.
   */
  path: string;
  /** The same list, one entry each, deduplicated and with `~/` expanded. */
  dirs: readonly string[];
  /** Where the **first** directory came from. `"none"` means nothing answered. */
  source: SearchPathSource;
  /**
   * True when we assembled a list worth searching.
   *
   * False is the state to report as `unknown`, never as "not installed": it is the absence of a search
   * rather than the result of one.
   */
  searchable: boolean;
  /** The directories the well-known list actually contributed, in order (each must exist to be added). */
  added: readonly string[];
  /** True when a login shell answered — for its `PATH`, for one of the names below, or for both. */
  fromLoginShell: boolean;
  /**
   * The programs the user's own login shell named, one `command -v` at a time (`./shell-binaries.js`).
   *
   * On the list rather than in a lookup table because of the invariant this whole module is built around:
   * **the probe and the spawn read the same list**, so a program the shell resolves is found by the walk and
   * is on the child's `PATH` for the same reason. `dir` is the directory that was contributed to `dirs`, and
   * it is recorded so a bug report can say *why* a directory nobody configured is in the list.
   */
  shellBinaries: readonly ShellBinaryAnswer[];
  /** The directories another tool's cache contributed, in order (see `cacheBinDirs`). */
  cached: readonly string[];
}

/** One program the user's own login shell resolved, and the directory that joined the search list for it. */
export interface ShellBinaryAnswer {
  /** The name the shell was asked about. */
  name: string;
  /** The absolute path it answered. */
  path: string;
  /** The directory of that path — what `dirs` gained. */
  dir: string;
}


export interface SearchPathOptions {
  platform?: PlatformId;
  env?: NodeJS.ProcessEnv;
  /** The home directory to expand `~` against and to look for `~/.local/bin` in. */
  home?: string;
  /** Injectable so a test can decide what exists without a filesystem. */
  exists?: (candidate: string) => boolean;
}

/**
 * Did the caller name its own world?
 *
 * The distinction decides whether an answer may be cached: a call carrying an explicit `env`, `HOME` or
 * `exists` is a question *about that world* — a test's, or another machine's — and caching it globally
 * would serve one world's `PATH` to another. Only the default call, which asks about the process the
 * daemon is, is memoised.
 *
 * `shell`, `command`, `exec` and `timeoutMs` are deliberately **not** here: they say *how* the question is
 * asked, not *which* world it is about. A caller that injects a scripted shell — a test, or a product that
 * ships its own — is still asking about this process's environment, and treating that as a foreign world
 * would silently disable the cache it was trying to exercise.
 */
function namesItsOwnWorld(options: SearchPathOptions): boolean {
  return (
    options.env !== undefined ||
    options.platform !== undefined ||
    options.home !== undefined ||
    options.exists !== undefined
  );
}

/**
 * The directories a user's tools land in, on this platform, in the order we would rather find one.
 *
 * POSIX only, and that is a decision rather than an omission: on Windows the tools a GUI app needs are on
 * the registry `PATH` the process already inherited, so there is nothing to repair and a hard-coded
 * `~/.npm-global/bin` would be a guess about a layout Windows does not have.
 *
 * Each entry earns its place: `~/.local/bin` is where the Claude Code native installer puts `claude` (and
 * where this machine's `cursor-agent` is), `~/.npm-global/bin` is where a `--prefix ~/.npm-global` npm
 * puts a global CLI (this machine's `codex`), `/opt/homebrew/bin` is Apple-silicon Homebrew, and
 * `/usr/local/bin`, `~/.cargo/bin` and `~/.bun/bin` are the remaining three the report named.
 *
 * Returned **unfiltered**: existence is `composeSearchPath`'s business, and a caller asking "where would
 * they be?" should not be told "nowhere" because a directory is missing today.
 */
export function wellKnownBinDirs(options: SearchPathOptions = {}): string[] {
  const platform = options.platform ?? detectPlatform();
  if (!isPosix(platform)) return [];
  const env = options.env ?? process.env;
  const home = (options.home ?? env.HOME ?? "").trim();
  if (!home) return [];
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".cargo", "bin"),
    path.join(home, ".bun", "bin"),
  ];
}

/**
 * **npm's `npx` cache**: the `node_modules/.bin` of every package tree `npx` has unpacked.
 *
 * ## Why a cache is searched at all, since it is not an installation
 *
 * Because the alternative is a lie the owner caught. `dsh` on the machine this was written on lives at
 * `~/.npm/_npx/<hash>/node_modules/.bin/dsh`, and **nothing else on that machine names that directory**: a
 * clean-environment login shell answers 26 `PATH` entries without it, the daemon's own `PATH` has 48 without
 * it, and it is on no well-known list — it exists only in the environment an `npx` invocation gives its own
 * children. So DeepSeek Harness read as **not installed** in a window owned by somebody who uses it every day,
 * which is the report this closes. The program is really there and really runs (`acp-transport.test.ts` drives
 * it), so "absent" was the wrong word about a fact.
 *
 * What it is *not* is a promise: the directory has a random hash in its name and `npm cache clean` removes it.
 * So a hit here is still classified by `provisionalCacheOf` and still carries the window's warning chip — the
 * distinction the previous round got right and simply never reached, because the hit it was written for could
 * not happen.
 *
 * ## Ordering, and why the hash is not sorted into meaning
 *
 * Newest-first by directory mtime would be a guess; `readdir` order is a filesystem accident. Entries are
 * therefore **sorted by name**, and the whole list is appended *after* every source that is a user's own
 * install — so with a proper `dsh` on `PATH` this changes nothing, and with only the cache there the answer
 * is the cache's copy rather than nothing.
 *
 * `~/.bun/install/cache` and pnpm's `dlx` store are **deliberately not enumerated**: their layouts have not
 * been read on a machine that has them, and a glob written from memory is how a search list acquires a
 * directory that never exists. `provisionalCacheOf` still recognises both, so a hit that arrives through a
 * `PATH` is still reported as provisional.
 */
export function cacheBinDirs(
  options: SearchPathOptions & { readDir?: (dir: string) => readonly string[] } = {},
): string[] {
  const platform = options.platform ?? detectPlatform();
  if (!isPosix(platform)) return [];
  const env = options.env ?? process.env;
  const home = (options.home ?? env.HOME ?? "").trim();
  if (!home) return [];
  const root = path.join(home, ".npm", "_npx");
  const readDir =
    options.readDir ??
    ((dir: string) => {
      try {
        return readdirSync(dir);
      } catch {
        // No `_npx` directory at all is the ordinary case for a user who has never run `npx`.
        return [];
      }
    });
  return [...readDir(root)]
    .filter((entry) => entry !== "" && !entry.startsWith("."))
    .sort()
    .map((entry) => path.join(root, entry, "node_modules", ".bin"));
}

/**
 * Split a `PATH` string into entries the way a shell would, with the one repair a shell would not do.
 *
 * A leading `~/` is expanded, and the reason is measured rather than theoretical: this machine's
 * `/etc/paths` contains the literal entry `~/.dotnet/tools`, and `/usr/libexec/path_helper` copies it into
 * every login shell's `PATH` **verbatim** — so a daemon that searched that entry literally would look for a
 * directory named `~`. Empty entries are dropped rather than kept as "the current directory", which is the
 * historical and unsafe reading of a bare `::`.
 */
export function splitPathEntries(raw: string, options: SearchPathOptions = {}): string[] {
  const platform = options.platform ?? detectPlatform();
  const env = options.env ?? process.env;
  const home = (options.home ?? env.HOME ?? "").trim();
  const delimiter = capabilitiesFor(platform).pathDelimiter;
  const out: string[] = [];
  for (const piece of raw.split(delimiter)) {
    const entry = piece.trim();
    if (!entry) continue;
    if (home && (entry === "~" || entry.startsWith("~/") || entry.startsWith("~\\"))) {
      out.push(`${home}${entry.slice(1)}`);
      continue;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Is this what a `PATH` looks like, or is it an rc file's chatter?
 *
 * The marker already discards output we did not ask for, so this is the second line of defence: a shell
 * whose `printf` produced something that is not a `PATH` must not be believed, because believing it would
 * silently make every agent look uninstalled. The test is deliberately weak — a real `PATH` may contain
 * entries that do not exist, and this machine's contains one that is not even absolute (see
 * `splitPathEntries`) — so it asks for **at least one absolute entry** and nothing that looks like prose.
 */
export function looksLikePath(raw: string, platform: PlatformId = detectPlatform()): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > LOGIN_SHELL_MAX_OUTPUT) return false;
  const entries = splitPathEntries(trimmed, { platform, home: "" });
  if (entries.length === 0) return false;
  // A newline inside an entry means we captured more than one line: prose, not a PATH.
  if (entries.some((entry) => entry.length > 4096 || /[\r\n]/.test(entry))) return false;
  const absolute = (entry: string) =>
    platform === "windows"
      ? /^[A-Za-z]:[\\/]/.test(entry) || entry.startsWith("\\\\")
      : entry.startsWith("/");
  return entries.some(absolute);
}

/** The `argv` for the login-shell probe: interactive, login, and printing the marked `PATH`. */
export function loginShellCommand(
  shell: string,
  options: { platform?: PlatformId; marker?: string } = {},
): { command: string; args: string[] } {
  const platform = options.platform ?? detectPlatform();
  const marker = options.marker ?? LOGIN_SHELL_PATH_MARKER;
  // `-i` is what runs the user's rc files, which is the entire point; `-l` gives a login shell, matching
  // what a terminal window opens. The `printf` is the last thing the startup sequence runs, so our marker
  // follows whatever noise the rc files made.
  const script = `printf '\\n%s%s\\n' '${marker}' "$PATH"`;
  if (platform === "windows") return { command: shell, args: ["/d", "/s", "/c", script] };
  return { command: shell, args: ["-ilc", script] };
}

/** What `readLoginShellPath` walks away from, and what it hands back. */
export interface LoginShellRead {
  /** The `PATH` the shell reported, when it reported a believable one. */
  path?: string;
  /**
   * Why there is no path, in the order the checks run.
   *
   * Not rendered to a user — the daemon's log and a bug report are what read it — but it is the difference
   * between "no `$SHELL` on this machine", "it hung", and "it printed something that is not a `PATH`",
   * which are three different support conversations.
   */
  reason?:
    | "no-shell"
    | "not-posix"
    | "no-output"
    | "failed"
    | "no-marker"
    | "not-a-path"
    | "too-large";
  /** The raw stdout, for the log. Truncated. */
  raw?: string;
}

/**
 * Ask a login shell what `PATH` it would give.
 *
 * Every failure mode returns a `reason` rather than throwing, because the caller's next step is the same
 * for all of them: use the fallbacks. The four considered rather than discovered — a shell that is not
 * installed, one that hangs (killed on the deadline), one that writes more than
 * `LOGIN_SHELL_MAX_OUTPUT`, and one that exits non-zero after printing garbage — are covered by tests that
 * run **real** processes.
 */
export async function readLoginShellPath(
  options: SearchPathOptions & {
    /** The shell to ask. Defaults to `$SHELL`. */
    shell?: string;
    timeoutMs?: number;
    /** Injectable for a test that wants a deadline or garbage without writing an rc file. */
    command?: { command: string; args: readonly string[] };
    exec?: typeof execFile;
  } = {},
): Promise<LoginShellRead> {
  const platform = options.platform ?? detectPlatform();
  const env = options.env ?? process.env;
  if (!isPosix(platform)) return { reason: "not-posix" };
  const shell = (options.shell ?? env.SHELL ?? "").trim();
  const spec = options.command ?? (shell ? loginShellCommand(shell, { platform }) : undefined);
  if (!spec) return { reason: "no-shell" };

  const run = options.exec ?? execFile;
  /** What the child produced, or why it produced nothing usable. */
  type ShellOutcome = { text?: string; reason?: LoginShellRead["reason"] };
  const read = await new Promise<ShellOutcome>((resolve) => {
    let settled = false;
    const finish = (value: ShellOutcome) => {
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
          timeout: options.timeoutMs ?? LOGIN_SHELL_TIMEOUT_MS,
          maxBuffer: LOGIN_SHELL_MAX_OUTPUT,
          // The daemon's stdin is the void, and an interactive shell that tries to read from it would
          // block until the deadline for a reason that is not the shell's fault.
          windowsHide: true,
        },
        (error, stdout) => {
          // `String(buffer)` is the buffer's utf8 text; the cast is for the overload's `string` type,
          // which Node widens to `Buffer` at run time under no `encoding` option.
          const text = stdout === undefined ? "" : typeof stdout === "string" ? stdout : String(stdout);
          if (error && text === "") {
            finish({ reason: "failed" });
            return;
          }
          finish({ text });
        },
      );
      // `execFile` reports a failed *spawn* through the callback **and** an `error` event; unhandled, the
      // event would take the daemon down. The callback has already answered, so this is a no-op then.
      child.on("error", () => finish({ reason: "failed" }));
    } catch {
      finish({ reason: "failed" });
    }
  });

  if (read.reason !== undefined && read.text === undefined) return { reason: read.reason };
  const stdout = read.text ?? "";
  if (stdout === "") return { reason: "no-output" };
  if (stdout.length >= LOGIN_SHELL_MAX_OUTPUT) return { reason: "too-large" };
  const at = stdout.lastIndexOf(LOGIN_SHELL_PATH_MARKER);
  if (at < 0) return { reason: "no-marker", raw: stdout.slice(-512) };
  const value = (stdout.slice(at + LOGIN_SHELL_PATH_MARKER.length).split(/\r?\n/)[0] ?? "").trim();
  if (!looksLikePath(value, platform)) {
    return { reason: "not-a-path", raw: value.slice(0, 256) };
  }
  return { path: value };
}

/** The empty answer table, shared so the "no shell answers for this world" case allocates nothing. */
const EMPTY_BINARIES: ReadonlyMap<string, string> = new Map();

/** Everything `composeSearchPath` needs. Pure: no environment, clock or filesystem of its own. */
export interface ComposeSearchPathInput extends SearchPathOptions {
  /** The login shell's answer, when one arrived. */
  loginShell?: string | undefined;
  /** The process's own `PATH`. Read from `env` when omitted. */
  processPath?: string;
  /**
   * What the login shell answered for individual names, when the caller would rather not read the cache.
   *
   * Defaults to `shellResolvedBinaries()` — the module state `primeShellBinaries` fills. A test that wants to
   * assert the ordering rule without priming a shell passes its own table, which is the same arrangement
   * `loginShell` already has.
   */
  shellBinaries?: ReadonlyMap<string, string>;
  /** Injectable for a test that wants to decide what is in a tool cache without a filesystem. */
  readDir?: (dir: string) => readonly string[];
}

/**
 * Assemble the search list from the four sources, in the documented order.
 *
 * Exported and pure so the ordering rule — "what the user's own shell said wins a collision, and nothing a
 * later source adds can shadow an earlier one" — is asserted directly rather than inferred from a spawn.
 */
export function composeSearchPath(input: ComposeSearchPathInput = {}): SearchPath {
  const platform = input.platform ?? detectPlatform();
  const env = input.env ?? process.env;
  const processPath = input.processPath ?? env.PATH ?? env.Path ?? "";
  const exists = input.exists ?? existsSync;

  const dirs: string[] = [];
  const seen = new Set<string>();
  const push = (entry: string) => {
    if (!entry || seen.has(entry)) return;
    seen.add(entry);
    dirs.push(entry);
  };

  /**
   * **Step 0: the names the user's own shell resolved.** Each answer is believed only when the program is
   * really there — a shell answer is a *fact about a lookup*, and a lookup whose file has since been removed
   * is a fact that has expired. The directory goes in **first**, because this is the one source that says
   * "this is the file my terminal would run", and anything later could only be a worse guess at the same
   * question.
   */
  const shellBinaries: ShellBinaryAnswer[] = [];
  // The module's answers describe **this** machine, so a call that names its own world (`env`, `home`,
  // `platform`, `exists`) is not served them — the same ownership rule `namesItsOwnWorld` applies to the
  // snapshot, applied here because a test asking about another machine must not inherit this one's lookups. The
  // explicit `shellBinaries` input is the way to say "these are the answers for the world I am describing".
  const known = input.shellBinaries ?? (namesItsOwnWorld(input) ? EMPTY_BINARIES : shellResolvedBinaries());
  for (const [name, file] of known) {
    if (!exists(file)) continue;
    const dir = path.dirname(file);
    shellBinaries.push({ name, path: file, dir });
    push(dir);
  }

  const loginShell = input.loginShell;
  const loginShellAnswered = loginShell !== undefined && looksLikePath(loginShell, platform);
  if (loginShellAnswered) for (const entry of splitPathEntries(loginShell, input)) push(entry);
  const fromLoginShell = loginShellAnswered || shellBinaries.length > 0;
  const processDirs = splitPathEntries(processPath, input);
  for (const entry of processDirs) push(entry);

  const added: string[] = [];
  for (const candidate of wellKnownBinDirs(input)) {
    if (seen.has(candidate) || !exists(candidate)) continue;
    added.push(candidate);
    push(candidate);
  }

  // Step 4, and last on purpose: a cache is the least like an installation, so a real one always wins.
  const cached: string[] = [];
  for (const candidate of cacheBinDirs(input)) {
    if (seen.has(candidate) || !exists(candidate)) continue;
    cached.push(candidate);
    push(candidate);
  }

  const source: SearchPathSource = fromLoginShell
    ? "login-shell"
    : processDirs.length > 0
      ? "process-env"
      : added.length > 0
        ? "well-known"
        : cached.length > 0
          ? "cache"
          : "none";

  return {
    path: dirs.join(capabilitiesFor(platform).pathDelimiter),
    dirs,
    source,
    searchable: dirs.length > 0,
    added,
    fromLoginShell,
    shellBinaries,
    cached,
  };
}

/* ────────────────────────────── the cache ────────────────────────────── */

/**
 * The login-shell answer, once it has landed.
 *
 * Module state rather than a parameter because the two things that need it — every `findBinary` call and
 * every spawn — are on paths too hot and too synchronous to await a shell. `undefined` means "not yet",
 * which differs from "asked and got nothing": the latter caches as `null` so we stop asking, because a
 * machine whose rc file hangs would otherwise hang on every ask.
 */
let loginShellAnswer: string | null | undefined;
let snapshot: SearchPath | undefined;
let inFlight: Promise<SearchPath> | undefined;
/** Bumped by the test hook, so an answer in flight cannot leak into the next case. */
let generation = 0;
/** Which `shell-binaries` generation `snapshot` was composed from. */
let snapshotShellGeneration = -1;

/**
 * The list to search **right now**, without waiting for anything.
 *
 * Answers from the login-shell answers if they have already landed, and from the process environment plus the
 * well-known directories if they have not. This is the function both `findBinary` and the spawn path use, and
 * that is the point of it: a daemon must not probe with one list and launch with another, or a program
 * that showed as installed can fail to start — which is worse than reporting it missing.
 *
 * **Two answers arrive at different times**, which is why a snapshot alone is not enough: the `PATH` prime and
 * the per-name prime are separate invocations of a shell, and the second usually lands seconds after the
 * first. So the snapshot is keyed to the generation of the per-name answers (`shellBinariesGeneration`) and
 * recomposed when they change. Reading a number is cheap; recomposing on every call would put a `readdir` of
 * the npm cache on the launch path.
 */
export function currentSearchPath(options: SearchPathOptions = {}): SearchPath {
  if (namesItsOwnWorld(options)) return composeSearchPath(options);
  const shellGeneration = shellBinariesGeneration();
  if (snapshot === undefined || snapshotShellGeneration !== shellGeneration) {
    snapshot = composeSearchPath(loginShellAnswer ? { loginShell: loginShellAnswer } : {});
    snapshotShellGeneration = shellGeneration;
  }
  return snapshot;
}

/** The directories to search right now — what `findBinary` is handed. */
export function currentSearchDirs(options: SearchPathOptions = {}): readonly string[] {
  return currentSearchPath(options).dirs;
}

/**
 * Ask the login shell and cache the answer: the async half of the pair.
 *
 * Serialised, because two callers arriving together is the normal case — the daemon primes this at boot
 * *and* the first window may ask its own question at the same moment, and two shells for one answer is one
 * more login shell than the user's rc files deserve.
 *
 * A call that names its own world (`env`, `home`, `exists`) is answered for that world and **not** cached;
 * see `namesItsOwnWorld`.
 */
export async function refreshSearchPath(
  options: Parameters<typeof readLoginShellPath>[0] = {},
): Promise<SearchPath> {
  const ownWorld = namesItsOwnWorld(options);
  if (ownWorld) {
    const read = await readLoginShellPath(options);
    return composeSearchPath({ ...options, loginShell: read.path });
  }
  if (inFlight) return inFlight;
  const mine = generation;
  const run = (async () => {
    const read = await readLoginShellPath(options);
    if (mine !== generation) return currentSearchPath();
    // `null` records "asked, got nothing, do not ask again from this process".
    loginShellAnswer = read.path ?? null;
    snapshot = undefined;
    return currentSearchPath();
  })().finally(() => {
    inFlight = undefined;
  });
  inFlight = run;
  return run;
}

/**
 * Prime the cache at boot, and hand back what landed.
 *
 * Deliberately returns its promise rather than being fire-and-forget *here*: the daemon decides whether to
 * await it (it does not) and what to do when it lands (tell its clients the agent list may have changed). A
 * version that swallowed its own promise would make the second part impossible.
 */
export function primeSearchPath(
  options: Parameters<typeof refreshSearchPath>[0] = {},
): Promise<SearchPath> {
  return refreshSearchPath(options);
}

/**
 * Forget everything, for tests.
 *
 * Named as a warning rather than as a generic `reset()`: this is module state production code must never
 * clear, and a test that leaves it dirty makes the next suite depend on the order it ran in.
 */
export function resetSearchPathCacheForTests(): void {
  generation += 1;
  loginShellAnswer = undefined;
  snapshot = undefined;
  snapshotShellGeneration = -1;
  inFlight = undefined;
}

/* ────────────────────────────── provenance ────────────────────────────── */

/**
 * Did this resolved program come out of **another tool's cache**, and which one?
 *
 * `dsh` on the machine this was written on resolves to
 * `~/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh` — a path created for somebody else's `npx`
 * invocation, whose directory name contains a random hash and which `npm cache clean` removes. It is a
 * real program and it really runs (this repository drives it in `acp-transport.test.ts`), so reporting it
 * as *not installed* would be false; but calling it an installation without saying where it came from would
 * hide why it can vanish. Hence one closed-set kind on the wire and one translated sentence in the window.
 *
 * A kind rather than a sentence because the sentence a user reads has to be translated and the *fact* does
 * not: `packages/protocol`'s `ToolCache` is the same closed list, and each member gets its own catalogue
 * key. The list is short and each entry says what makes it transient. A toolchain manager's directory
 * (`~/.volta`, `~/.asdf`) is deliberately **not** here: those are installations the user chose.
 */
const PROVISIONAL_CACHES: readonly { cache: ToolCacheKind; segment: string }[] = [
  { cache: "npx", segment: "/.npm/_npx/" },
  { cache: "bun-cache", segment: "/.bun/install/cache/" },
  { cache: "pnpm-dlx", segment: "/.cache/pnpm/dlx/" },
];

/** A cache a resolved program may have come out of. Mirrors `packages/protocol`'s `TOOL_CACHES`. */
export type ToolCacheKind = "npx" | "bun-cache" | "pnpm-dlx";

/** Which cache this path lives in, or `undefined` when it is an ordinary installation. */
export function provisionalCacheOf(binaryPath: string): ToolCacheKind | undefined {
  const normalized = binaryPath.replaceAll("\\", "/");
  return PROVISIONAL_CACHES.find((entry) => normalized.includes(entry.segment))?.cache;
}
