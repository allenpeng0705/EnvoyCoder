/**
 * Typed tool cards — bucket presentation, edit diff summary, generic fallback.
 */

/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { editDiffSummary, ToolCard } from "../src/components/tools/ToolCard.js";
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

  it("renders an edit card with path and diff summary", () => {
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

  it("opens Details when a shell tool starts running, without forcing it closed later", () => {
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
    const details = screen.getByText("Details").closest("details");
    expect(details?.open).toBe(true);

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
    // One-shot open: finishing the tool must not slam Details shut.
    expect(screen.getByText("Details").closest("details")?.open).toBe(true);
  });
});
