/**
 * The model control — **one component, because the same three facts are on three surfaces.**
 *
 * A model can be chosen in the composer (for a task) and in settings (for the app's defaults, and for a
 * project's). All three ask one question and must answer it identically: *which shape is this control?*
 *
 *   * **`"listed"`** — the agent publishes what it accepts, so it is a `<select>`, with "the agent's own
 *     default" first because that is the state before anybody chooses and the only way to undo a choice.
 *   * **`"free-text"`** — the agent takes a model and publishes no list we can read before a session
 *     exists (`deepseek-harness`). This is a **working text field**, and pretending otherwise would
 *     disable a feature the agent supports.
 *   * **`"none"`** — the agent takes no model. A disabled picker, with the reason underneath.
 *
 * `kind` is carried rather than inferred from `options.length`, and that is the whole point of the
 * shape: `options.length === 0` is *also* true for `"free-text"`, which works.
 *
 * ## Why the draft state lives here
 *
 * A text field has to hold what the user is *typing*, which is not yet a model and must not be saved as
 * one: committing `deepseek` on the way to `deepseek/deepseek-chat` would store a value that makes the
 * next run refuse. So this component keeps the draft and hands a value upwards only when it names both
 * halves (`looksLikeModelValue`) — or when the field is emptied, which is a real choice meaning "the
 * agent's own default". Enter and blur both commit: a value typed and then clicked away from is still a
 * value the user meant.
 *
 * The `labelId` is passed in rather than generated, so the visible `<label>` the caller already draws is
 * the control's accessible name — one label on screen and one announced, which cannot drift.
 */

import { useEffect, useState, type JSX } from "react";

import {
  looksLikeModelValue,
  type ComposerModel,
  type ModelOffReason,
} from "../composer/controls.js";
import { useI18n } from "../i18n/context.js";

export interface ModelChoiceProps {
  /**
   * The id of the visible label element — **or, on a surface with no room for one, `ariaLabel`.**
   *
   * Exactly one of the two, and the pair exists because the two surfaces differ: the settings pane draws a title
   * beside the control, so the name is `aria-labelledby` pointing at it (one name on screen and one announced);
   * the composer's toolbar is chips with no labels at all, so there the control is named directly. A control with
   * neither is a control a screen reader reads as "combobox".
   */
  labelId?: string;
  ariaLabel?: string;
  kind: "listed" | "free-text" | "none";
  options: readonly ComposerModel[];
  /** The stored value, provider-qualified. `undefined` means "the agent's own default". */
  selected: string | undefined;
  /** Why the control is off — `undefined` means it works. */
  off: ModelOffReason | undefined;
  /** The control's tooltip, which says *which* model this is when it is not a refusal. */
  title: string;
  /**
   * The id of a paragraph that explains **why this control is off**, when it is.
   *
   * `aria-describedby` rather than a second sentence on screen: the composer draws the reason as
   * `visually-hidden` text so a screen reader reaches it, and the tooltip carries the same sentence for a
   * pointer. See `ComposerControls`' notes rule for why the reason is attached to the control instead of
   * sitting under the row — the settings pane, which is read rather than used, still puts it on the page.
   */
  descriptionId?: string;
  /** Where `""` travels: "the agent's own default", on the same terms as the composer's control. */
  onChoose: (id: string) => void;
  /** Only the input's own class differs between surfaces; the shape does not. */
  inputClassName?: string;
  /**
   * The `select`'s class, for the surface that draws the picker as a **toolbar chip** rather than a form field.
   *
   * The composer's row is a toolbar (icons and values, no labels, no boxes), and the settings pane's row is a
   * form — the same control, two skins, and one place that decides how a model is chosen. Defaults to the
   * form's `.select`, so a caller that says nothing gets the settings look.
   */
  fieldClassName?: string;
  /**
   * When true, free-text commits any non-empty model id (Claude / Codex / Cursor bare ACP values).
   * When false or omitted, the field still requires `provider/model` (DeepSeek).
   */
  bareId?: boolean;
  /**
   * When false, the empty "agent default" option is omitted. Envoy Harness has no default model.
   */
  allowUnset?: boolean;
}

export function ModelChoice(props: ModelChoiceProps): JSX.Element {
  const { t } = useI18n();

  const [draft, setDraft] = useState(props.selected ?? "");
  useEffect(() => {
    setDraft(props.selected ?? "");
  }, [props.selected]);

  const commit = (): void => {
    const value = draft.trim();
    // Empty is a real choice — "the agent's own default" — and the only way to undo a model without
    // replacing it with another. A half-written value is neither, and is left in the field.
    if (value === "") {
      if (props.selected !== undefined) props.onChoose("");
      return;
    }
    // The predicate `composer/controls.ts` exports and a test pins, rather than a second copy here: the
    // rule for "this names a model this agent can take" has to be one rule.
    if (looksLikeModelValue(value, { bareId: props.bareId === true }) && value !== props.selected) {
      props.onChoose(value);
    }
  };

  if (props.kind === "free-text") {
    return (
      <input
        type="text"
        className={props.inputClassName ?? "input"}
        // The visible span labels both shapes, exactly as it does for a `<select>`: `aria-labelledby`
        // rather than a second `aria-label`, so the name a screen reader announces and the one on screen
        // cannot drift apart.
        {...(props.labelId !== undefined ? { "aria-labelledby": props.labelId } : {})}
        {...(props.ariaLabel !== undefined ? { "aria-label": props.ariaLabel } : {})}
        {...(props.descriptionId !== undefined ? { "aria-describedby": props.descriptionId } : {})}
        disabled={props.off !== undefined}
        placeholder={
          props.bareId === true
            ? t("task.composer.model.placeholderBare")
            : t("task.composer.model.placeholder")
        }
        {...(props.title !== "" ? { title: props.title } : {})}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    );
  }

  return (
    <select
      className={props.fieldClassName ?? "select"}
      // Enabled only when the wire said the daemon can put this agent on a chosen model. An agent that
      // publishes models it cannot be *set* to keeps the control visible and disabled, with the reason
      // on the next line.
      disabled={props.off !== undefined}
      {...(props.labelId !== undefined ? { "aria-labelledby": props.labelId } : {})}
      {...(props.ariaLabel !== undefined ? { "aria-label": props.ariaLabel } : {})}
      {...(props.descriptionId !== undefined ? { "aria-describedby": props.descriptionId } : {})}
      {...(props.title !== "" ? { title: props.title } : {})}
      value={props.selected ?? ""}
      onChange={(event) => props.onChoose(event.target.value)}
    >
      {/* Other agents can leave the model unset and use their own default. Envoy Harness cannot:
          with no model it does not call the LLM saved in Settings. */}
      {props.allowUnset === false ? null : (
        <option value="" title={t("task.composer.model.agentDefault")}>
          {t("task.composer.value.default")}
        </option>
      )}
      {props.options.map((model) => (
        <option key={model.id} value={model.id} title={model.description}>
          {model.label}
        </option>
      ))}
    </select>
  );
}
