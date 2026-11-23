/**
 * Auth state classification — hang vs refusal, without starting an agent.
 */

import { describe, expect, it } from "vitest";

import {
  authStateOf,
  isHandshakeTimeoutReason,
  observeAuth,
} from "../src/daemon/auth-observation.js";

describe("authStateOf", () => {
  it("is ready when a session opened", () => {
    expect(authStateOf({ opened: true, authMethods: ["cursor_login"] })).toBe("ready");
  });

  it("is needs-signin on an auth refusal when methods are advertised", () => {
    expect(authStateOf({ opened: false, authMethods: ["cursor_login"] })).toBe("needs-signin");
  });

  it("is unknown on a handshake timeout even when methods are advertised", () => {
    expect(
      authStateOf({
        opened: false,
        authMethods: ["cursor_login"],
        handshakeTimedOut: true,
      }),
    ).toBe("unknown");
  });
});

describe("observeAuth", () => {
  it("maps session/new did-not-answer reasons to unknown with an honest probe detail", () => {
    expect(isHandshakeTimeoutReason("The agent did not answer session/new within 20s.")).toBe(true);
    expect(isHandshakeTimeoutReason("The agent did not answer authenticate within 180s.")).toBe(false);
    const observation = observeAuth({
      harness: "cursor",
      observedAt: "2026-11-23T00:00:00.000Z",
      opened: false,
      authMethods: ["cursor_login"],
      declared: "cursor_login",
      reason: "The agent did not answer session/new within 20s.",
    });
    expect(observation.state).toBe("unknown");
    expect(observation.methodId).toBeUndefined();
    expect(observation.detail).toMatch(/probe timed out/i);
  });

  it("keeps needs-signin when authenticate itself timed out", () => {
    const observation = observeAuth({
      harness: "cursor",
      observedAt: "2026-11-23T00:00:00.000Z",
      opened: false,
      authMethods: ["cursor_login"],
      declared: "cursor_login",
      reason: "The agent did not answer authenticate within 180s.",
    });
    expect(observation.state).toBe("needs-signin");
    expect(observation.methodId).toBe("cursor_login");
  });

  it("keeps needs-signin for Authentication required refusals", () => {
    const observation = observeAuth({
      harness: "cursor",
      observedAt: "2026-11-23T00:00:00.000Z",
      opened: false,
      authMethods: ["cursor_login"],
      declared: "cursor_login",
      reason: "Authentication required. Please run 'agent login' first.",
    });
    expect(observation.state).toBe("needs-signin");
    expect(observation.methodId).toBe("cursor_login");
  });
});
