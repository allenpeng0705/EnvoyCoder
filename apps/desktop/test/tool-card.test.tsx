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
  it("renders a read card with path outside the head", () => {
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
    expect(screen.getByText("export function main() {}")).toBeTruthy();
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

  it("renders a shell card with command", () => {
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
  });
});
