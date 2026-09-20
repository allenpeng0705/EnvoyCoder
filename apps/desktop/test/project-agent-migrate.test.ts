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

  it("moves a task onto the project's agent once the run it was waiting for ends", async () => {
    // The gap this closes: a run in flight cannot change agent, so `updateProject` skipped the task —
    // and nothing ever came back for it. The project said one agent and the task kept another until
    // somebody changed the project again.
    const b = await bench();
    const task = await b.store.createTask({
      projectId: b.projectId,
      title: "was-running",
      harness: "envoy-harness",
    });
    await b.store.setTaskRun(task!.id, { status: "running", runId: "run-1" });

    await b.store.updateProject(b.projectId, { defaults: { harness: "deepseek-harness" } });
    // Still on the agent it was launched with: the live process is the reason.
    expect(b.store.findTask(task!.id)?.harness).toBe("envoy-harness");

    // And the moment the run stops, the project governs.
    await b.store.setTaskRun(task!.id, { status: "done" });
    await b.store.followProjectHarness(task!.id);
    expect(b.store.findTask(task!.id)?.harness).toBe("deepseek-harness");
  });

  it("leaves a task alone when no project change was waiting on its run", async () => {
    // A task created with an explicit harness (the wire still allows one) is not overwritten merely
    // because a run ended: only a project change can say a divergent harness was meant to follow.
    const b = await bench();
    const task = await b.store.createTask({
      projectId: b.projectId,
      title: "chose-its-own",
      harness: "claudecode",
    });
    await b.store.setTaskRun(task!.id, { status: "running", runId: "run-1" });
    await b.store.setTaskRun(task!.id, { status: "done" });

    await b.store.followProjectHarness(task!.id);
    expect(b.store.findTask(task!.id)?.harness).toBe("claudecode");
  });

  it("does not resurrect an archived task to follow the project", async () => {
    const b = await bench();
    const task = await b.store.createTask({
      projectId: b.projectId,
      title: "archived-mid-run",
      harness: "envoy-harness",
    });
    await b.store.setTaskRun(task!.id, { status: "running", runId: "run-1" });
    await b.store.updateProject(b.projectId, { defaults: { harness: "deepseek-harness" } });
    await b.store.archiveTask(task!.id, true);

    await b.store.followProjectHarness(task!.id);
    expect(b.store.findTask(task!.id)?.harness).toBe("envoy-harness");
  });

  it("moves a task that had chosen its own agent, and leaves another project's tasks alone", async () => {
    const b = await bench();
    // A task created through the old mobile Agent chip carried its own harness. The owner's rule is
    // that the agent is the project's, so the project's change must reach it too — this is the half
    // that "copy the project's value at creation" would silently miss.
    const legacy = await b.store.createTask({
      projectId: b.projectId,
      title: "picked-its-own-agent",
      harness: "claudecode",
    });
    expect(legacy?.harness).toBe("claudecode");

    const alreadyMoved = await b.store.createTask({
      projectId: b.projectId,
      title: "already-on-the-new-agent",
      harness: "deepseek-harness",
    });

    // The scope is the project: a task registered elsewhere keeps its agent.
    const otherProject = (await b.store.addProject({ path: "/some/other/repo" })).project;
    const elsewhere = await b.store.createTask({
      projectId: otherProject.id,
      title: "other-project",
      harness: "envoy-harness",
    });

    await b.store.updateProject(b.projectId, { defaults: { harness: "deepseek-harness" } });

    expect(b.store.findTask(legacy!.id)?.harness).toBe("deepseek-harness");
    expect(b.store.findTask(alreadyMoved!.id)?.harness).toBe("deepseek-harness");
    expect(b.store.findTask(elsewhere!.id)?.harness).toBe("envoy-harness");
  });

  it("a task created with no explicit agent resolves the project's, and later follows a change", async () => {
    const b = await bench();
    await b.store.updateProject(b.projectId, { defaults: { harness: "deepseek-harness" } });

    // This is exactly what the mobile new-task sheet now sends: `projectId` and `title`, no `harness`.
    // The agent comes from the project, which is the only place it is chosen.
    const task = await b.store.createTask({ projectId: b.projectId, title: "inherits-the-project-agent" });
    expect(task?.harness).toBe("deepseek-harness");

    // And a later project change reaches the task that already exists.
    await b.store.updateProject(b.projectId, { defaults: { harness: "envoy-harness" } });
    expect(b.store.findTask(task!.id)?.harness).toBe("envoy-harness");
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
