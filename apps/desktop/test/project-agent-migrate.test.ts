/**
 * The project agent is the default for *new* tasks. Changing it does not rewrite tasks that
 * already exist — two tasks in one project can run different agents in parallel.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import { CoderStore } from "../src/daemon/store.js";
import { applyHarnessSwitch, harnessSwitchPatch } from "../src/daemon/task-harness-switch.js";

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
  it("clears an Envoy mode and model when switching to DeepSeek", () => {
    const patch = harnessSwitchPatch(
      { agentModeId: "plan", model: "anthropic/claude-sonnet-4-6", thinkingLevel: undefined },
      "deepseek-harness",
    );
    expect(patch.clearAgentMode).toBe(true);
    // Free-text agents accept any provider/model shape, so the previous agent's model must not follow.
    expect(patch.clearModel).toBe(true);
    expect(patch.model).toBeUndefined();
    expect(patch.harness).toBe("deepseek-harness");
  });

  it("clears a Mobile / Web domain preset when leaving envoy-harness", () => {
    const patch = harnessSwitchPatch(
      {
        agentModeId: undefined,
        model: undefined,
        thinkingLevel: undefined,
        domainPreset: "mobile",
      },
      "deepseek-harness",
    );
    expect(patch.clearDomainPreset).toBe(true);
    const kept = harnessSwitchPatch(
      {
        agentModeId: undefined,
        model: undefined,
        thinkingLevel: undefined,
        domainPreset: "webdev",
      },
      "envoy-harness",
    );
    expect(kept.clearDomainPreset).toBe(false);
    const applied = applyHarnessSwitch(
      {
        id: "t",
        projectId: "p",
        cwd: "/tmp",
        title: "x",
        harness: "envoy-harness",
        domainPreset: "mobile",
        status: "idle",
        createdAt: "a",
        updatedAt: "a",
      },
      patch,
      "b",
    );
    expect(applied.domainPreset).toBeUndefined();
  });

  it("does not carry Envoy LLM MiniMax onto DeepSeek", () => {
    const patch = harnessSwitchPatch(
      { agentModeId: undefined, model: "openai/MiniMax-M3", thinkingLevel: undefined },
      "deepseek-harness",
    );
    expect(patch.clearModel).toBe(true);
    expect(patch.model).toBeUndefined();
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

describe("updateProject does not rewrite existing tasks", () => {
  it("leaves idle and running tasks on the agent they already stored", async () => {
    const b = await bench();
    const running = await b.store.createTask({
      projectId: b.projectId,
      title: "running-one",
      harness: "envoy-harness",
      model: "anthropic/claude-sonnet-4-6",
    });
    await b.store.updateTask({ id: running!.id, agentModeId: "plan" });
    await b.store.setTaskRun(running!.id, { status: "running", runId: "run-1" });

    const idle = await b.store.createTask({
      projectId: b.projectId,
      title: "idle-two",
      harness: "envoy-harness",
      model: "openai/gpt-4o",
    });
    await b.store.updateTask({ id: idle!.id, agentModeId: "review" });

    await b.store.updateProject(b.projectId, {
      defaults: { harness: "deepseek-harness", model: "deepseek/deepseek-chat" },
    });

    expect(b.store.findTask(running!.id)?.harness).toBe("envoy-harness");
    expect(b.store.findTask(running!.id)?.agentModeId).toBe("plan");
    expect(b.store.findTask(idle!.id)?.harness).toBe("envoy-harness");
    expect(b.store.findTask(idle!.id)?.agentModeId).toBe("review");
    expect(b.store.findTask(idle!.id)?.model).toBe("openai/gpt-4o");
  });

  it("does not move a task onto the project's agent when its run ends", async () => {
    const b = await bench();
    const task = await b.store.createTask({
      projectId: b.projectId,
      title: "was-running",
      harness: "envoy-harness",
    });
    await b.store.setTaskRun(task!.id, { status: "running", runId: "run-1" });

    await b.store.updateProject(b.projectId, { defaults: { harness: "deepseek-harness" } });
    expect(b.store.findTask(task!.id)?.harness).toBe("envoy-harness");

    await b.store.setTaskRun(task!.id, { status: "done" });
    expect(b.store.findTask(task!.id)?.harness).toBe("envoy-harness");
  });

  it("leaves a task that chose its own agent, and another project's tasks, alone", async () => {
    const b = await bench();
    const own = await b.store.createTask({
      projectId: b.projectId,
      title: "picked-its-own-agent",
      harness: "claudecode",
    });
    const already = await b.store.createTask({
      projectId: b.projectId,
      title: "already-on-deepseek",
      harness: "deepseek-harness",
    });

    const otherProject = (await b.store.addProject({ path: "/some/other/repo" })).project;
    const elsewhere = await b.store.createTask({
      projectId: otherProject.id,
      title: "other-project",
      harness: "envoy-harness",
    });

    await b.store.updateProject(b.projectId, { defaults: { harness: "deepseek-harness" } });

    expect(b.store.findTask(own!.id)?.harness).toBe("claudecode");
    expect(b.store.findTask(already!.id)?.harness).toBe("deepseek-harness");
    expect(b.store.findTask(elsewhere!.id)?.harness).toBe("envoy-harness");
  });

  it("a task created with no explicit agent still resolves the current project default", async () => {
    const b = await bench();
    await b.store.updateProject(b.projectId, { defaults: { harness: "deepseek-harness" } });

    const task = await b.store.createTask({ projectId: b.projectId, title: "inherits-the-project-agent" });
    expect(task?.harness).toBe("deepseek-harness");

    // A later project change is only for the *next* create, not this task.
    await b.store.updateProject(b.projectId, { defaults: { harness: "envoy-harness" } });
    expect(b.store.findTask(task!.id)?.harness).toBe("deepseek-harness");

    const next = await b.store.createTask({ projectId: b.projectId, title: "starts-on-the-new-default" });
    expect(next?.harness).toBe("envoy-harness");
  });
});
