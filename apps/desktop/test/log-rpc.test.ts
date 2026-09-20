import { describe, expect, it } from "vitest";

import { createLogHandlers } from "../src/daemon/log-rpc.js";
import type { CoderCallContext } from "../src/daemon/service.js";

const owner: CoderCallContext = { session: undefined };
const phone: CoderCallContext = { session: { deviceId: "device-1" } };

const handler = (read?: () => Promise<{ path: string; lines: string[]; truncated: boolean }>) => {
  const built = createLogHandlers(read ? { read } : {})["coder.getDaemonLog"];
  if (!built) throw new Error("coder.getDaemonLog is not served");
  return built;
};

describe("the daemon's log over the wire", () => {
  it("hands the owner's window the tail the daemon read", async () => {
    const log = { path: "/state/logs/daemon.log", lines: ["a", "b"], truncated: true };
    await expect(handler(async () => log)({}, owner)).resolves.toEqual({ log });
  });

  it("refuses a paired phone, because a log carries paths, prompts and command lines", async () => {
    // Reading whether the machine is serving is one privilege; reading what it has been doing is another, and
    // nobody granted the second by scanning a pairing code.
    await expect(handler()({}, phone)).rejects.toThrow();
  });

  it("answers an empty tail when the daemon wired no log path", async () => {
    await expect(handler()({}, owner)).resolves.toEqual({
      log: { path: "", lines: [], truncated: false },
    });
  });
});
