/**
 * Typed tool cards — bucket presentation, edit diff summary, generic fallback.
 */

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  editDiffSummary,
  miniDiffLines,
  ToolCard,
} from "../src/components/tools/ToolCard.js";
import { I18nProvider } from "../src/i18n/context.js";

afterEach(() => cleanup());

describe("editDiffSummary", () => {
  it("counts old/new string lines", () => {
    expect(
      editDiffSummary({
        path: "/a.ts",
        old_string: "a\nb",
        new_string: "a\nb\nc",
      }),
    ).toBe("−2 / +3");
  });
});

describe("miniDiffLines", () => {
  it("caps removed and added lines", () => {
    const lines = miniDiffLines("a\nb\nc\nd\ne", "x\ny", 2);
    expect(lines.filter((l) => l.kind === "remove")).toHaveLength(2);
    expect(lines.some((l) => l.kind === "more" && l.direction === "removed" && l.count === 3)).toBe(
      true,
    );
    expect(lines.filter((l) => l.kind === "add")).toHaveLength(2);
  });

  it("strips a shared prefix and suffix so unchanged context is not fake ± noise", () => {
    const lines = miniDiffLines("keep\nold\nend", "keep\nnew\nend", 4);
    expect(lines.map((l) => ("text" in l ? `${l.kind}:${l.text}` : l.kind))).toEqual([
      "remove:old",
      "add:new",
    ]);
  });
});

describe("ToolCard", () => {
  it("keeps path on the head and hides output behind Details", () => {
    render(
      <I18nProvider preference="en">
        <ul>
          <ToolCard
            entry={{
              kind: "tool",
              id: "1",
              callId: "1",
              name: "Read",
              status: "completed",
              input: { path: "/work/api/src/main.ts" },
              output: "export function main() {}",
            }}
          />
        </ul>
      </I18nProvider>,
    );
    expect(screen.getByTestId("tool-card-searched")).toBeTruthy();
    expect(screen.getByText("/work/api/src/main.ts")).toBeTruthy();
    const details = screen.getByText("Details").closest("details");
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("export function main() {}");
  });

  it("renders an edit card with path, diff summary, and mini-diff", () => {
    render(
      <I18nProvider preference="en">
        <ul>
          <ToolCard
            entry={{
              kind: "tool",
              id: "3",
              callId: "3",
              name: "Edit",
              status: "completed",
              input: {
                path: "/work/api/src/main.ts",
                old_string: "const x = 1;",
                new_string: "const x = 2;\nconst y = 3;",
              },
            }}
          />
        </ul>
      </I18nProvider>,
    );
    expect(screen.getByTestId("tool-card-edited")).toBeTruthy();
    expect(screen.getByText("/work/api/src/main.ts")).toBeTruthy();
    expect(screen.getByText("−1 / +2")).toBeTruthy();
    const mini = screen.getByTestId("tool-card-mini-diff");
    expect(mini.textContent).toContain("const x = 1;");
    expect(mini.textContent).toContain("const y = 3;");
  });

  it("opens a path via onOpenPath (file for read, diff for edit)", () => {
    const onOpenPath = vi.fn();
    render(
      <I18nProvider preference="en">
        <ul>
          <ToolCard
            onOpenPath={onOpenPath}
            entry={{
              kind: "tool",
              id: "1",
              callId: "1",
              name: "Read",
              status: "completed",
              input: { path: "/work/api/src/main.ts" },
              output: "ok",
            }}
          />
          <ToolCard
            onOpenPath={onOpenPath}
            entry={{
              kind: "tool",
              id: "3",
              callId: "3",
              name: "Edit",
              status: "completed",
              input: {
                path: "/work/api/src/other.ts",
                old_string: "a",
                new_string: "b",
              },
            }}
          />
        </ul>
      </I18nProvider>,
    );
    const buttons = screen.getAllByTestId("tool-card-open-path");
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    expect(onOpenPath).toHaveBeenCalledWith("/work/api/src/main.ts", "file");
    expect(onOpenPath).toHaveBeenCalledWith("/work/api/src/other.ts", "diff");
  });

  it("renders a shell card with command on the head and output in Details", () => {
    render(
      <I18nProvider preference="en">
        <ul>
          <ToolCard
            entry={{
              kind: "tool",
              id: "2",
              callId: "2",
              name: "Bash",
              status: "completed",
              input: { command: "npm test" },
              output: "ok",
            }}
          />
        </ul>
      </I18nProvider>,
    );
    expect(screen.getByTestId("tool-card-ran")).toBeTruthy();
    expect(screen.getByText("npm test")).toBeTruthy();
    const details = screen.getByText("Details").closest("details");
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("ok");
  });

  it("opens Details while a top-level shell tool runs, then folds when it settles", () => {
    const { rerender } = render(
      <I18nProvider preference="en">
        <ul>
          <ToolCard
            entry={{
              kind: "tool",
              id: "4",
              callId: "4",
              name: "Bash",
              status: "running",
              input: { command: "npm test" },
              output: "…",
            }}
          />
        </ul>
      </I18nProvider>,
    );
    expect(screen.getByText("Details").closest("details")?.open).toBe(true);

    rerender(
      <I18nProvider preference="en">
        <ul>
          <ToolCard
            entry={{
              kind: "tool",
              id: "4",
              callId: "4",
              name: "Bash",
              status: "completed",
              input: { command: "npm test" },
              output: "ok",
            }}
          />
        </ul>
      </I18nProvider>,
    );
    expect(screen.getByText("Details").closest("details")?.open).toBe(false);
  });

  it("keeps Details closed for tools nested inside Steps", () => {
    render(
      <I18nProvider preference="en">
        <ul>
          <ToolCard
            nested
            entry={{
              kind: "tool",
              id: "5",
              callId: "5",
              name: "Bash",
              status: "running",
              input: { command: "npm test" },
              output: "…",
            }}
          />
        </ul>
      </I18nProvider>,
    );
    expect(screen.getByText("Details").closest("details")?.open).toBe(false);
  });
});
