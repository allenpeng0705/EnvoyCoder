/**
 * What a row in *This machine*'s list actually is — **derived from the record, never assumed.**
 *
 * ## Why this is a taxonomy rather than a boolean
 *
 * The list is the daemon's **issued** records (`daemon/paired-devices.ts`): a row is written when a code
 * is minted, which happens *before* any phone has scanned it, and the row is deliberately kept after
 * revocation as the evidence that the token was withdrawn. The pane used to call all of it "Paired
 * devices", which claimed a pairing that may never have happened for a code nobody scanned — the same
 * defect class as a status bar claiming machines are connected. The record already carries the facts that
 * tell the states apart (`revokedAt`, `lastSeenAt`, `expiresAt`), so the UI derives the state instead of
 * inventing a friendlier one:
 *
 *   * `revoked` — a token that was withdrawn. Kept as evidence; removable only by an explicit forget.
 *   * `expired` — past its expiry and never revoked. It authenticates nothing, so it is not active.
 *   * `active`  — still authenticates **and** has been used at least once (`lastSeenAt`). This is the
 *                 only state a user may read as a device that actually reached this machine.
 *   * `unused`  — still authenticates but has never been used: the code was minted and no device ever
 *                 presented it, so "paired" would be a claim the data denies.
 *
 * ## Why `now` is a parameter
 *
 * `Date.now()` inside would make the expiry boundary untestable without faking the clock, and the
 * boundary is the one thing a test has to be able to sit on. Passing it keeps the function pure, which
 * is also why the pane can call it during render without a subscription.
 */

/** The record fields the state depends on — a projection, so a test fixture needs no store. */
export interface PairedDeviceLike {
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
}

export type PairedDeviceState = "revoked" | "expired" | "active" | "unused";

export interface PairedDeviceStanding {
  state: PairedDeviceState;
  /**
   * The moment the state's sentence should name.
   *
   * Each state reads a **different** field — revoked-at, expiry, last-used — and the whole point of the
   * taxonomy is that the row says which fact put it there. Letting the caller pick the field would let
   * the sentence and the state disagree, so they travel together.
   */
  at: string;
}

export function pairedDeviceStanding(device: PairedDeviceLike, now: Date): PairedDeviceStanding {
  // Revocation wins over every other fact: a withdrawn token is withdrawn even if it was used before.
  if (device.revokedAt) return { state: "revoked", at: device.revokedAt };
  const expires = Date.parse(device.expiresAt);
  // An unparseable expiry is treated as expired, which is the conservative direction: it refuses to call
  // a record active on the strength of a value the daemon could not have meant.
  if (Number.isNaN(expires) || expires <= now.getTime()) {
    return { state: "expired", at: device.expiresAt };
  }
  if (device.lastSeenAt) return { state: "active", at: device.lastSeenAt };
  return { state: "unused", at: device.expiresAt };
}

/**
 * The chip's number: how many records are **active** in the sense above.
 *
 * Not `devices.length`, which counted revoked and never-scanned records and so only ever grew. Neither
 * `revoked` nor `unused` may inflate a number a user reads as devices with access: a revoked token has
 * none, and a code nobody has used has not been paired with anything yet.
 */
export function countActiveDevices(devices: readonly PairedDeviceLike[], now: Date): number {
  return devices.filter((device) => pairedDeviceStanding(device, now).state === "active").length;
}
