/**
 * **The pairing QR, decoded back to the URI it claims to carry.**
 *
 * The defect this file exists for: the owner installed the mobile app and the camera could not read the
 * code. The panel drew the *legacy* query URI (~1 kB of percent-encoded PEM key, owner id, peer id and a
 * multiaddr list) with `{ margin: 1, width: 220 }`, which is a version-23..25 symbol — 109..117 modules —
 * at ~1.9 px/module, less than half the ~4 px/module a phone needs, and with a quiet zone a quarter of the
 * spec's four modules.
 *
 * The fix is the **family's** convention, not one derived here: `EnvoyMesh/apps/social/src/components/
 * PairingQRModal.tsx:71-76` mints `envoy://pair?pairing=<encodePairingToken(payload)>` and renders it with
 * `{ width: 512, margin: 2 }` and the default error correction (`M`). `PairingQRModal.tsx:71-72`'s own
 * comment gives the reason — *"Encode all fields into a gzip-compressed token — keeps the QR short enough
 * to scan reliably despite the dense encoding."* `FamilyInviteQRModal.tsx:45` agrees; `ShareContactCard.tsx:
 * 84-87` uses the smaller `{ width: 320, margin: 2, errorCorrectionLevel: "L" }` only for a contact card.
 *
 * The strongest available proof is not "a data URL was produced" (that is exactly what shipped green): it
 * is to **decode the generated PNG back to the exact URI**. `jsqr` is a dependency-free decoder and `pngjs`
 * is the raster library `qrcode` itself uses on Node, so the image under test is the image the panel hands
 * the `<img>`, not a re-render of the module matrix.
 *
 * Run in the **node** environment on purpose: there `qrcode` renders through `pngjs` (no DOM canvas), which
 * is what makes the bitmap inspectable. The browser build the app ships uses the same
 * `renderer/utils.js` geometry, so the sizes asserted here are the ones on screen.
 *
 * ## Fail-without-fix
 *
 * Verified by reverting one fix at a time and re-running this file (raw output in the task report):
 *   * `margin: 1` instead of the family's `2` → the quiet-zone assertion fails;
 *   * `width: 220` instead of the family's `512` → the px/module floor assertion fails;
 *   * the legacy mint instead of the compressed one → the payload/version assertion fails.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import QRCode from "qrcode";

import { coderSessionIdentity, createCoderDaemonHost } from "@envoydev/host-bridge";
import {
  PAIRING_QR_MARGIN_MODULES,
  PAIRING_QR_MIN_PX_PER_MODULE,
  PAIRING_QR_WIDTH_PX,
  renderPairingQr,
} from "../src/components/settings/pairing-qr.js";

const TOKEN = "kJ8sQ2mZ4xR7vN1pL5tY6bW9cD3fG0hA";
const OWNER_KEY = `-----BEGIN PUBLIC KEY-----\n${"A".repeat(43)}=\n-----END PUBLIC KEY-----`;
const OWNER_ID = "envoy:owner:local-9f2c1a7b3d4e5f60";
// A **distinct** home peer id: a fixture that reused a relay's id made gzip's repetition shrink the token
// and reported a rosier px/module than a real payload gets.
const PEER_ID = "12D3KooWHomeNodeForPairingQrTest00000000000000000";

/**
 * The two community relays the family ships, bare and as a circuit through this node. Both must survive
 * compression: a phone on the wrong side of the world reaches the daemon through one of them, and a QR
 * that silently lost one would fail only for those users.
 */
const RELAY_CN = "/ip4/47.93.11.212/tcp/4001/p2p/12D3KooWLNR4WYWHBswe8ux5zWsy6cuGywnYPJbdbaAbbpmJMjbo";
const RELAY_US = "/ip4/47.251.91.97/tcp/4001/p2p/12D3KooWAWiVSpsCjpjauz83ijLugxwScRJi89N4PA1VQ1Czsncb";

/**
 * The exact payload a hosting daemon mints for the QR route: the real host, the real builders, and the
 * mesh fields `serve.ts` supplies — two direct/LAN addresses, one circuit address per relay, and both bare
 * relay hints, i.e. the six deduped multiaddrs the contract carries in `bootstrapPeers`.
 *
 * `port: 0` because nothing here dials — only the payload's shape matters.
 */
async function pairUris(): Promise<{ compressed: string; legacy: string }> {
  const host = createCoderDaemonHost({
    port: 0,
    sessionIdentity: coderSessionIdentity(),
    dispatch: async () => undefined,
  });
  try {
    const input = {
      token: TOKEN,
      ownerPublicKey: OWNER_KEY,
      ownerId: OWNER_ID,
      host: "192.168.1.20",
      lanHost: "192.168.1.20",
      meshPeerId: PEER_ID,
      meshMultiaddrs: [
        `/ip4/192.168.1.20/tcp/4001/p2p/${PEER_ID}`,
        `/ip4/203.0.113.7/tcp/4001/p2p/${PEER_ID}`,
        `${RELAY_CN}/p2p-circuit/p2p/${PEER_ID}`,
        `${RELAY_US}/p2p-circuit/p2p/${PEER_ID}`,
      ],
      meshRelayHints: [RELAY_CN, RELAY_US],
    };
    return {
      compressed: await host.pairingUri(input),
      legacy: await host.pairingUri(input, { compressed: false }),
    };
  } finally {
    host.stop();
  }
}

