/**
 * What the daemon should do when it starts — decided from facts, touching nothing.
 *
 * The decision is separated from the doing because it is the part with rules in it: which states a
 * service may serve through, which it must stop for, and which exit codes mean what. That is worth
 * testing without booting a socket, and the entry point (`main.ts`) is then only IO.
 *
 * ## The exit codes, and the two we do not use
 *
 * `0` and `4` are ours, and `4` is the **family's convention** for a damaged profile (EnvoyMesh's
 * node exits 4 with a readable message; its design doc records why). Two codes are deliberately left
 * alone: **`2` is reserved by the family for `exitForNodeSupervisor`** — the signal a supervisor uses
 * to respawn a wedged-but-healthy node — and **`1` means a failure we did not classify**. A product
 * that reuses `2` for something else makes the supervisor loop on a state no restart can fix.
 */

import type { CoderHomeFacts } from "@envoydev/host-bridge";

/** Nothing to do and nothing wrong — also the code for "another daemon already serves this machine". */
export const EXIT_OK = 0;

/** The profile is damaged: stop, say so in the family's words, and change nothing (family convention). */
export const EXIT_DAMAGED_HOME = 4;

/** A failure we did not classify. */
export const EXIT_FAILED = 1;

export type BootDecision =
  | { serve: true; notes: string[] }
  | { serve: false; exitCode: number; headline: string; detail: string[] };

/**
 * Decide whether to serve, from what the shared home looks like.
 *
 * **Only a damaged profile stops the daemon.** Everything else is served, with notes, because the
 * alternative is a service that refuses to start on a machine where the user's actual problem is
 * something they can see and fix later:
 *
 *   * `found` — the normal case.
 *   * `missing` — no EnvoyMesh profile on this machine yet. Our own state (`<home>/EnvoyDev/`) does
 *     not need it, and refusing here would mean a product that cannot start before another product
 *     has. The mesh features simply report themselves as unavailable.
 *   * `in-use` — another family app owns the mesh identity. That is *expected*, not a conflict: under
 *     D2 exactly one app owns the node and every other product **attaches**. Reporting it lets the
 *     window say who is serving instead of showing a mystery.
 *
 * A damaged profile is different in kind: writing into it is how a user loses contacts and bonds
 * without being told, so the family's rule is to report and never replace. The headline and detail
 * are the family's own wording (`describeProfileSituation`), shown as-is — a second vocabulary for the
 * same situation is how two products start describing one profile differently.
 *
 * ## Why every sentence in this file is English, and stays that way
 *
 * These headlines and details are **the boot report a headless process prints**. They go to
 * stdout/stderr before any client exists, and no window ever sees them — the shell routes this
 * output to a log. There is also nobody to ask which language to use: the language setting lives in
 * the store whose files may be exactly what is damaged, and a process that has printed its last line
 * and exited cannot render a key a client would resolve.
 *
 * The *situations* are translated where a user actually meets them, in the window: "EnvoyDev
 * cannot reach its daemon" plus the connection chip (`work.offline.*`, `connection.*`), which is what
 * a user sees when the shell's spawn failed or the daemon is not answering. So this is a
 * classification, not an omission — a log line is developer-facing output, and the developer is
 * reading a repository written in English.
 */
export function decideBoot(facts: CoderHomeFacts): BootDecision {
  if (facts.state === "damaged") {
    return {
      serve: false,
      exitCode: EXIT_DAMAGED_HOME,
      headline: facts.headline,
      // The family's own detail already ends with "Nothing has been changed." — repeating it here in
      // different words made the same promise twice, so this adds only what the family cannot know:
      // the product's name, and the fact that this process stopped.
      detail: [
        facts.detail,
        "Fix or move that folder, or restore a backup, then start EnvoyDev again.",
      ],
    };
  }

  const notes = [facts.headline];
  if (facts.state === "missing") {
    notes.push(
      "There is no EnvoyMesh profile on this machine yet, so the mesh features are unavailable — " +
        "EnvoyDev's own projects and tasks do not need one.",
    );
  }
  if (facts.state === "in-use" && facts.holder) {
    // `verified: false` is the honest case where a claim exists but its endpoint did not answer — worth
    // saying, because "close that app" is poor advice for something that may already be shutting down.
    const held = facts.holder.verified === false ? "claims (but is not answering on) " : "owns ";
    notes.push(
      `${facts.holder.app} ${held}this machine's mesh identity, so EnvoyDev attaches to it as a ` +
        "product rather than starting a second one.",
    );
  }

  return { serve: true, notes };
}

/**
 * What a failure to bind the port means.
 *
 * An occupied port is **not an error**: one daemon serves a machine, and a second one starting is a
 * client that has not noticed yet — windows attach to the daemon already running. Telling that apart
 * from a real failure is the difference between "open a window" and "something is broken", so the
 * two get different exit codes and different words.
 */
export function serveFailureOutcome(
  port: number,
  error: unknown,
): { exitCode: number; headline: string; detail: string[] } {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "EADDRINUSE" || /EADDRINUSE|address already in use/i.test(message)) {
    return {
      exitCode: EXIT_OK,
      headline: `EnvoyDev is already running on this machine (port ${port}).`,
      detail: [
        "Only one service runs per machine: two would fight over the same projects and tasks.",
        "Open a window and it will attach to the one that is already there.",
      ],
    };
  }
  return {
    exitCode: EXIT_FAILED,
    headline: `EnvoyDev could not start on port ${port}.`,
    detail: [
      message,
      "If another program is using that port, set ENVOYDEV_DAEMON_PORT to a free one.",
    ],
  };
}

/**
 * What to do when the claim file names a daemon that is genuinely running.
 *
 * The **same outcome as an occupied port**, deliberately: both mean "a daemon already has this
 * home", and a user should read one sentence for one situation rather than two sentences that mean
 * the same thing. Exit 0, because nothing failed — the thing that started this process asked for
 * something that already exists.
 *
 * What differs is what it can *say*. A bind failure only knows a port number; a claim knows who is
 * running, since when, and on which port — the difference between "something is on 4770" and "the
 * daemon you started an hour ago is still there".
 */
export function alreadyRunningOutcome(descriptor: {
  pid: number;
  port: number;
  startedAt: string;
  version: string;
}): { exitCode: number; headline: string; detail: string[] } {
  return {
    exitCode: EXIT_OK,
    headline: "EnvoyDev is already running on this machine.",
    detail: [
      `Daemon pid ${descriptor.pid}, on port ${descriptor.port}, started ${descriptor.startedAt} (version ${descriptor.version}).`,
      "One daemon serves this machine while EnvoyDev is open. Quitting the app stops it.",
      "Open a window and it will attach to the daemon that is already there.",
    ],
  };
}
