import { describe, expect, it, vi } from "vitest";

import type { CoderCallContext } from "../src/daemon/service.js";
import { createShutdownHandlers } from "../src/daemon/shutdown.js";

const owner: CoderCallContext = { session: undefined };
const phone: CoderCallContext = { session: { deviceId: "device-1" } };

const handler = (stop?: () => void) => {
  const built = createShutdownHandlers(stop ? { shutdown: stop } : {})["coder.shutdown"];
  if (!built) throw new Error("coder.shutdown is not served");
  return built;
};

/** One tick, so a deferred hook has run. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

describe("the stop a client can ask for", () => {
  it("answers before it stops, so the client learns the request was accepted", async () => {
    // If the drain started first the socket could close before the answer was sent, and a client could never tell
    // "it is stopping" from "the connection died" — which is the whole reason this method exists.
    const stop = vi.fn();
    await expect(handler(stop)({}, owner)).resolves.toEqual({ stopping: true });
    expect(stop).not.toHaveBeenCalled();
    await tick();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("refuses a paired phone, and stops nothing", async () => {
    // A phone can already reach this daemon; letting it end the desktop's daemon would turn a lost phone into an
    // outage. Same guard as minting a pairing code.
    const stop = vi.fn();
    await expect(handler(stop)({}, phone)).rejects.toThrow();
    await tick();
    expect(stop).not.toHaveBeenCalled();
  });

  it("serves no such method at all when no stop was wired", () => {
    // The handler used to answer `{stopping: true}` with nothing behind it — a promise this module could not keep,
    // and this test pinned that as intended behaviour. A build with no way to stop now serves no method, and the
    // dispatcher refuses it by name instead.
    expect(Object.keys(createShutdownHandlers())).toEqual([]);
  });
});
