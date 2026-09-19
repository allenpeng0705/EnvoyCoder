/**
 * A picture must not travel as a flat string. That shape is how a text turn reaches envoy-harness,
 * and it has nowhere to put an image.
 */

import { describe, expect, it } from "vitest";

import { sessionPromptAttempts } from "../src/daemon/acp/prompt-attempts.js";

describe("session/prompt shapes", () => {
  it("keeps the text-only order: the standard array, then the flat string", () => {
    expect(sessionPromptAttempts("s1", "hello")).toEqual({
      pictures: false,
      first: { sessionId: "s1", prompt: [{ type: "text", text: "hello" }] },
      second: { sessionId: "s1", text: "hello" },
    });
  });

  it("sends a picture as content blocks first, and never as a flat string", () => {
    const attempts = sessionPromptAttempts("s1", "see this", [{ mimeType: "image/png", data: "abcd" }]);
    expect(attempts.pictures).toBe(true);
    expect(attempts.first).toEqual({
      sessionId: "s1",
      content: [
        { type: "text", text: "see this" },
        { type: "image", mimeType: "image/png", data: "abcd" },
      ],
    });
    expect(attempts.second).toEqual({
      sessionId: "s1",
      prompt: [
        { type: "text", text: "see this" },
        { type: "image", mimeType: "image/png", data: "abcd" },
      ],
    });
    expect(JSON.stringify(attempts)).not.toContain('"text":"see this","sessionId"');
  });
});
