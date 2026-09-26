/**
 * Start a real harness run for an accepted JobStep.
 *
 * Creates (or reuses) a project+task at the resolved cwd so RunManager's
 * existing path stays intact — jobs do not invent a second run substrate.
 */

import type { StepOffer } from "@envoydev/protocol";

import type { CoderStore } from "./store.js";
import type { RunManager } from "./runs.js";

export async function ensureJobStepTask(
  store: CoderStore,
  input: { cwd: string; title: string; projectId?: string; brief: string },
): Promise<{ taskId: string }> {
  let projectId = input.projectId;
  if (projectId) {
    const project = store.findProject(projectId);
    if (!project) projectId = undefined;
  }
  if (!projectId) {
    const existing = store.projects().find((p) => p.path === input.cwd);
    if (existing) {
      projectId = existing.id;
    } else {
      const added = await store.addProject({
        path: input.cwd,
        label: input.title.slice(0, 80) || "Job work",
      });
      projectId = added.project.id;
    }
  }
  const task = await store.createTask({
    projectId,
    title: input.title.slice(0, 120) || "Job step",
    cwd: input.cwd,
  });
  if (!task) {
    throw new Error("Could not create a task for this job step.");
  }
  return { taskId: task.id };
}

export async function startRunForOffer(
  deps: { store: CoderStore; runs: RunManager },
  offer: StepOffer,
  resolvedCwd: string,
  projectId?: string,
): Promise<{ runId: string; taskId: string }> {
  const { taskId } = await ensureJobStepTask(deps.store, {
    cwd: resolvedCwd,
    title: `${offer.role}: ${offer.brief.slice(0, 80)}`,
    ...(projectId ? { projectId } : {}),
    brief: offer.brief,
  });
  const run = await deps.runs.start({
    taskId,
    prompt: offer.brief,
  });
  return { runId: run.id, taskId };
}
