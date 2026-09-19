/**
 * Reading a pairing code — the client-side half of the format `index.ts` mints.
 *
 * ## Why this is its own module
 *
 * `index.ts` is the package's public surface and it crossed the family's 800-line hard cap when the
 * compressed form and its reader landed here. The rule's answer is not a shorter comment but a smaller
 * file: minting a code (the `CoderDaemonHost` in `index.ts`) and reading one (this file) are two jobs with
 * two audiences — a host mints, a client reads — so they are two modules and the surface re-exports both.
 *
 * ## Both URI forms, because we mint both
 *
 * `pairingUri` mints the compressed `pairing=` form for the QR (the legacy query string of a real payload
 * is ~1 kB and renders a version-25 symbol a camera cannot resolve) and the legacy form for the typed
 * `host:port` route. A reader that understood only query params would therefore refuse the code this
 * product itself produced — the smoke's "the daemon minted a code its own window would refuse" leg is
 * exactly that assertion. The compressed path uses the family's shared decoder (the one the phone's Dart
 * port mirrors), so a token this function cannot read is one the phone cannot read either.
 */

import { ENVOYDEV_ERRORS, ENVOYDEV_PRODUCT_NAME } from "@envoydev/protocol";
import { pairingAppMismatch } from "@envoymesh/protocol";
import { decodePairingTokenAsync, parsePairingUri } from "@envoymesh/reuse-host";

export type PairingCheck =
  | { ok: true; wsUrl: string; token: string; ownerId: string; lanWsUrl?: string }
  | { ok: false; code: string; /** End-user wording. */ message: string };

/**
 * Read a pairing code the way a client must: refuse another app's code, with the family's sentence.
 *
 * `pairingAppMismatch` is shared with every other app in the family, so all of them refuse each
 * other's codes in the same words — "That code was made by EnvoyMesh, and this is EnvoyDev.
 * Open EnvoyMesh and show its pairing code, or install EnvoyMesh here." A per-product variation of
 * that sentence would be a UX bug, which is why it lives in `@envoymesh/protocol` and not here.
 *
 * Async because decompression is: `decodePairingTokenAsync` uses `DecompressionStream`, which works in
 * the browser and on Node alike. That matters more here than in the daemon, because this is the function
 * a *client* would call.
 */
export async function checkPairingCode(
  input: string,
  product: string = ENVOYDEV_PRODUCT_NAME,
): Promise<PairingCheck> {
  let failReason: string | undefined;
  let parsed: {
    wsUrl: string;
    token: string;
    ownerId: string;
    app?: string;
    lanWsUrl?: string;
  } | null = null;

  const compressed = compressedPairingToken(input);
  if (compressed !== null) {
    try {
      const decoded = await decodePairingTokenAsync(compressed);
      parsed = {
        wsUrl: decoded.wsUrl,
        token: decoded.token,
        ownerId: decoded.ownerId,
        ...(decoded.app ? { app: decoded.app } : {}),
        ...(decoded.lanWsUrl ? { lanWsUrl: decoded.lanWsUrl } : {}),
      };
    } catch (error) {
      // Fall through to the legacy reader, exactly as the phone does: a `pairing=` value that is not a
      // token is not a reason to refuse the query params that may sit beside it.
      failReason = error instanceof Error ? error.message : String(error);
    }
  }
  if (parsed === null) {
    try {
      const legacy = parsePairingUri(input);
      if (legacy) {
        parsed = {
          wsUrl: legacy.wsUrl,
          token: legacy.token,
          ownerId: legacy.ownerId,
          ...(legacy.app ? { app: legacy.app } : {}),
          ...(legacy.lanWsUrl ? { lanWsUrl: legacy.lanWsUrl } : {}),
        };
      }
    } catch (error) {
      failReason = error instanceof Error ? error.message : String(error);
    }
  }
  if (parsed === null) {
    return {
      ok: false,
      code: ENVOYDEV_ERRORS.daemonUnreachable,
      message:
        failReason === undefined
          ? "That pairing code is empty or could not be read."
          : `That does not look like a pairing code: ${failReason}`,
    };
  }
  const mismatch = pairingAppMismatch(parsed.app, product);
  if (mismatch) return { ok: false, code: ENVOYDEV_ERRORS.appMismatch, message: mismatch };
  return {
    ok: true,
    wsUrl: parsed.wsUrl,
    token: parsed.token,
    ownerId: parsed.ownerId,
    ...(parsed.lanWsUrl ? { lanWsUrl: parsed.lanWsUrl } : {}),
  };
}

/**
 * The `pairing=` value of an `envoy://pair` URI, or `null` when this is not the compressed form.
 *
 * Deliberately narrow: only the exact `envoy://pair` authority the family's builder writes is inspected, so
 * a QR carrying `pairing` under some other scheme is not mistaken for one of ours. The value is returned
 * as written — the family decoder owns what a valid token is.
 */
function compressedPairingToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("envoy://pair")) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "envoy:" || url.hostname !== "pair") return null;
    const token = url.searchParams.get("pairing")?.trim();
    return token ? token : null;
  } catch {
    return null;
  }
}
