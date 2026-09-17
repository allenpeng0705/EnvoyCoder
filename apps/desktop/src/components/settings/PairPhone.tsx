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
 * code's rendering (`PairPhonePanel`) live here, the settings section and the window shell both use them,
 * and there is one place to change when the URI grows a field.
 *
 * ## Why minting is a function called from a press, and not an effect
 *
 * `main.tsx` mounts the window in `<StrictMode>`, which invokes a *mounting* effect twice in development.
 * An effect that minted would therefore create two paired-device records for one press — a real record on
 * the daemon, not merely a doubled render — and this repo has already paid for that lesson once
 * (`coderStore.ts:248`, where StrictMode's doubled effect opened two sockets). So the **press is the
 * request**: `mintPairingCode` is called from an event handler (the settings row's button, the palette's
 * `run`), and the panel below only renders what came back.
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
import QRCode from "qrcode";

import { useI18n } from "../../i18n/context.js";
import type { AgentActions } from "../../state/agent-actions.js";

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
 */
export async function mintPairingCode(
  agents: AgentActions,
  deviceLabel = "Phone",
): Promise<PairPhoneOutcome> {
  const result = await agents.mintPairing({ deviceLabel });
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
 * pairing the settings row has always shown, kept identical here so the palette's route and the row's
 * route cannot present the same code two ways.
 */
export function PairPhonePanel(props: PairPhonePanelProps): JSX.Element {
  const { t } = useI18n();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Read once, outside the callbacks: the discriminant narrows `props.outcome` here but not inside a
  // handler that may run later, and re-checking it in every branch is how the two halves of this panel
  // come to disagree about what is on screen.
  const uri = props.outcome.ok ? props.outcome.uri : null;

  useEffect(() => {
    // A refusal has no code to draw, and a second press replaces the first: regenerating on the URI (and
    // clearing when there is none) is what keeps a superseded QR from sitting beside a new one.
    if (uri === null) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(uri, { margin: 1, width: 220 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
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
      {qrDataUrl ? (
        <img className="settings__pairing-qr" src={qrDataUrl} alt={t("settings.machine.pair.title")} />
      ) : null}
      <label className="settings__pairing-label">
        {t("settings.machine.pair.uriLabel")}
        <textarea className="settings__pairing-uri" readOnly value={code} rows={3} />
      </label>
      <div className="settings__pairing-actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => setCopied(true));
          }}
        >
          {copied ? t("settings.machine.pair.copied") : t("settings.machine.pair.copy")}
        </button>
        <button type="button" className="button" onClick={props.onClose}>
          {t("settings.machine.pair.close")}
        </button>
      </div>
    </div>
  );
}
