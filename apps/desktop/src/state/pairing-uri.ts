/**
 * Read an `envoy://pair` URI in the **window** without importing `@envoydev/host-bridge`.
 *
 * The host-bridge barrel (and `@envoymesh/reuse-host`) pull Node + harness native addons into Vite's
 * dependency scan, which blanks the UI. Decoding uses only `@envoymesh/api`'s `pairing-token` module
 * (browser `DecompressionStream`) — the same codec `checkPairingCode` uses — via a Vite alias.
 */

import { ENVOYDEV_ERRORS, ENVOYDEV_PRODUCT_NAME } from "@envoydev/protocol";

import { decodePairingTokenAsync } from "@envoydev/window-pairing-token";

export type PairingUriFields = {
  wsUrl: string;
  token: string;
  ownerId: string;
  lanWsUrl?: string;
  app?: string;
};

export type PairingUriCheck =
  | { ok: true } & PairingUriFields
  | { ok: false; code: string; message: string };

/**
 * Same job as `checkPairingCode` in host-bridge, scoped for the webview.
 *
 * Accepts compressed `pairing=` (QR) and the legacy query-string form.
 */
export async function readPairingUri(
  input: string,
  product: string = ENVOYDEV_PRODUCT_NAME,
): Promise<PairingUriCheck> {
  let failReason: string | undefined;
  let parsed: PairingUriFields | null = null;

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
      failReason = error instanceof Error ? error.message : String(error);
    }
  }

  if (parsed === null) {
    try {
      parsed = parseLegacyPairingUri(input);
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

  const mismatch = pairingAppMismatchSentence(parsed.app, product);
  if (mismatch) {
    return { ok: false, code: ENVOYDEV_ERRORS.appMismatch, message: mismatch };
  }

  return { ok: true, ...parsed };
}

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

/** Legacy `envoy://pair?wsUrl=&token=&ownerPublicKey=&…` form (typed host:port mint). */
function parseLegacyPairingUri(input: string): PairingUriFields | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "envoy:" || url.hostname !== "pair") return null;
  const wsUrl = url.searchParams.get("wsUrl")?.trim();
  const token = url.searchParams.get("token")?.trim();
  const ownerId = url.searchParams.get("ownerId")?.trim();
  const ownerPublicKey = url.searchParams.get("ownerPublicKey")?.trim();
  if (!wsUrl || !token || !ownerId || !ownerPublicKey) return null;
  const lanWsUrl = url.searchParams.get("lanWsUrl")?.trim() || undefined;
  const app = url.searchParams.get("app")?.trim() || undefined;
  return {
    wsUrl,
    token,
    ownerId,
    ...(lanWsUrl ? { lanWsUrl } : {}),
    ...(app ? { app } : {}),
  };
}

/**
 * Family refusal sentence (`@envoymesh/protocol` `pairingAppMismatch`) inlined so the window never
 * imports the mesh protocol barrel for one string.
 */
function pairingAppMismatchSentence(codeApp: string | undefined, nodeApp: string): string | null {
  const raw = codeApp?.trim();
  if (!raw) return null;
  const claimed = safeAppLabel(raw);
  const mine = safeAppLabel(nodeApp);
  if (claimed === mine) return null;
  return (
    `That code was made by ${claimed}, and this is ${mine}. ` +
    `Open ${claimed} and show its pairing code, or install ${claimed} here.`
  );
}

function safeAppLabel(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned;
}
