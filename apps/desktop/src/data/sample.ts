/**
 * Fixtures for the scaffold.
 *
 * Deliberately covers **every** status and one remote host, because the states that break a
 * layout are the ones a happy-path fixture never shows: a failed run, a task waiting on an
 * answer, a task on another machine, and an empty project.
 */

import type { Project, Workspace } from "@envoycoder/protocol";

export const SAMPLE_PROJECTS: readonly Project[] = [
  {
    id: "local::/Users/dev/work/envoymesh",
    path: "/Users/dev/work/envoymesh",
    label: "envoymesh",
    hostId: "local",
    addedAt: "2026-09-01T09:00:00.000Z",
    defaults: { harness: "envoy-harness", model: "deepseek/deepseek-v4" },
    vcs: { kind: "git", branch: "encapsulation_refactoring" },
  },
  {
    id: "local::/Users/dev/work/payments-api",
    path: "/Users/dev/work/payments-api",
    label: "payments-api",
    hostId: "local",
    addedAt: "2026-09-05T11:30:00.000Z",
    defaults: { harness: "claudecode" },
    vcs: { kind: "git", branch: "main" },
  },
  {
    id: "workstation::/srv/site",
    path: "/srv/site",
    label: "site",
    hostId: "workstation",
    addedAt: "2026-09-09T08:15:00.000Z",
    defaults: { harness: "deepseek-harness" },
  },
];

export const SAMPLE_WORKSPACES: readonly Workspace[] = [
  {
    id: "w1",
    projectId: "local::/Users/dev/work/envoymesh",
    cwd: "/Users/dev/work/envoymesh",
    title: "Wire product attach into the new node service",
    harness: "envoy-harness",
    model: "deepseek/deepseek-v4",
    status: "running",
    createdAt: "2026-09-13T10:00:00.000Z",
    updatedAt: "2026-09-13T10:42:00.000Z",
    worktree: { path: "/Users/dev/work/envoymesh-wt/attach", branch: "feat/product-attach" },
  },
  {
    id: "w2",
    projectId: "local::/Users/dev/work/envoymesh",
    cwd: "/Users/dev/work/envoymesh",
    title: "Review the §5 migration diff",
    harness: "envoy-harness",
    status: "needs-attention",
    createdAt: "2026-09-13T09:10:00.000Z",
    updatedAt: "2026-09-13T10:38:00.000Z",
  },
  {
    id: "w3",
    projectId: "local::/Users/dev/work/payments-api",
    cwd: "/Users/dev/work/payments-api",
    title: "Add idempotency keys to the refund endpoint",
    harness: "claudecode",
    model: "anthropic/claude-sonnet-4.5",
    status: "failed",
    createdAt: "2026-09-12T16:00:00.000Z",
    updatedAt: "2026-09-12T16:31:00.000Z",
  },
  {
    id: "w4",
    projectId: "local::/Users/dev/work/payments-api",
    cwd: "/Users/dev/work/payments-api",
    title: "Bump the SDK and fix the type errors",
    harness: "claudecode",
    status: "done",
    createdAt: "2026-09-11T09:00:00.000Z",
    updatedAt: "2026-09-11T09:48:00.000Z",
  },
  {
    id: "w5",
    projectId: "workstation::/srv/site",
    cwd: "/srv/site",
    title: "Rebuild the marketing site on the workstation",
    harness: "deepseek-harness",
    status: "queued",
    hostId: "workstation",
    createdAt: "2026-09-13T10:30:00.000Z",
    updatedAt: "2026-09-13T10:30:00.000Z",
  },
];