/** The PNG the panel would show, as raw RGBA plus its real pixel dimensions. */
function decode(dataUrl: string): { text: string; png: PNG } {
  const base64 = /^data:image\/png;base64,(.*)$/s.exec(dataUrl)?.[1];
  if (!base64) throw new Error("the render did not produce a PNG data URL");
  const png = PNG.sync.read(Buffer.from(base64, "base64"));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!result) throw new Error(`jsQR could not decode a ${png.width}×${png.height} image`);
  return { text: result.data, png };
}

describe("the pairing QR the panel shows", () => {
  it("decodes back to the exact URI the daemon minted", async () => {
    const { compressed } = await pairUris();
    const rendered = await renderPairingQr(compressed);
    const { text } = decode(rendered.dataUrl);
    // Byte-for-byte, not "contains": the QR is the only carrier of a secret the phone authenticates with,
    // and a single escaped character lost in the render would pair a device to nothing.
    expect(text).toBe(compressed);
  });

  it("renders at the family's 512 px and clears the scanner floor", async () => {
    const { compressed } = await pairUris();
    const rendered = await renderPairingQr(compressed);

    // The family's `{ width: 512, margin: 2 }`, and the quiet zone that goes with it.
    expect(Math.abs(rendered.sizePx - PAIRING_QR_WIDTH_PX)).toBeLessThanOrEqual(1);
    expect(rendered.quietZoneModules).toBe(PAIRING_QR_MARGIN_MODULES);

    // **Measure the floor off the bitmap, not off the constant that configured it.** A revert to
    // `width: 220` would leave the reported numbers saying otherwise while the PNG is 220 px across; this
    // is the number that would then be ~1.9.
    const { png } = decode(rendered.dataUrl);
    const actualPxPerModule = png.width / (rendered.modules + rendered.quietZoneModules * 2);
    expect(actualPxPerModule).toBeGreaterThanOrEqual(PAIRING_QR_MIN_PX_PER_MODULE);
    // And the generated resolution and the displayed size are the same number. A bitmap smaller than the
    // `<img>` it fills is interpolated, and interpolation is what keeps a "big" QR unscannable.
    expect(png.width).toBe(rendered.sizePx);
    expect(png.height).toBe(rendered.sizePx);
    expect(rendered.modules).toBeGreaterThan(0);
  });

  it("carries the family's quiet zone, white on every side", async () => {
    const { compressed } = await pairUris();
    const rendered = await renderPairingQr(compressed);
    // The family's pairing value is **2** modules (`PairingQRModal.tsx:76`), not the spec's 4 — an explicit
    // choice to match the family's working code. The tradeoff is recorded here rather than hidden: a
    // two-module quiet zone is below the QR spec's recommendation and relies on the surrounding page being
    // light, which is why `.settings__pairing-qr` forces a white background.
    expect(rendered.quietZoneModules).toBe(2);

    const { png } = decode(rendered.dataUrl);
    const scaledMargin = rendered.quietZoneModules * rendered.pxPerModule;
    // A pixel well inside the quiet zone, on both sides; the scale is fractional, so the exact boundary is
    // not an integer and over-approximating it would test the symbol's first dark row by accident.
    const inner = Math.floor(scaledMargin / 2);

    const pixel = (x: number, y: number): number => {
      const i = (y * png.width + x) * 4;
      return png.data[i]! + png.data[i + 1]! + png.data[i + 2]!;
    };
    for (let y = 0; y < png.height; y += 1) {
      for (const x of [0, inner, png.width - 1 - inner, png.width - 1]) {
        expect(pixel(x, y), `quiet zone at (${x}, ${y})`).toBe(255 * 3);
      }
    }
    for (let x = 0; x < png.width; x += 1) {
      for (const y of [0, inner, png.height - 1 - inner, png.height - 1]) {
        expect(pixel(x, y), `quiet zone at (${x}, ${y})`).toBe(255 * 3);
      }
    }
    // …and the first symbol pixel is dark, so the assertion above is not vacuously "all white".
    const firstSymbol = Math.ceil(scaledMargin);
    expect(pixel(firstSymbol, firstSymbol)).toBe(0);
  });

  it("mints the compressed form, which is the shorter symbol", async () => {
    const { compressed, legacy } = await pairUris();
    // The family's pairing path: a gzip token under `pairing=`, not the legacy query string.
    expect(compressed.startsWith("envoy://pair?pairing=")).toBe(true);
    expect(legacy.startsWith("envoy://pair?wsUrl=")).toBe(true);

    const legacyModules = QRCode.create(legacy, { errorCorrectionLevel: "M" }).modules.size;
    const compressedModules = QRCode.create(compressed, { errorCorrectionLevel: "M" }).modules.size;
    expect(compressed.length).toBeLessThan(legacy.length);
    expect(compressedModules).toBeLessThan(legacyModules);

    // **The regression, written down as a number.** At the settings this replaced — the legacy URI at
    // `width: 220`, `margin: 1` — the render was below half the floor. If someone restores either the old
    // payload or the old width, this is the arithmetic that says so.
    const legacyPxPerModuleAt220 = 220 / (legacyModules + 2 * 1);
    expect(legacyModules).toBeGreaterThanOrEqual(100);
    expect(legacyPxPerModuleAt220).toBeLessThan(PAIRING_QR_MIN_PX_PER_MODULE);
  });
});
