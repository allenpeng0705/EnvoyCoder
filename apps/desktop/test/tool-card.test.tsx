/**
 * Typed tool cards — bucket presentation + generic fallback.
 */

/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToolCard } from "../src/components/tools/ToolCard.js";
import { I18nProvider } from "../src/i18n/context.js";

afterEach(() => cleanup());

describe("ToolCard", () => {
  it("renders a read card with path", () => {
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
