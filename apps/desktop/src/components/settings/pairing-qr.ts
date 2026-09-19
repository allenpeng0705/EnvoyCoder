/**
 * The pairing QR — **the family's render, not a number this repo invents.**
 *
 * ## Why these exact parameters
 *
 * EnvoyMesh already solved this: `apps/social/src/components/PairingQRModal.tsx:71-76` mints the compressed
 * token and renders it with
 *
 * ```js
 * const token = await encodePairingToken(payload);
 * const built = `envoy://pair?pairing=${token}`;
 * const dataUrl = await QRCode.toDataURL(built, { width: 512, margin: 2 });
 * ```
 *
 * with the comment *"Encode all fields into a gzip-compressed token — keeps the QR short enough to scan
 * reliably despite the dense encoding."* `FamilyInviteQRModal.tsx:45` uses `{ width: 512, margin: 2 }` too,
 * and `ShareContactCard.tsx:84-87` drops to `{ width: compact ? 280 : 320, margin: 2, errorCorrectionLevel:
 * "L" }` only for the smaller *contact card* payload. So the family convention for **pairing** is
 * **512 px, margin 2, default (`M`) error correction**, and EnvoyDev adopts it rather than deriving its own.
 *
 * ## The failure this replaces
 *
 * EnvoyDev got all three wrong: the uncompressed legacy query URI (~1 kB of percent-encoded PEM key, owner
 * id, peer id and multiaddrs), rendered at `{ margin: 1, width: 220 }`. For a real payload that is a
 * version-26 symbol — 121 modules — at ~1.8 px/module, less than half the ~4 px/module a phone needs, with
 * a quiet zone a quarter of the spec's four modules. The owner installed the mobile app and the camera
 * could not read the code.
 *
 * The fix is the family's render, and **compression is what gives it headroom**. Measured on the real
 * payload shape (six multiaddrs — two direct/LAN, one circuit per community relay, both bare hints):
 *
 * | payload | chars | version | modules | @220/margin1 | @512/margin2 |
 * |---|---|---|---|---|---|
 * | legacy query URI | 1113 | 26 | 121 | 1.79 | 4.10 |
 * | compressed token | 535 | 18 | 89 | 2.42 | **5.51** |
 *
 * At the family's 512 px the legacy payload only just reaches the 4 px/module floor; the compressed token
 * clears it with real margin, and a longer payload (more relays, a longer key) pushes the legacy form back
 * under. So this is not "either fix would do" — the compressed mint and the family render are both
 * load-bearing, which is why the regression test asserts both.
 *
 * ## Bitmap and display
 *
 * `width: 512` fixes the *image* at 512 px; the panel must display it at exactly that size, because a
 * bitmap scaled up by CSS is interpolated and stays unscannable. `PairPhone.tsx` sets the `<img>` width
 * and height inline from {@link RenderedPairingQr.sizePx}, and `.settings__pairing-qr` deliberately carries
 * no width/height of its own so no stylesheet can resample it.
 *
 * ## Error correction
 *
 * `M`, the family's pairing default. `L` fits one version less but is what the family reserves for the
 * smaller contact card; pairing keeps `M`'s ~15% recovery for glare and screen moiré.
 */

import QRCode from "qrcode";
import type { QRCodeErrorCorrectionLevel } from "qrcode";

/** The rendered width in pixels. The family's pairing value (`PairingQRModal.tsx:76`). */
export const PAIRING_QR_WIDTH_PX = 512;

/** The quiet zone in modules. The family's pairing value (`PairingQRModal.tsx:76`), not the spec's 4. */
export const PAIRING_QR_MARGIN_MODULES = 2;

/** Error correction: `M`, the family's pairing default — `L` is for the contact card. */
export const PAIRING_QR_ERROR_CORRECTION: QRCodeErrorCorrectionLevel = "M";

/** The floor below which a phone camera stops resolving modules on a screen. */
export const PAIRING_QR_MIN_PX_PER_MODULE = 4;

/** One rendered code: what to show, and the arithmetic that decided how big that is. */
export interface RenderedPairingQr {
  /** The PNG data URL, at exactly {@link sizePx} pixels square. */
  readonly dataUrl: string;
  /** Symbol modules across, **quiet zone excluded** (`17 + 4 × version`). */
  readonly modules: number;
  /** Quiet-zone modules on each side. */
  readonly quietZoneModules: number;
  /** Effective pixels per module: `sizePx / (modules + 2 × quietZone)`. */
  readonly pxPerModule: number;
  /** The image's real pixel size — what the `<img>` must be displayed at. */
  readonly sizePx: number;
}

/**
 * Encode one pairing URI and report the dimensions the panel must honor.
 *
 * The `modules` count comes from `QRCode.create` — the encoder's own answer for *this* URI — and `sizePx`
 * from the same arithmetic `qrcode`'s renderer uses for `width` (`renderer/utils.js`'s `getImageWidth`, an
 * integer floor of `width`), so the reported size and the emitted PNG cannot disagree. The regression test
 * checks that against the actual PNG bytes rather than trusting this function.
 */
export async function renderPairingQr(uri: string): Promise<RenderedPairingQr> {
  const symbol = QRCode.create(uri, { errorCorrectionLevel: PAIRING_QR_ERROR_CORRECTION });
  const modules = symbol.modules.size;
  const totalModules = modules + PAIRING_QR_MARGIN_MODULES * 2;
  // `qrcode` scales by `width / totalModules` (fractional), then floors the image size; below the symbol's
  // own size it falls back to its default scale of 4. Mirrored here so `sizePx` is the real output size.
  const scale = PAIRING_QR_WIDTH_PX >= totalModules ? PAIRING_QR_WIDTH_PX / totalModules : 4;
  const sizePx = Math.floor(totalModules * scale);
  const dataUrl = await QRCode.toDataURL(uri, {
    errorCorrectionLevel: PAIRING_QR_ERROR_CORRECTION,
    margin: PAIRING_QR_MARGIN_MODULES,
    width: PAIRING_QR_WIDTH_PX,
    // A white (not transparent) background: a scanner reads the light modules, and a transparent PNG over
    // a dark settings pane is a QR with no light modules at all.
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  return {
    dataUrl,
    modules,
    quietZoneModules: PAIRING_QR_MARGIN_MODULES,
    pxPerModule: sizePx / totalModules,
    sizePx,
  };
}
