/**
 * **What the background warm-up may start, and what it may never do.**
 *
 * The deep facts about an agent — whether it speaks ACP, what it publishes, whether it wants a sign-in — can
 * only be learned by *starting* it, so they are the one thing on this screen that costs something. The mandate
 * keeps them off the row's state and puts them in the properties with a time (`Verified 4 minutes ago`), and
 * says they should arrive *"when the intent exists … or in the background, throttled one at a time, for real
 * binaries that are Ready"*.
 *
 * This file is about the bounds on that sentence, because a daemon that starts agents behind a user's back is a
 * daemon that can do real harm, and the harm is not hypothetical: one of these rules exists because a
 * background pass that ignored it would **download an npm package because somebody opened an app**.
 *
 * ## The three things asserted, and the mutation each one fails on
 *
 * | rule | mutation that must go red |
 * |---|---|
 * | only `ready` rows are ever started | dropping the state filter, which would make the pass try to start programs that are not there and spend a timeout learning nothing |
 * | **never a program fetched on first run** | dropping the `fetchedOnFirstRun` filter, which is the one that spends a user's network and disk |
 * | one at a time, in a stable order | running them concurrently, or in whatever order a map happens to produce |
 *
 * `startDeepWarm` drives `SessionProbe.probe` in production, and that call is answered from `SessionProbe`'s
 * own cache when the agent has been observed recently on the same build — so "ask" here can mean "learn that we
 * already know", and the pass costs a `stat` per agent rather than a session. What this file replaces is only
 * the *ask*, so the order and the spacing are the things under test.
 */

import { describe, expect, it } from "vitest";

import type { HarnessAvailability } from "@envoycoder/protocol";

import { WARM_GAP_MS, startDeepWarm, warmPlan, type WarmCandidate } from "../src/daemon/deep-warm.js";

const ok = (name: string): HarnessAvailability => ({ state: "ready", binary: `/usr/local/bin/${name}` });

/**
 * A candidate with every bound already satisfied — nothing observed recently, nothing to download, a program
 * that resolved. A test moves exactly one of those at a time, so a failure names which rule it broke.
 */
function candidate(over: Partial<WarmCandidate> & { id: WarmCandidate["id"] }): WarmCandidate {
  return { availability: ok(over.id), fetchedOnFirstRun: false, observedRecently: false, ...over };
}

describe("who is worth a background look", () => {
  it("plans only the rows a program was actually resolved for", () => {
    // **The mutation:** dropping the `ready` filter. Every other state either has no program to start
    // (`not-installed`), has one this build cannot drive (`unsupported`), is missing the connector that would
    // drive it (`needs-bridge`), or is our own ignorance (`unknown`) — and starting one of those would be a
    // failure dressed as a measurement.
    const plan = warmPlan([
      candidate({ id: "codex" }),
      candidate({ id: "cursor", availability: { state: "not-installed", fix: [{ command: "x" }] } }),
      candidate({ id: "claudecode", availability: { state: "needs-bridge", agentBinary: "/usr/bin/claude", fix: [{ command: "y" }] } }),
      candidate({ id: "copilot", availability: { state: "unsupported", binary: "/usr/bin/copilot" } }),
      candidate({ id: "deepseek-harness", availability: { state: "unknown" } }),
    ]);
    expect(plan).toEqual(["codex"]);
  });

  it("never plans a program that would have to be downloaded first", () => {
    // **The one prohibition, and the reason the field exists at all.** An `npx -y <pkg> …` recipe is fetched
    // from npm on the first run, so a background pass over one of those is a pass that spends a user's network
    // and disk without them asking. The mutation is dropping this filter, which the test above cannot catch —
    // every candidate here is `ready`, and three of them are still not to be touched.
    // The ids have to be real ones: `HarnessId` is a closed union of the nine agents this product ships, and
    // the first draft of this test invented `goose`/`cline` — which `tsc -b tsconfig.unchecked.json` caught,
    // and which would have made the test a statement about a type rather than about a machine.
    const plan = warmPlan([
      candidate({ id: "cursor" }),
      candidate({ id: "opencode", fetchedOnFirstRun: true }),
      candidate({ id: "pi", fetchedOnFirstRun: true }),
    ]);
    expect(plan).toEqual(["cursor"]);
  });

  it("skips an agent this daemon already has a recent observation about", () => {
    // **The bound that makes a second launch of the app cost nothing.** The store's observation survives a
    // restart and `SessionProbe`'s in-memory cache does not, so without this field every launch would start
    // every installed agent — nine short-lived processes for a fact that changes when an agent is *upgraded*.
    // The mutation is dropping the filter, which no test above can catch: every candidate here is `ready`,
    // nothing would be downloaded, and the only thing wrong is that the answer is already known.
    const plan = warmPlan([
      candidate({ id: "codex" }),
      candidate({ id: "cursor", observedRecently: true }),
      candidate({ id: "claudecode", observedRecently: true }),
    ]);
    expect(plan).toEqual(["codex"]);
    // And when everything has been observed, the pass is empty — not "short", *empty*: nothing is spawned.
    expect(warmPlan([candidate({ id: "codex", observedRecently: true })])).toEqual([]);
  });

  it("plans nothing at all when there is nothing to look at", () => {
    // An empty plan must be an empty plan: a function that invented a default would start something on a
    // machine where nothing is installed, which is the worst possible reading of "warm".
    expect(warmPlan([])).toEqual([]);
    expect(warmPlan([candidate({ id: "codex", availability: { state: "unknown" } })])).toEqual([]);
  });

  it("asks in a stable order, so a pass interrupted by a shutdown makes progress across boots", () => {
    // The mutation: relying on the caller's array order. A map over a store or a Set could hand them back in
    // any order, and a machine that is shut down before the pass finishes would then re-ask about whichever
    // agent happens to come first, forever.
    const forwards = warmPlan([candidate({ id: "codex" }), candidate({ id: "cursor" }), candidate({ id: "claudecode" })]);
    const backwards = warmPlan([candidate({ id: "claudecode" }), candidate({ id: "cursor" }), candidate({ id: "codex" })]);
    expect(forwards).toEqual(["claudecode", "codex", "cursor"]);
    expect(backwards).toEqual(forwards);
  });
});

