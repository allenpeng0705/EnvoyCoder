/**
 * Work items that need a person — sidebar attention block.
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";

import type { WorkStage, WorkTicket } from "@envoydev/work-model";
import { ticketStage } from "@envoydev/work-model";

import { useI18n } from "../i18n/context.js";
import { localize } from "../i18n/notice.js";
import type { MessageKey } from "../i18n/messages/en.js";
import type { AgentActions } from "../state/agent-actions.js";
import { showShellToast } from "../state/shell-toast.js";

const STAGE_LABEL: Record<WorkStage, MessageKey | undefined> = {
  "person/delivery": "work.attention.stage.delivery",
  "person/answer": "work.attention.stage.answer",
  "person/review": "work.attention.stage.review",
  "person/blocked": "work.attention.stage.blocked",
  "working/queued": undefined,
  idle: undefined,
  working: undefined,
};

export interface WorkAttentionProps {
  agents: AgentActions;
  workRevision?: number;
  onOpenTask?: (taskId: string) => void;
}

export function WorkAttention(props: WorkAttentionProps): ReactElement | null {
  const { t } = useI18n();
  const [tickets, setTickets] = useState<readonly WorkTicket[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const listed = await props.agents.listWorkAttention();
    if (listed.ok) setTickets(listed.tickets);
  }, [props.agents]);

  useEffect(() => {
    void refresh();
  }, [refresh, props.workRevision ?? 0]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (tickets.length === 0) return null;

  return (
    <section className="sidebar__work-attention" data-testid="work-attention" aria-label={t("work.attention.aria")}>
      <div className="sidebar__work-attention-heading">{t("work.attention.heading")}</div>
      <ul className="sidebar__work-attention-list">
        {tickets.map((ticket) => {
          const wireStage =
            "stage" in ticket && typeof (ticket as { stage?: string }).stage === "string"
              ? (ticket as { stage: string }).stage
              : undefined;
          const stage = wireStage ?? ticketStage(ticket);
          const labelKey = STAGE_LABEL[stage as WorkStage];
          const needsAnswer = stage === "person/answer";
          return (
            <li key={ticket.id} className="sidebar__work-attention-item">
              <div className="sidebar__work-attention-title">{ticket.title}</div>
              {labelKey !== undefined ? (
                <div className="sidebar__work-attention-stage">{t(labelKey)}</div>
              ) : null}
              {ticket.attention?.question ? (
                <p className="sidebar__work-attention-question">{ticket.attention.question}</p>
              ) : ticket.latestReport?.note ? (
                <p className="sidebar__work-attention-question">{ticket.latestReport.note}</p>
              ) : null}
              {needsAnswer ? (
                <div className="sidebar__work-attention-answer">
                  <input
                    className="input"
                    type="text"
                    value={answers[ticket.id] ?? ""}
                    aria-label={t("work.attention.answer.placeholder")}
                    placeholder={t("work.attention.answer.placeholder")}
                    onChange={(event) =>
                      setAnswers((prev) => ({ ...prev, [ticket.id]: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => {
                      const text = (answers[ticket.id] ?? "").trim();
                      if (!text) return;
                      void props.agents.answerWorkAttention(ticket.id, text).then((r) => {
                        if (r.ok) {
                          setAnswers((prev) => {
                            const next = { ...prev };
                            delete next[ticket.id];
                            return next;
                          });
                          void refresh();
                          return;
                        }
                        showShellToast(localize(t, r) ?? r.message, { tone: "error" });
                        void refresh();
                      });
                    }}
                  >
                    {t("work.attention.answer.send")}
                  </button>
                </div>
              ) : null}
              <div className="sidebar__work-attention-actions">
                {ticket.taskId && props.onOpenTask ? (
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => props.onOpenTask!(ticket.taskId!)}
                  >
                    {t("work.attention.openTask")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() =>
                    void props.agents.retryWorkTicket(ticket.id).then((r) => {
                      if (r.ok) void refresh();
                    })
                  }
                >
                  {t("work.attention.retry")}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() =>
                    void props.agents.stopWorkTicket(ticket.id).then((r) => {
                      if (r.ok) void refresh();
                    })
                  }
                >
                  {t("work.attention.stop")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
