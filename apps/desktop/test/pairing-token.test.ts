import { describe, expect, it } from "vitest";

import {
  USER_PAIRING_TOKEN_MAX_LEN,
  USER_PAIRING_TOKEN_MIN_LEN,
  normalizeUserPairingToken,
} from "../src/pairing-token.js";

describe("normalizeUserPairingToken", () => {
  it("accepts 8–10 alphanumeric characters", () => {
    expect(normalizeUserPairingToken("MyPhone99")).toEqual({ ok: true, token: "MyPhone99" });
    expect(normalizeUserPairingToken("  abcdefgh  ")).toEqual({ ok: true, token: "abcdefgh" });
    expect(normalizeUserPairingToken("a".repeat(USER_PAIRING_TOKEN_MAX_LEN))).toEqual({
      ok: true,
      token: "a".repeat(USER_PAIRING_TOKEN_MAX_LEN),
    });
  });

  it("rejects length outside the band", () => {
    expect(normalizeUserPairingToken("short")).toEqual({ ok: false, reason: "length" });
    expect(normalizeUserPairingToken("a".repeat(USER_PAIRING_TOKEN_MIN_LEN - 1))).toEqual({
      ok: false,
      reason: "length",
    });
    expect(normalizeUserPairingToken("a".repeat(USER_PAIRING_TOKEN_MAX_LEN + 1))).toEqual({
      ok: false,
      reason: "length",
    });
  });

  it("rejects non-alphanumeric characters", () => {
    expect(normalizeUserPairingToken("MyPhone!9")).toEqual({ ok: false, reason: "charset" });
    expect(normalizeUserPairingToken("token 99")).toEqual({ ok: false, reason: "charset" });
  });
});
