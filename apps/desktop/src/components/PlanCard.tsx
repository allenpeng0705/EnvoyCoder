/**
 * ACP agent plan checklist — Cursor-style progress in the transcript.
 *
 * Entries update in place as the agent marks steps pending → in_progress → completed.
 * Not a modal; lives as a first-class transcript row outside Steps.
 */

import type { JSX } from "react";
import type { PlanEntry } from "@envoydev/protocol";

import { useT } from "../i18n/context.js";
import { MessageMarkdown } from "./markdown/MessageMarkdown.js";

export function PlanCard(props: {
  planId: string;
  entries: readonly PlanEntry[];
  markdown?: string;
}): JSX.Element {
  const t = useT();
  const { entries, markdown } = props;
  const done = entries.filter((entry) => entry.status === "completed").length;
  const total = entries.length;
  const complete = total > 0 && done === total;
  const headline =
    total === 0
      ? t("task.plan.title")
      : t("task.plan.progress", { done, total });

  return (
    <div
      className={`plan-card${complete ? " plan-card--complete" : ""}`}
      role="status"
      aria-label={headline}
      data-testid="plan-card"
    >
      <p className="plan-card__title">{headline}</p>
      {entries.length > 0 ? (
        <ol className="plan-card__list">
          {entries.map((entry, index) => (
            <li
              key={entry.id ?? `plan-step-${index}-${entry.content}`}
              className={`plan-card__item plan-card__item--${entry.status}`}
            >
              <span className="plan-card__mark" aria-hidden>
                {markFor(entry.status)}
              </span>
              <span className="plan-card__content">{entry.content}</span>
              {entry.priority === "high" ? (
                <span className="plan-card__priority">{t("task.plan.priority.high")}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {markdown !== undefined && markdown !== "" ? (
        <div className="plan-card__markdown row__markdown">
          <MessageMarkdown text={markdown} phase="complete" />
        </div>
      ) : null}
    </div>
  );
}

function markFor(status: PlanEntry["status"]): string {
  switch (status) {
    case "completed":
      return "✓";
    case "in_progress":
      return "●";
    case "cancelled":
      return "–";
    case "pending":
    default:
      return "○";
  }
}
