/**
 * **What an older daemon's answer becomes** — the compatibility half of widening `available`.
 *
 * ## Why this needs its own file rather than a line in a component
 *
 * `HarnessSummary.available: boolean | "unknown"` became `HarnessSummary.availability`, and a daemon built
 * before that change is not hypothetical: both halves of EnvoyCoder ship together but a *running* daemon is
 * whichever build owns the port, and this repository already learned this the hard way — a required field's
 * absence once threw inside the settings page and took the whole window down with it (the crash
 * `settings-nav.test.tsx` now guards).
 *
 * The mapping is also the most **judgement-laden** code in this change, which is why it is worth asserting
 * rather than reviewing. A legacy `false` came from a daemon that only ever asked "is the program *I* drive on
 * *my* `PATH`?" — and for `claudecode` and `codex` the program that daemon drove was the ACP **bridge**, which
 * is exactly the answer that produced the bug report. Turning that `false` into `not-installed` would reproduce
 * the bug on every machine with an older daemon running, so it becomes `unknown`: honest, and never a claim the
 * old daemon could not support.
 */

import { describe, expect, it } from "vitest";

import type { HarnessSummary } from "@envoycoder/protocol";

import { availabilityOf, canRun, stateOf } from "../src/composer/agent-for.js";

/** The smallest thing that reads as a harness summary, so each case is about one field. */
const summary = (fields: Record<string, unknown>): HarnessSummary =>
  ({ id: "claudecode", label: "Claude Code", ...fields }) as unknown as HarnessSummary;

describe("reading availability from either generation of the wire", () => {
  it("passes a current daemon's availability through unchanged", () => {
    const current = { state: "needs-bridge", agentBinary: "/Users/you/.local/bin/claude", fix: [{ command: "x" }] };
    expect(availabilityOf(summary({ availability: current }))).toEqual(current);
  });

  it("reads a legacy `true` as ready, because that is what it asserted", () => {
    // The old daemon resolved the program it drives. That *is* `ready` — the same claim, and the change does not
    // make it false retroactively.
    expect(availabilityOf(summary({ available: true }))).toEqual({ state: "ready" });
    expect(canRun(summary({ available: true }))).toBe(true);
  });

  it("reads a legacy `\"unknown\"` as unknown", () => {
    expect(availabilityOf(summary({ available: "unknown" }))).toEqual({ state: "unknown" });
  });

  it("reads a legacy `false` as unknown — **never** as not-installed", () => {
    // **The whole point.** The old field meant "the program the old daemon drives is not on the old daemon's
    // search path". For a bridged agent that program is the adapter, so `false` was the reported bug's wrong
    // word — and the row must not repeat it. `unknown` is also what keeps `fix` absent, because a daemon that
    // never asked cannot say what to install.
    const legacy = availabilityOf(summary({ available: false }));
    expect(legacy.state).toBe("unknown");
    expect(legacy.state).not.toBe("not-installed");
    expect(legacy.fix).toBeUndefined();
    expect(canRun(summary({ available: false }))).toBe(false);
  });

  it("reads a daemon older than the field itself as unknown", () => {
    // Neither field: a build from before the question existed. `unknown` and not a crash — the window accepts
    // the answer and the settings row says the daemon is a build behind.
    expect(availabilityOf(summary({}))).toEqual({ state: "unknown" });
    expect(availabilityOf(undefined)).toEqual({ state: "unknown" });
    expect(stateOf(undefined)).toBe("unknown");
    expect(canRun(undefined)).toBe(false);
  });
});
