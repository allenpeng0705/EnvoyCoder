/**
 * **The claim's one question: is the process in it running?**
 *
 * `lock.ts` explains why a claim file exists at all; this file is about the half of it that a file cannot
 * answer, and about the state that answers it *wrongly* if you ask the obvious way. `kill(pid, 0)` reports
 * success for a process that has exited and not been reaped — a **zombie** — and this daemon's predecessor is
 * exactly that whenever it died while a window was still open: the window is its parent, and the window reaps
 * it only when something asks it to (`daemon_endpoint`'s `try_wait`). Read as "running", that zombie makes this
 * daemon refuse to start with *"EnvoyDev is already running on this machine"* while nothing is serving, and
 * the window reports a daemon that never answers.
 *
 * ## Why the state is injected here and real in the shell
 *
 * Node cannot leave a zombie behind: libuv reaps every child it spawns, so a test that wanted a real one would
 * need a parent process outside this runtime. The **rule** is what is tested here (a state letter starting with
 * `Z` is not a running process), the real thing is tested in Rust
 * (`apps/desktop/src-tauri/src/main.rs`, `a_child_that_exited_but_was_not_reaped_is_not_a_running_daemon`,
 * which spawns a child, lets it exit and never reaps it), and the two implementations are kept in step by this
 * file's first case plus that one.
 */
import { describe, expect, it } from "vitest";

import { isProcessAlive } from "../src/daemon/lock.js";

/** A probe for a process that exists: `kill(pid, 0)` returning normally. */
const exists = (): void => undefined;

/** A probe for a pid with nothing behind it — what `kill(pid, 0)` throws for a gone process. */
const gone = (): void => {
  const error = new Error("No such process") as NodeJS.ErrnoException;
  error.code = "ESRCH";
  throw error;
};

/** A probe for a process owned by somebody else — alive, and reported as alive. */
const notOurs = (): void => {
  const error = new Error("Operation not permitted") as NodeJS.ErrnoException;
  error.code = "EPERM";
  throw error;
};

describe("a claim's pid is a running process, or it is stale", () => {
  it("reads a zombie as stale, so a daemon killed while a window was open does not block the next one", () => {
    // The mutation: `probe(pid); return true;` — the one-line liveness probe that this daemon and the shell
    // both used to be. It answers *alive* for a process that no longer exists in any useful sense.
    expect(isProcessAlive(4242, exists, () => "Z")).toBe(false);
    // `ps` prints modifiers beside the letter (`Z+`, `SN`, …), so the test is on the letter.
    expect(isProcessAlive(4242, exists, () => "Z+")).toBe(false);
  });

  it("still reads a running process as running, whatever state letter it carries", () => {
    for (const state of ["S", "S+", "R", "SN", "I"]) {
      expect(isProcessAlive(4242, exists, () => state)).toBe(true);
    }
  });

  it("treats an unreadable state as alive, and a gone process as gone", () => {
    // The conservative direction, and the reason it is the right one: `ps` failing is not evidence that a
    // daemon is dead, and the cost of that mistake is two daemons on one state directory.
    expect(isProcessAlive(4242, exists, () => null)).toBe(true);
    expect(isProcessAlive(4242, gone, () => "S")).toBe(false);
    // A process owned by another user is alive — reporting it dead would start a second daemon against a home
    // this process cannot even see.
    expect(isProcessAlive(4242, notOurs, () => "S")).toBe(true);
  });

  it("never calls the state probe for a pid that cannot be a process", () => {
    // 0, negative and non-integer pids are answered from the number alone, so a claim carrying one never reaches
    // `ps` with an argument it would interpret as a flag or a process group.
    let asked = 0;
    const stateOf = (): string => {
      asked += 1;
      return "S";
    };
    for (const pid of [0, -1, 1.5, Number.NaN]) {
      expect(isProcessAlive(pid, exists, stateOf)).toBe(false);
    }
    expect(asked).toBe(0);
  });
});
