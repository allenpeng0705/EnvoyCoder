/**
 * Catalogue providers with audited session modes: resolve and refuse the way shipped harnesses do.
 */
import { describe, expect, it } from "vitest";

import { coderErrorCode, ENVOYDEV_ERRORS, type AgentProviderConfig } from "@envoydev/protocol";

import { resolveCataloguedProviderMode } from "../src/daemon/run-options.js";
import { summarizeProvider } from "../src/daemon/summaries.js";

function geminiProvider(over: Partial<AgentProviderConfig> = {}): AgentProviderConfig {
  return {
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    args: ["--acp"],
    env: [],
    transport: "acp",
    catalogEntryId: "gemini",
    ...over,
  };
}

describe("resolveCataloguedProviderMode", () => {
  it("accepts an audited mode id without a stored modeParam", () => {
    expect(resolveCataloguedProviderMode(geminiProvider(), "yolo")).toBe("yolo");
    expect(resolveCataloguedProviderMode(geminiProvider(), undefined)).toBeUndefined();
  });

  it("refuses an unknown mode id and a catalogue row with no modes", () => {
    try {
      resolveCataloguedProviderMode(geminiProvider(), "telepathy");
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(coderErrorCode(message)).toBe(ENVOYDEV_ERRORS.badRequest);
    }
    try {
      resolveCataloguedProviderMode(
        { id: "goose", label: "goose", transport: "acp", catalogEntryId: "goose" },
        "default",
      );
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(coderErrorCode(message)).toBe(ENVOYDEV_ERRORS.harnessUnsupported);
    }
  });
});

describe("summarizeProvider modes", () => {
  it("surfaces gemini modes from catalogue evidence even without stored modeParam", () => {
    const summary = summarizeProvider(
      geminiProvider(),
      (provider) => ({ id: provider.id, state: "ready", binaryPath: "/usr/bin/gemini" }),
      process.env,
    );
    expect(summary.agentMode).toBe(true);
    expect(summary.modes?.map((mode) => mode.id)).toEqual(["default", "auto_edit", "yolo"]);
  });

  it("keeps the mode picker off for catalogue rows without audited modes", () => {
    const summary = summarizeProvider(
      {
        id: "goose",
        label: "goose",
        command: "goose",
        args: ["acp"],
        env: [],
        transport: "acp",
        catalogEntryId: "goose",
      },
      (provider) => ({ id: provider.id, state: "ready", binaryPath: "/usr/bin/goose" }),
      process.env,
    );
    expect(summary.agentMode).toBeUndefined();
    expect(summary.modes).toBeUndefined();
  });

  it("does not invent modes from a bare provider id that collides with a catalogue entry", () => {
    const handTyped = {
      id: "gemini",
      label: "My custom gemini",
      command: "gemini",
      args: ["--acp"],
      env: [] as string[],
      transport: "acp" as const,
      // No catalogEntryId — hand-typed, not a catalogue Add.
    };
    const summary = summarizeProvider(
      handTyped,
      (provider) => ({ id: provider.id, state: "ready", binaryPath: "/usr/bin/gemini" }),
      process.env,
    );
    expect(summary.agentMode).toBeUndefined();
    expect(summary.modes).toBeUndefined();
    try {
      resolveCataloguedProviderMode(handTyped, "yolo");
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(coderErrorCode(message)).toBe(ENVOYDEV_ERRORS.harnessUnsupported);
    }
  });
});
