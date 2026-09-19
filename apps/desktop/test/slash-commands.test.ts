/**
 * The agent's slash-command list, parsed the way ACP publishes it.
 */

import { describe, expect, it } from "vitest";

import type { RunEvent } from "@envoydev/protocol";

import {
  filterSlashCommands,
  latestSlashCommands,
  slashCommandsFromAcp,
  slashQuery,
} from "../src/composer/slash-commands.js";

describe("slash commands", () => {
  it("keeps the agent's names and reads the hint from ACP's input field", () => {
    expect(
      slashCommandsFromAcp({
        availableCommands: [
          { name: "compact", description: "Summarize the conversation", input: { hint: "[focus]" } },
          { name: "/review", description: "Review the diff" },
          { name: "", description: "dropped" },
          { name: "compact", description: "duplicate" },
        ],
      }),
    ).toEqual([
      { name: "compact", description: "Summarize the conversation", argumentHint: "[focus]" },
      { name: "review", description: "Review the diff" },
    ]);
  });

  it("offers a menu only while the draft is a single leading slash token", () => {
    expect(slashQuery("")).toBeUndefined();
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/co")).toBe("co");
    expect(slashQuery("/compact ")).toBeUndefined();
    expect(slashQuery("please /compact")).toBeUndefined();
  });

  it("filters by name prefix and keeps the newest list", () => {
    const older: RunEvent = {
      runId: "r",
      taskId: "t",
      at: "2026-09-18T00:00:00.000Z",
      seq: 1,
      kind: "run.commands",
      commands: [{ name: "old", description: "" }],
    };
    const newer: RunEvent = {
      ...older,
      seq: 2,
      commands: [
        { name: "compact", description: "Summarize" },
        { name: "review", description: "Review" },
      ],
    };
    const commands = latestSlashCommands([older, newer]);
    expect(filterSlashCommands(commands, "c").map((command) => command.name)).toEqual(["compact"]);
    expect(filterSlashCommands(commands, "").map((command) => command.name)).toEqual(["compact", "review"]);
  });
});
