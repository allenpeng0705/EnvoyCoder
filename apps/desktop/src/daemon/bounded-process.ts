/**
 * Run one program, bounded — the rule that keeps a child from outliving the caller that asked for it.
 *
 * ## Why this is a module rather than a helper inside its first caller
 *
 * It was `collect` in `fixes.ts`, where the property it enforces was stated once and is worth keeping
 * word for word: *one deadline for the whole sequence, and the process **group** is killed on expiry* —
 * a package manager spawns children, and a timeout that killed only the leader would leave the work
 * running with nobody reading its output. `git` needs exactly the same guarantee for a different
 * reason: a repository can ask for a credential, and a prompt no one can answer is an RPC held open
 * until the deadline. Two copies of this rule is how one of them ends up without the group kill, so
 * both callers share this file.
 *
 * ## What it is not
 *
 * It is not a shell. The caller passes `command` and `args` and they are spawned directly
 * (`shell: false` in `spawnTreeOptions`), so nothing a client sent can become shell syntax. Callers
 * that hold a *user's* typed command line build it themselves through `buildShellCommand`.
 *
 * `stdin` is `/dev/null`: EOF is an answer, and a program that wanted to ask a question fails visibly
 * instead of holding the caller open. `stdout` and `stderr` are joined **in arrival order** rather
 * than kept apart — a reader wants the story the program told, not a stderr block printed after it.
 */

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";

import { detectPlatform, processGroupTarget, spawnTreeOptions, type PlatformId } from "@envoydev/platform";

/** The most output kept by default, from the end — where a failure says what went wrong. */
export const DEFAULT_OUTPUT_LIMIT = 64 * 1024;

/** How long a killed group gets to exit politely before SIGKILL. */
export const DEFAULT_KILL_GRACE_MS = 5_000;

export interface BoundedOutput {
  /** `stdout` and `stderr`, joined in arrival order and tailed to the output limit. */
  text: string;
  /** The exit code, or `null` when the child was signalled and never reported one. */
  code: number | null;
  /** The deadline was reached — **not** the same fact as "it failed", and not the same sentence. */
  timedOut: boolean;
  /** Set when the program could not be started at all (`ENOENT` is "not installed"). */
  spawnError?: NodeJS.ErrnoException;
}

export interface BoundedRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** One deadline for this command, in milliseconds. */
  timeoutMs: number;
  outputLimit?: number;
  killGraceMs?: number;
  platform?: PlatformId;
  /** Injectable for tests; the daemon passes the real `spawn`. */
  spawn?: typeof nodeSpawn;
}

/** The last `limit` characters, with a marker when something was dropped. */
export function tailText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `…\n${text.slice(text.length - limit)}`;
}

/** Run `command` with `args`, and answer with what it said — bounded in time and in size. */
export function runBounded(
  command: string,
  args: readonly string[],
  options: BoundedRunOptions,
): Promise<BoundedOutput> {
  const platform = options.platform ?? detectPlatform();
  const limit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const spawn = options.spawn ?? nodeSpawn;

  const spawnOptions: SpawnOptions = {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    // `/dev/null`, so a prompt cannot hold a caller open: EOF is an answer.
    stdio: ["ignore", "pipe", "pipe"],
    ...spawnTreeOptions(platform),
  };
  const child = spawn(command, [...args], spawnOptions) as ChildProcessWithoutNullStreams;

  return new Promise((resolve) => {
    let text = "";
    let settled = false;
    let timedOut = false;
    let spawnError: NodeJS.ErrnoException | undefined;

    const append = (chunk: Buffer): void => {
      text = tailText(text + chunk.toString("utf8"), limit);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const kill = (signal: NodeJS.Signals): void => {
      try {
        // The group, not the leader: the thing this spawns has children of its own.
        process.kill(processGroupTarget(child.pid ?? 0, platform), signal);
      } catch {
        // Already gone, which is what the `close` below reports.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      // A group that ignores SIGTERM is killed outright. `unref` so a straggler cannot hold the daemon open.
      setTimeout(() => kill("SIGKILL"), killGraceMs).unref();
    }, options.timeoutMs);

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ text, code, timedOut, ...(spawnError ? { spawnError } : {}) });
    };

    // A program that is not installed reports `error` and then `close` with a null code; keeping the error
    // is what lets a caller say "git is not installed" instead of "git failed with nothing".
    child.on("error", (error) => {
      spawnError = error as NodeJS.ErrnoException;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