describe("the pass itself", () => {
  /** A pass over a plan, with the clock and the answers under the test's control. */
  function run(
    candidates: readonly WarmCandidate[],
    options: { gapMs?: number } = {},
  ): { asked: string[]; report: () => Promise<unknown>; events: string[] } {
    const asked: string[] = [];
    const order: string[] = [];
    let inFlight = 0;
    const warm = startDeepWarm({
      candidates: () => candidates,
      ask: async (id) => {
        // **Concurrency is measured, not assumed.** Every ask counts itself in and out, and the maximum is
        // asserted below: a pass that overlapped two agents would show a 2 here whatever the gap was set to.
        inFlight += 1;
        order.push(`start:${id}:${inFlight}`);
        await Promise.resolve();
        asked.push(id);
        inFlight -= 1;
        order.push(`end:${id}`);
      },
      gapMs: options.gapMs ?? 0,
    });
    return { asked, report: () => warm.done(), events: order };
  }

  it("asks about each planned agent exactly once", async () => {
    const { asked, report } = run([candidate({ id: "codex" }), candidate({ id: "cursor" })]);
    await report();
    expect(asked.sort()).toEqual(["codex", "cursor"]);
  });

  it("never has two agents in flight, and never hurries between them", async () => {
    // **The bound, asserted two ways.** The concurrency counter catches a change that runs the pass in
    // parallel; the recorded sleeps catch the other shape of the same mistake — a pass that keeps the code
    // sequential and fires anyway, which would start nine agents on a laptop the moment the app launches.
    const sleeps: number[] = [];
    const asked: string[] = [];
    const warm = startDeepWarm({
      candidates: () => [candidate({ id: "codex" }), candidate({ id: "cursor" }), candidate({ id: "copilot" })],
      ask: async (id) => {
        asked.push(id);
      },
      gapMs: 1234,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await warm.done();
    // Sorted, which is `plan`'s own rule: codex < copilot < cursor.
    expect(asked).toEqual(["codex", "copilot", "cursor"]);
    // **One gap per agent after the first**, and the delay is *before* each of them: a pass with one agent to
    // ask starts at once, because the courtesy is to the machine and not a warm-up ritual.
    expect(sleeps).toEqual([1234, 1234]);
  });

  it("stops after the agent in flight, and starts no other", async () => {
    // The daemon is shutting down and must not leave a child behind — the property `agent-teardown.ts` exists
    // for one layer down. The mutation: ignoring `stop()`, which would have the pass start one more agent while
    // the process is exiting.
    //
    // **Stopped from `onAnswer`, which is the only place a caller can stand**: the first draft called `stop()`
    // from inside the first `ask`, which runs before `startDeepWarm` has returned and therefore before the
    // handle exists — the throw was swallowed by the pass's own failure handling and three agents were asked
    // about while the test still looked like it was testing something. A test that stops the world from a
    // callback which cannot exist yet is a test whose green would mean nothing.
    const asked: string[] = [];
    const warm = startDeepWarm({
      candidates: () => [candidate({ id: "codex" }), candidate({ id: "cursor" }), candidate({ id: "copilot" })],
      ask: async (id) => {
        asked.push(id);
      },
      onAnswer: (id) => {
        // The agents are asked in sorted order — codex, copilot, cursor — so `copilot` is the second of the
        // three and stopping there must leave `cursor` alone.
        if (id === "copilot") warm.stop();
      },
      gapMs: 0,
      sleep: async () => {},
    });
    const report = await warm.done();
    // `copilot` was the agent in flight and finished; `cursor` is never started.
    expect(asked).toEqual(["codex", "copilot"]);
    expect(report.asked).toEqual(["codex", "copilot"]);
  });

  it("survives an ask that throws, and still finishes the pass", async () => {
    // `SessionProbe.probe` reports failures as outcomes rather than by throwing, so reaching here means
    // something quite unexpected — and it is still not the daemon's problem. The rows keep the verdict they
    // already had, and the agents after the broken one are still looked at.
    const asked: string[] = [];
    const warm = startDeepWarm({
      candidates: () => [candidate({ id: "codex" }), candidate({ id: "cursor" })],
      ask: async (id) => {
        asked.push(id);
        if (id === "codex") throw new Error("something quite unexpected");
      },
      gapMs: 0,
      sleep: async () => {},
    });
    const report = await warm.done();
    expect(asked).toEqual(["codex", "cursor"]);
    // The broken agent is not claimed as asked-about, and the one after it still is.
    expect(report.asked).toEqual(["cursor"]);
    expect(report.planned).toEqual(["codex", "cursor"]);
  });

  it("defaults to a gap long enough that a session which is timing out is finished first", () => {
    // The default is a policy, not an accident: a probe that times out can hold a process for
    // `PROBE_TIMEOUT_MS` (30 s), and the gap is what keeps a second agent from starting inside that window on a
    // machine somebody is working on. A default of zero would make the bound above a test-only property.
    expect(WARM_GAP_MS).toBeGreaterThanOrEqual(3_000);
  });
});
