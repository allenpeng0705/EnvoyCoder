/**
 * Project agent change migrates idle tasks — so the rail and the pane never disagree.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import { CoderStore } from "../src/daemon/store.js";
import {
  applyHarnessSwitch,
  harnessSwitchPatch,
  taskMayFollowProjectHarness,
} from "../src/daemon/task-harness-switch.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function bench(): Promise<{ store: CoderStore; projectId: string }> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-project-agent-"));
  cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5 }));
  const store = await CoderStore.open({ paths: coderPaths(home) });
  const { project } = await store.addProject({ path: join(home, "repo") });
  return { store, projectId: project.id };
}

describe("harnessSwitchPatch", () => {
  it("clears an Envoy mode when switching to DeepSeek", () => {
    const patch = harnessSwitchPatch(
      { agentModeId: "plan", model: "anthropic/claude-sonnet-4-6", thinkingLevel: undefined },
      "deepseek-harness",
    );
    expect(patch.clearAgentMode).toBe(true);
    // provider/model free-text is still valid for DeepSeek — only the mode is stranded.
    expect(patch.clearModel).toBe(false);
    expect(patch.harness).toBe("deepseek-harness");
  });

  it("applies the project's preferred model when the stored one cannot follow", () => {
    const patch = harnessSwitchPatch(
      { agentModeId: undefined, model: "some-bare-id", thinkingLevel: undefined },
      "envoy-harness",
      "anthropic/claude-sonnet-4-6",
    );
    expect(patch.model).toBe("anthropic/claude-sonnet-4-6");
    expect(patch.clearModel).toBe(false);
  });

  it("skips active tasks for project migration", () => {
    expect(
      taskMayFollowProjectHarness({
        id: "t1",
        projectId: "p",
        cwd: "/tmp",
        title: "x",
        harness: "envoy-harness",
        status: "running",
        createdAt: "",
        updatedAt: "",
      }),
    ).toBe(false);
    expect(
      taskMayFollowProjectHarness({
        id: "t2",
        projectId: "p",
        cwd: "/tmp",
        title: "y",
        harness: "envoy-harness",
        status: "idle",
        createdAt: "",
        updatedAt: "",
      }),
    ).toBe(true);
  });
});

describe("updateProject migrates idle tasks onto the new agent", () => {
  it("rewrites idle Envoy tasks when the project becomes DeepSeek", async () => {
    const b = await bench();
    const idle = await b.store.createTask({
      projectId: b.projectId,
      title: "idle-one",
      harness: "envoy-harness",
      model: "anthropic/claude-sonnet-4-6",
    });
    expect(idle?.harness).toBe("envoy-harness");
    await b.store.updateTask({ id: idle!.id, agentModeId: "plan" });

    await b.store.setTaskRun(idle!.id, { status: "running", runId: "run-1" });
    const running = b.store.findTask(idle!.id)!;
    expect(running.status).toBe("running");

    const other = await b.store.createTask({
      projectId: b.projectId,
      title: "idle-two",
      harness: "envoy-harness",
      model: "openai/gpt-4o",
    });
    await b.store.updateTask({ id: other!.id, agentModeId: "review" });

    await b.store.updateProject(b.projectId, {
      defaults: { harness: "deepseek-harness", model: "deepseek/deepseek-chat" },
    });

    // Active run kept its harness.
    expect(b.store.findTask(idle!.id)?.harness).toBe("envoy-harness");
    expect(b.store.findTask(idle!.id)?.agentModeId).toBe("plan");

    // Idle task followed the project; Envoy mode dropped; provider/model free-text still valid for DeepSeek.
    const migrated = b.store.findTask(other!.id)!;
    expect(migrated.harness).toBe("deepseek-harness");
    expect(migrated.agentModeId).toBeUndefined();
    expect(migrated.model).toBe("openai/gpt-4o");
  });

  it("applyHarnessSwitch clears mode and applies preferred model when needed", () => {
    const task = {
      id: "t",
      projectId: "p",
      cwd: "/tmp",
      title: "x",
      harness: "deepseek-harness" as const,
      model: "bare-not-listed",
      agentModeId: undefined,
      status: "idle" as const,
      createdAt: "a",
      updatedAt: "a",
    };
    const next = applyHarnessSwitch(
      task,
      harnessSwitchPatch(task, "envoy-harness", "anthropic/claude-sonnet-4-6"),
      "b",
    );
    expect(next.harness).toBe("envoy-harness");
    expect(next.model).toBe("anthropic/claude-sonnet-4-6");
    expect(next.updatedAt).toBe("b");
  });
});
