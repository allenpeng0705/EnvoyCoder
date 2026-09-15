/**
 * **A command and the one control that makes it usable: Copy.**
 *
 * ## Why the word rather than a clipboard icon
 *
 * A row of this pane is read by scanning, and the thing being scanned is a sentence and a command. An icon
 * has to be recognised before it can be used; the word has to be read, which is what the user is already
 * doing. It also gives the control a visible label a voice-control user can say — and the accessible name
 * starts with it, which is what WCAG 2.5.3 (Label in Name) requires of a button whose label repeats down a
 * list.
 *
 * ## Copying is offered only where it can work
 *
 * `canCopyText()` decides whether this renders a button at all (see `clipboard.ts`): a machine with no
 * clipboard path gets the command and nothing else, rather than a control that cannot do anything. That is
 * the same rule the rest of this pane follows for a disabled control — and here the honest alternative is
 * free, because the command is selectable text either way.
 *
 * ## The confirmation, and what happens when the copy fails
 *
 * `Copied` for two seconds, then back to `Copy` — the family's own pattern (EnvoyMesh's Social app shows its
 * confirmation the same way). When the write reports failure the label says so instead: a checkmark over a
 * command that is not on the clipboard is the one outcome worth writing code to avoid. The change is mirrored
 * into a `role="status"` line for a screen reader, because a button whose own label changes is not reliably
 * announced.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { useI18n } from "../../i18n/context.js";
import { canCopyText, copyText } from "./clipboard.js";

/** How long the result stays on the button. Long enough to read, short enough not to become its label. */
const CONFIRM_MS = 2_000;

/**
 * One command line, with Copy beside it.
 *
 * `command` is rendered verbatim and is never translated — a translated `npm install -g …` is a command that
 * does not run, which `AvailabilityFix`'s own doc states for the wire and this component keeps for the DOM.
 */
export function CopyCommand(props: { command: string }): JSX.Element {
  const { t } = useI18n();
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The timer must not outlive the row: a disclosure closed a moment after a press would otherwise have a
  // pending `setState` on an unmounted component, and a row list is re-rendered on every probe answer.
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  const press = useCallback(() => {
    // Deliberately not awaited before the call: `copyText` runs its synchronous path inside this handler so
    // the user's click is still the gesture the clipboard write needs (see `clipboard.ts`).
    void copyText(props.command).then((ok) => {
      setResult(ok ? "copied" : "failed");
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(() => setResult("idle"), CONFIRM_MS);
    });
  }, [props.command]);

  const copyable = canCopyText();
  const label =
    result === "copied"
      ? t("settings.agents.fix.copied")
      : result === "failed"
        ? t("settings.agents.fix.failed")
        : t("settings.agents.fix.copy");

  return (
    <>
      <code className="settings__agent-command">{props.command}</code>
      {copyable ? (
        <button
          type="button"
          className={`button button--ghost button--small settings__agent-copy${
            result === "failed" ? " settings__agent-copy--failed" : ""
          }`}
          // The accessible name begins with the printed word and then names exactly what will be copied, so a
          // list of eight identical *Copy* buttons is navigable by voice and by a screen reader.
          aria-label={t("settings.agents.fix.copy.aria", { command: props.command })}
          onClick={press}
        >
          {label}
        </button>
      ) : null}
      <span className="visually-hidden" role="status">
        {result === "copied" ? t("settings.agents.fix.copied") : result === "failed" ? t("settings.agents.fix.failed") : ""}
      </span>
    </>
  );
}
