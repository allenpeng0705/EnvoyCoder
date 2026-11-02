/**
 * Phase 1: host-inferred Reports from familiar run lifecycle signals.
 */

import type { WorkReport, WorkReportKind } from "./types.js";

export type RunLifecycleHint =
  | { kind: "run-started" }
  | { kind: "run-ended"; status: "done" | "failed" | "cancelled" }
  | { kind: "plan-review-ready" }
  | { kind: "plan-implement" }
  | { kind: "approval-blocked"; question?: string }
  | { kind: "approval-cleared" };

export function inferReportFromHint(
  hint: RunLifecycleHint,
  at = new Date().toISOString(),
): { report: WorkReport; attentionQuestion?: string } {
  let kind: WorkReportKind;
  let note: string | undefined;
  let attentionQuestion: string | undefined;

  switch (hint.kind) {
    case "run-started":
      kind = "progress";
      note = "Run started";
      break;
    case "run-ended":
      if (hint.status === "done") {
        kind = "waiting";
        note = "Run finished";
      } else {
        kind = "failed";
        note = hint.status === "cancelled" ? "Run cancelled" : "Run failed";
        attentionQuestion = note;
      }
      break;
    case "plan-review-ready":
      kind = "ready";
      note = "Plan ready for review";
      break;
    case "plan-implement":
      kind = "progress";
      note = "Implementing plan";
      break;
    case "approval-blocked":
      kind = "blocked";
      note = "Waiting on approval";
      attentionQuestion = hint.question ?? "The agent needs an approval.";
      break;
    case "approval-cleared":
      kind = "progress";
      note = "Approval answered";
      break;
  }

  return {
    report: {
      kind,
      ...(note !== undefined ? { note } : {}),
      at,
    },
    ...(attentionQuestion !== undefined ? { attentionQuestion } : {}),
  };
}
