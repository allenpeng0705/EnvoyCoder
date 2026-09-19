/**
 * The wire accepts what our own code sends.
 *
 * This file exists because of a specific bug class that shipped: `coder.startRun` had `resume` on both
 * ends of the wire — the daemon's handler read `input.resume` and the window passed it — and not in the
 * middle, because the spec is `.strict()` and listed only `{taskId, prompt, mode}`. The call was
 * rejected *before the agent was touched* (`Unrecognized key(s) in object: 'resume'`), so "resume a
 * cancelled task" was unreachable from the UI while every unit test passed: the test called
 * `RunManager.start` directly, bypassing the schema that rejected it.
 *
 * A `.strict()` schema is a good thing — it refuses a typo instead of ignoring it — but it only helps if
 * something checks that the *producer* and the *spec* agree. That is what these tests do, for the fields
 * that matter. They are deliberately written against `parseRpcParams`, the same function the dispatcher
 * uses, rather than against the schema object, so a change to how specs are applied cannot slip past.
 */

import { describe, expect, it } from "vitest";

import { parseRpcParams, RPC_METHODS, RPC_SPECS } from "../src/index.js";

describe("coder.startRun", () => {
  it("accepts the fields the daemon and the window actually send", () => {
    // Exactly what `coderStore.startRun` puts on the wire for a resume.
    const params = { taskId: "w1", prompt: "carry on", resume: true };
    expect(() => parseRpcParams("coder.startRun", params)).not.toThrow();
  });

  it("still refuses a field nobody sends — the schema stays strict on purpose", () => {
    // If this ever passes, `.strict()` was dropped and typos will start being ignored.
    expect(() => parseRpcParams("coder.startRun", { taskId: "w1", prompt: "hi", resumeMaybe: 1 }))
      .toThrow();
  });

  it("keeps the queue/steer mode and the resume flag independent", () => {
    expect(() =>
      parseRpcParams("coder.startRun", { taskId: "w1", prompt: "hi", mode: "queue", resume: false }),
    ).not.toThrow();
  });

  it("accepts pictures on a turn, and still refuses a field nobody sends", () => {
    const images = [{ mimeType: "image/png", data: "aGVsbG8=" }];
    expect(() => parseRpcParams("coder.startRun", { taskId: "w1", prompt: "hi", images })).not.toThrow();
    expect(() => parseRpcParams("coder.sendToRun", { runId: "r1", text: "hi", mode: "queue", images })).not.toThrow();
    expect(() =>
      parseRpcParams("coder.startRun", { taskId: "w1", prompt: "hi", images, attachmentPath: "/tmp/x" }),
    ).toThrow();
  });
});

describe("coder.hello", () => {
  it("accepts the object shape a client identifies itself with", () => {
    // The shape the Flutter app now sends. It used to send `{'client': 'mobile', 'protocol': 1}`, which
    // the schema rejected before authentication ("Expected object, received string") — a phone could
    // open a socket and never say hello.
    expect(() =>
      parseRpcParams("coder.hello", {
        client: { name: "envoydev-mobile", platform: "ios" },
      }),
    ).not.toThrow();

    // `coder.hello` takes no params at all, and that is legal: the simplest client says nothing.
    expect(() => parseRpcParams("coder.hello", {})).not.toThrow();
    expect(() => parseRpcParams("coder.hello", undefined)).not.toThrow();
  });

  it("refuses a client that is not an object", () => {
    expect(() => parseRpcParams("coder.hello", { client: "mobile" })).toThrow();
  });
});

describe("the method catalogue itself", () => {
  it("has a spec for every method it advertises", () => {
    // A method in `RPC_METHODS` with no spec would be dispatched unvalidated; a spec with no method
    // would be dead wire surface. Both fail silently today, so this asserts the table itself rather
    // than the behaviour of calling it (which would pass for the wrong reason).
    for (const method of RPC_METHODS) {
      const spec = RPC_SPECS[method];
      expect(spec, method).toBeDefined();
      expect(spec.params, `${method} params`).toBeDefined();
      expect(spec.result, `${method} result`).toBeDefined();
    }
    expect(Object.keys(RPC_SPECS).sort()).toEqual([...RPC_METHODS].sort());
  });
});
