import { describe, expect, it } from "vitest";

import { looksLikeAgentMention, triggerFromGithubComment } from "../src/index.js";

describe("GitHub Source helpers", () => {
  it("builds a Trigger from a comment", () => {
    const trigger = triggerFromGithubComment({
      repo: "acme/app",
      number: 12,
      commentId: "99",
      body: "@bot please fix flaky auth",
      actor: "alice",
      at: "2026-01-01T00:00:00.000Z",
    });
    expect(trigger.id).toBe("gh-comment-99");
    expect(trigger.threadKey).toBe("github:acme/app#12");
    expect(trigger.sourceKind).toBe("github");
    expect(looksLikeAgentMention(trigger.text, ["bot"])).toBe(true);
    expect(looksLikeAgentMention(trigger.text, ["other"])).toBe(false);
  });

  it("matches @name only — not a bare substring or a longer handle", () => {
    expect(looksLikeAgentMention("@envoy please look", ["envoy", "envoydev"])).toBe(true);
    expect(looksLikeAgentMention("Hey @EnvoyDev — flaky?", ["envoy", "envoydev"])).toBe(true);
    expect(looksLikeAgentMention("please ask envoy about this", ["envoy", "envoydev"])).toBe(false);
    expect(looksLikeAgentMention("envoydev rocks", ["envoy", "envoydev"])).toBe(false);
    expect(looksLikeAgentMention("@envoy-bot please look", ["envoy"])).toBe(false);
    expect(looksLikeAgentMention("@envoy_bot please look", ["envoy"])).toBe(false);
  });
});
