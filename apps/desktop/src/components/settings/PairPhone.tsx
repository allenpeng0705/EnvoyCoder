/**
 * Pair a phone: **the mint call and the code it produces, in one place.**
 *
 * ## Why this is a module rather than two copies
 *
 * The pairing surface lived inside `SectionsFacts.tsx`'s *This machine* section, and the command palette's
 * *Pair a phone* row answered with a sentence claiming pairing did not exist. The claim was stale — the row
 * simply never reached the flow. Wiring the palette to a second copy of "call `coder.mintPairing`, draw the
 * URI as a QR, offer to copy it" is exactly the drift this repo refuses: two implementations of one
 * **secret-producing** call, only one of them covered by a test. So the call (`mintPairingCode`) and the
 * code's rendering (`PairPhonePanel`) live here, the *Pairing* section and the window shell both use them,
 * and there is one place to change when the URI grows a field.
 *
 * ## Why minting is a function called from a press, and not an effect
 *
 * `main.tsx` mounts the window in `<StrictMode>`, which invokes a *mounting* effect twice in development.
 * An effect that minted would therefore create two paired-device records for one press — a real record on
 * the daemon, not merely a doubled render — and this repo has already paid for that lesson once
 * (`coderStore.ts:248`, where StrictMode's doubled effect opened two sockets). So the **press is the
 * request**: `mintPairingCode` is called from an event handler (the *Pairing* section's button, the rail-top
 * QR button through `CoderApp.openPairing`, and the palette's `run`), and the panel below only renders what
 * came back.
 *
 * ## What this module owns, and what it deliberately does not
 *
 * `coder.mintPairing` is refused for a paired device and allowed for the owner's window
 * (`daemon/pairing.ts`'s `requireOwnerWindow`). Both callers here run in that window, and neither weakens
 * the gate — a refusal travels back as the sentence the panel renders, because a refusal is an answer a
 * user has to read. The QR is generated in this window from the URI with `qrcode`: the URI carries the
 * secret, and a phone scans it off the screen, so it must never leave the machine to be encoded.
 */

import type { JSX } from "react";

import { useEffect, useState } from "react";

import { useI18n } from "../../i18n/context.js";
import type { AgentActions } from "../../state/agent-actions.js";
import { canCopyText, copyText } from "./clipboard.js";
import { renderPairingQr, type RenderedPairingQr } from "./pairing-qr.js";

/**
 * What one press on a pairing control produced: the code, or the daemon's own refusal in its words.
 *
 * A union rather than `{ uri?, error? }`, because "minted" and "refused" are the only two outcomes and a
 * record that could hold both would make the panel's two branches a matter of which field a caller
 * happened to set.
 */
export type PairPhoneOutcome =
  | { readonly ok: true; readonly uri: string }
  | { readonly ok: false; readonly message: string };

/**
 * Mint one pairing code — **the only call site of `coder.mintPairing` in the window.**
 *
 * The label is recorded by the daemon against the device this code will pair, so the paired-devices list on
 * *This machine* names the phone rather than showing a bare id. `"Phone"` is the shipped label because the
 * milestone's client is the mobile app; a caller may pass its own.
 *
 * `host` + `token` are the typed (host:port) route: the user chose the address and a short passphrase.
 * Omit both for QR — the daemon mints a long random secret the phone only scans.
 *
 * `fresh` forces a new QR secret (the section's "Show a new code"). Absent, an unused QR is reused so
 * opening Pairing does not stack rows on *This machine*.
 */
export async function mintPairingCode(
  agents: AgentActions,
  input: { deviceLabel?: string; host?: string; token?: string; fresh?: boolean } = {},
): Promise<PairPhoneOutcome> {
  const result = await agents.mintPairing({
    deviceLabel: input.deviceLabel ?? "Phone",
    ...(input.host ? { host: input.host } : {}),
    ...(input.token ? { token: input.token } : {}),
    ...(input.fresh === true ? { fresh: true } : {}),
  });
  return result.ok ? { ok: true, uri: result.uri } : { ok: false, message: result.message };
}

export interface PairPhonePanelProps {
  /** What the press produced. */
  outcome: PairPhoneOutcome;
  /**
   * Leave the pairing surface.
   *
   * Closing does **not** revoke the code: the record is already on the daemon and expires on its own. The
   * list below the row is where it is revoked, which is a different action with its own button.
   */
  onClose: () => void;
}

/**
 * The minted code, as a QR **and** as text a user can paste.
 *
 * Both forms, because a phone scans the image while a machine that cannot see it needs the URI — the same
 * pairing the *Pairing* section and the palette row both show, kept identical here so the two routes cannot
 * present one code two ways.
 */
export function PairPhonePanel(props: PairPhonePanelProps): JSX.Element {
  const { t } = useI18n();
  const [qr, setQr] = useState<RenderedPairingQr | null>(null);
  const [copied, setCopied] = useState(false);
  // Read once, outside the callbacks: the discriminant narrows `props.outcome` here but not inside a
  // handler that may run later, and re-checking it in every branch is how the two halves of this panel
  // come to disagree about what is on screen.
  const uri = props.outcome.ok ? props.outcome.uri : null;

  useEffect(() => {
    // A refusal has no code to draw, and a second press replaces the first: regenerating on the URI (and
    // clearing when there is none) is what keeps a superseded QR from sitting beside a new one.
    if (uri === null) {
      setQr(null);
      return;
    }
    let cancelled = false;
    // `renderPairingQr` owns the dimensions (module count read back from the encoder, integer px per
    // module, four-module quiet zone); the panel's only job is to display the result at exactly the size
    // that was generated, which the inline width/height below guarantee.
    void renderPairingQr(uri).then((rendered) => {
      if (!cancelled) setQr(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (!props.outcome.ok) {
    return <p className="settings__note">{props.outcome.message}</p>;
  }
  const code = props.outcome.uri;

  return (
    <div className="settings__pairing" data-testid="pairing-panel">
      {qr ? (
        <img
          className="settings__pairing-qr"
          src={qr.dataUrl}
          alt={t("settings.pairing.qr.alt")}
          data-qr-modules={qr.modules}
          data-qr-px-per-module={qr.pxPerModule}
          data-qr-size={qr.sizePx}
          // Inline rather than in the stylesheet: the bitmap is `sizePx` square, and a CSS rule that
          // resized it would resample the modules — the exact failure this replaced.
          style={{ width: qr.sizePx, height: qr.sizePx }}
        />
      ) : null}
      <label className="settings__pairing-label">
        {t("settings.pairing.uriLabel")}
        <textarea className="settings__pairing-uri" readOnly value={code} rows={3} />
      </label>
      <div className="settings__pairing-actions">
        {/* **Copy through the shared clipboard helper, not `navigator.clipboard`.** The raw API rejects
            without a live gesture and is off under WebKitGTK, and the old `.then(() => setCopied(true))`
            therefore had two ways to show *Copied* over a secret that never reached the clipboard —
            the one outcome this pane forbids. `clipboard.ts` tries the webview, then the shell's own
            `copy_text`, then the legacy path, and answers honestly. The button is drawn only where a
            write can work at all, exactly as `CopyCommand.tsx` does. */}
        {canCopyText() ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              void copyText(code).then(setCopied);
            }}
          >
            {copied ? t("settings.pairing.copied") : t("settings.pairing.copy")}
          </button>
        ) : null}
        <button type="button" className="button" onClick={props.onClose}>
          {t("settings.pairing.close")}
        </button>
      </div>
    </div>
  );
}
