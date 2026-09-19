import { describe, expect, it } from "vitest";

import { permissionReply, userQuestionReply } from "../src/daemon/acp/protocol.js";

describe("permission replies", () => {
  it("answers Envoy Harness with allow or deny, because it sends no choices", () => {
    const request = { sessionId: "s", toolName: "bash" };
    expect(permissionReply(request, "allow")).toEqual({ decision: "allow" });
    expect(permissionReply(request, "deny")).toEqual({ decision: "deny" });
    expect(permissionReply(request, null)).toEqual({ decision: "deny" });
  });

  it("answers an agent that listed choices with the choice it named", () => {
    const request = {
      sessionId: "s",
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    };
    expect(permissionReply(request, "allow-once")).toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
    expect(permissionReply(request, null)).toEqual({ outcome: { outcome: "cancelled" } });
  });
});

describe("user question replies", () => {
  const options = ["App", "Tests", "Docs"];

  it("sends every ticked option when the question allows more than one", () => {
    expect(userQuestionReply({ options, multiple: true }, { optionIds: ["0", "2"] })).toEqual({
      value: "App, Docs",
      optionIndexes: [0, 2],
      cancelled: false,
    });
  });

  it("sends one index when the question is a single pick", () => {
    expect(userQuestionReply({ options }, { optionIds: ["1"] })).toEqual({
      value: "Tests",
      optionIndex: 1,
      cancelled: false,
    });
  });

  it("sends the typed answer when there is no list", () => {
    expect(userQuestionReply({ options: [] }, { text: "the project root" })).toEqual({
      value: "the project root",
      cancelled: false,
    });
  });

  it("cancels when nobody answered", () => {
    expect(userQuestionReply({ options, multiple: true }, null)).toEqual({
      value: "",
      cancelled: true,
    });
  });
});
