/**
 * User-chosen host:port pairing tokens — shared by the daemon store and the Settings form.
 *
 * Kept free of `node:` imports so the window bundle can validate the same rules the store enforces.
 */

/** Inclusive length band for a user-chosen host:port token. */
export const USER_PAIRING_TOKEN_MIN_LEN = 8;
export const USER_PAIRING_TOKEN_MAX_LEN = 10;

const USER_PAIRING_TOKEN_RE = /^[A-Za-z0-9]+$/;

export type UserPairingTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: "length" | "charset" };

/**
 * Normalize and validate a user-chosen host:port token.
 *
 * QR mint never calls this — it uses a long random secret the phone only scans.
 */
export function normalizeUserPairingToken(raw: string): UserPairingTokenResult {
  const token = raw.trim();
  if (token.length < USER_PAIRING_TOKEN_MIN_LEN || token.length > USER_PAIRING_TOKEN_MAX_LEN) {
    return { ok: false, reason: "length" };
  }
  if (!USER_PAIRING_TOKEN_RE.test(token)) {
    return { ok: false, reason: "charset" };
  }
  return { ok: true, token };
}
