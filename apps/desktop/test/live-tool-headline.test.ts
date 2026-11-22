import { describe, expect, it } from "vitest";

import {
  focusLiveTool,
  liveToolHeadline,
  liveToolsHeadline,
} from "../src/composer/live-tool-headline.js";
import type { MessageKey } from "../src/i18n/messages/en.js";
import type { ToolEntry } from "../src/state/transcript.js";

const t = (key: MessageKey, values?: Record<string, string | number>): string => {
  const template: Record<string, string> = {
    "task.composer.working.editing": "Editing {path}",
    "task.composer.working.reading": "Reading {path}",
    "task.composer.working.searching": "Searching {query}",
    "task.composer.working.runningCmd": "Running {command}",
    "task.composer.working.using": "Using {name}",
  };
  let out = template[key] ?? key;
  if (values) {
    for (const [name, value] of Object.entries(values)) {
      out = out.replace(`{${name}}`, String(value));
    }
  }
  return out;
};

function tool(partial: Partial<ToolEntry> & Pick<ToolEntry, "id" | "name">): ToolEntry {
  return {
    kind: "tool",
    callId: partial.id,
    status: "running",
    ...partial,
  };
}

describe("liveToolHeadline", () => {
  it("prefers a running edit path", () => {
    expect(
      liveToolHeadline(
        tool({
          id: "1",
          name: "apply_patch",
          input: { path: "/Users/dev/work/apps/desktop/src/foo.ts" },
        }),
        t,
      ),
    ).toBe("Editing src/foo.ts");
  });

  it("surfaces a shell command", () => {
    expect(
      liveToolHeadline(
        tool({ id: "2", name: "bash", input: { command: "npm test -- --run" } }),
        t,
      ),
    ).toBe("Running npm test -- --run");
  });

  it("reads a file path as Reading", () => {
    expect(
      liveToolHeadline(
        tool({ id: "3", name: "read_file", input: { file_path: "README.md" } }),
        t,
      ),
    ).toBe("Reading README.md");
  });

  it("searches with a query", () => {
    expect(
      liveToolHeadline(
        tool({ id: "4", name: "grep", input: { pattern: "sendWhileRunning" } }),
        t,
      ),
    ).toBe("Searching sendWhileRunning");
  });

  it("falls back to the tool name", () => {
    expect(liveToolHeadline(tool({ id: "5", name: "web_fetch" }), t)).toBe("Using web_fetch");
  });
});

describe("liveToolsHeadline", () => {
  it("focuses the newest running tool over completed ones", () => {
    const headline = liveToolsHeadline(
      [
        tool({
          id: "a",
          name: "read_file",
          status: "completed",
          input: { path: "old.ts" },
        }),
        tool({
          id: "b",
          name: "bash",
          status: "running",
          input: { command: "cargo test" },
        }),
      ],
      t,
    );
    expect(headline).toBe("Running cargo test");
    expect(
      focusLiveTool([
        tool({ id: "a", name: "read_file", status: "completed" }),
        tool({ id: "b", name: "bash", status: "running" }),
      ])?.id,
    ).toBe("b");
  });
});
