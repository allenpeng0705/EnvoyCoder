/**
 * How a card is answered, once the daemon has said which kind of answer it is.
 *
 * One exclusive choice is a button: that is a permission, or a question with a single pick.
 * Several choices are checkboxes plus Confirm. A typed answer is a field plus Confirm.
 * The labels are the agent's own words, except the Confirm button, which is ours.
 *
 * When the live agent is a shipped policy wire (`askingControl === "policy"`), exclusive
 * permission cards also offer "Allow and don't ask again" — flips Settings and the live session.
 */

import { useState, type JSX } from "react";

import { useT } from "../i18n/context.js";
import { localizeText } from "../i18n/notice.js";
import type { TranscriptEntry } from "../state/transcript.js";

type ApprovalEntry = Extract<TranscriptEntry, { kind: "approval" }>;
type Answer = (
  requestId: string,
  choice: string | readonly string[] | { text: string },
  options?: { stopAsking?: boolean },
) => void | Promise<void>;

export function ApprovalChoices(props: {
  entry: ApprovalEntry;
  onAnswer: Answer;
  /** Envoy Harness (catalogue policy wire) — show stop-asking. */
  canStopAsking?: boolean;
}): JSX.Element {
  const t = useT();
  const { entry } = props;
  const chosen = entry.resolvedWithIds ?? (entry.resolvedWith !== undefined ? [entry.resolvedWith] : undefined);

  if (chosen !== undefined) {
    const labels = chosen.map((id) => entry.options.find((option) => option.id === id)?.label ?? id);
    return (
      <span className="approval__resolved">
        {t("task.approval.answeredWith", { option: labels.join(", ") })}
      </span>
    );
  }

  if (entry.selection === "many") return <ManyChoices entry={entry} onAnswer={props.onAnswer} />;
  if (entry.selection === "text") return <TextAnswer entry={entry} onAnswer={props.onAnswer} />;

  // Prefer an explicit allow id when several non-destructive options exist (Allow once vs Always).
  const allowId = stopAskingAllowId(entry.options);
  const stopAsking = props.canStopAsking === true && allowId !== undefined;

  return (
    <div className="approval__choice-stack">
      <div className="approval__choice-row">
        {entry.options.flatMap((option) => {
          const choice = (
            <button
              key={option.id}
              type="button"
              className={`button ${option.destructive ? "button--danger" : "button--primary"}`}
              onClick={() => void props.onAnswer(entry.requestId, option.id)}
            >
              {localizeText(t, option.label) ?? option.label}
            </button>
          );
          // Allow → don't ask again → Deny: one row, permanent allow next to Allow.
          if (stopAsking && option.id === allowId) {
            return [
              choice,
              <button
                key="stop-asking"
                type="button"
                className="button button--secondary approval__stop-asking"
                data-testid="approval-stop-asking"
                onClick={() => void props.onAnswer(entry.requestId, allowId, { stopAsking: true })}
              >
                {t("task.approval.stopAsking")}
              </button>,
            ];
          }
          return [choice];
        })}
      </div>
      {stopAsking ? (
        <p className="approval__hint" data-testid="approval-settings-hint">
          {t("task.approval.settingsHint")}
        </p>
      ) : null}
    </div>
  );
}

/** Option id stop-asking should send — same idea as the daemon's allowChoiceId, on card options. */
function stopAskingAllowId(
  options: readonly { id: string; destructive?: boolean }[],
): string | undefined {
  const allows = options.filter((option) => option.destructive !== true);
  if (allows.length === 0) return undefined;
  const preferred = allows.find((option) => {
    const id = option.id.toLowerCase().replace(/_/g, "-");
    return id === "allow" || id === "allow-once" || id === "allow-always" || id.startsWith("allow-");
  });
  return preferred?.id ?? allows[0]?.id;
}

function ManyChoices(props: { entry: ApprovalEntry; onAnswer: Answer }): JSX.Element {
  const t = useT();
  const [picked, setPicked] = useState<readonly string[]>([]);
  const toggle = (id: string): void => {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  return (
    <div className="approval__choices">
      {props.entry.options.map((option) => (
        <label key={option.id} className="approval__choice">
          <input
            type="checkbox"
            checked={picked.includes(option.id)}
            onChange={() => toggle(option.id)}
          />
          <span>{localizeText(t, option.label) ?? option.label}</span>
        </label>
      ))}
      <button
        type="button"
        className="button button--primary"
        disabled={picked.length === 0}
        onClick={() => void props.onAnswer(props.entry.requestId, picked)}
      >
        {t("task.approval.confirm")}
      </button>
    </div>
  );
}

function TextAnswer(props: { entry: ApprovalEntry; onAnswer: Answer }): JSX.Element {
  const t = useT();
  const [text, setText] = useState("");
  const value = text.trim();

  return (
    <form
      className="approval__choices"
      onSubmit={(event) => {
        event.preventDefault();
        if (value === "") return;
        void props.onAnswer(props.entry.requestId, { text: value });
      }}
    >
      <textarea
        className="approval__text"
        rows={4}
        value={text}
        aria-label={t("task.approval.aria")}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className="button button--primary" disabled={value === ""}>
        {t("task.approval.confirm")}
      </button>
    </form>
  );
}
