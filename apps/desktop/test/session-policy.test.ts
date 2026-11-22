import { describe, expect, it } from "vitest";

import { setPolicyCallParams } from "../src/daemon/acp/session-policy.js";

describe("setPolicyCallParams", () => {
  it("sends a domain preset alone, then autoRun when both are set", () => {
    expect(setPolicyCallParams("s1", { preset: "mobile" })).toEqual([
      { sessionId: "s1", preset: "mobile" },
    ]);
    expect(setPolicyCallParams("s1", { preset: "webdev", autoRun: "off" })).toEqual([
      { sessionId: "s1", preset: "webdev" },
      { sessionId: "s1", autoRun: "off" },
    ]);
  });

  it("keeps sandbox + autoRun on one call when there is no preset", () => {
    expect(
      setPolicyCallParams("s1", { sandbox: "workspace-write", autoRun: "safe-only" }),
    ).toEqual([{ sessionId: "s1", sandbox: "workspace-write", autoRun: "safe-only" }]);
  });

  it("never invents a preset for non-domain policies", () => {
    expect(setPolicyCallParams("s1", { autoRun: "safe-only" })).toEqual([
      { sessionId: "s1", autoRun: "safe-only" },
    ]);
  });
});
