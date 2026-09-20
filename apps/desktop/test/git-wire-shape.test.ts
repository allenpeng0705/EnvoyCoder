/**
 * **Every git answer matches its own wire spec** — the half of the contract nothing else checks.
 *
 * `parseRpcParams` validates what a client *sends*, and `wire-agreement.test.ts` proves a method has a spec.
 * Neither parses what a handler **answers**, so a result spec is a document until something reads a real answer
 * with it: a field renamed on one side, a new field a `.strict()` schema rejects, or a union whose second
 * member never fires would all ship silently. This file drives the real handler table over a real repository
 * and parses each result with `RPC_SPECS[method].result`, then asserts that **every** `coder.git*` method was
 * covered — so a method added later cannot quietly opt out.
 *
 * @vitest-environment node
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";
import { RPC_SPECS, type RpcMethod } from "@envoydev/protocol";

import { createGitHandlers } from "../src/daemon/git.js";
import { CoderStore } from "../src/daemon/store.js";
import type { CoderHandler } from "../src/daemon/service.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(root: string, args: readonly string[]): void {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "envoydev-shape-"));
  roots.push(root);
  run(root, ["init", "-q"]);
  run(root, ["config", "user.email", "t@t"]);
  run(root, ["config", "user.name", "T"]);
  writeFileSync(join(root, "a.txt"), "one\n");
  run(root, ["add", "."]);
  run(root, ["commit", "-qm", "one"]);
  run(root, ["branch", "-m", "main"]);
  run(root, ["checkout", "-qb", "work"]);
  // An upstream, so `gitPull` answers instead of refusing for want of one.
  const bare = `${root}-origin.git`;
  roots.push(bare);
  spawnSync("git", ["init", "--bare", "-q", bare], { encoding: "utf8" });
  run(root, ["remote", "add", "origin", bare]);
  run(root, ["push", "-q", "-u", "origin", "work"]);
  return root;
}

const shapes: { method: RpcMethod; answer: unknown }[] = [];

describe("the wire shape of every git answer", () => {
  it("parses with RPC_SPECS[method].result", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-shape-home-"));
    roots.push(home);
    const store = await CoderStore.open({ paths: coderPaths(home) });
    const repo = repository();
    const project = await store.addProject({ path: repo, vcs: { kind: "git" } });
    const id = project.project.id;
    const handlers = createGitHandlers({
      store,
      runs: {
        liveFor: () => undefined,
        // A run object the *wire* accepts, so the resolve path's shape can be checked whole.
        start: (async (input: { taskId: string }) => ({
          id: "r-1",
          taskId: input.taskId,
          harness: "envoy-harness",
          hostId: "local",
          startedAt: new Date().toISOString(),
          status: "running",
        })) as never,
      },
    }) as Record<string, CoderHandler>;
    const call = async (method: RpcMethod, params: Record<string, unknown> = {}): Promise<void> => {
      const answer = await handlers[method]?.(params, { session: undefined });
      shapes.push({ method, answer });
    };

    // reads
    await call("coder.gitStatus", { projectId: id });
    await call("coder.gitBranches", { projectId: id });
    await call("coder.gitStashList", { projectId: id });
    // staging and commit
    writeFileSync(join(repo, "a.txt"), "two\n");
    await call("coder.gitStage", { projectId: id, paths: ["a.txt"] });
    await call("coder.gitUnstage", { projectId: id, paths: ["a.txt"] });
    await call("coder.gitStage", { projectId: id, paths: ["a.txt"] });
    await call("coder.gitCommit", { projectId: id, message: "two" });
    // branches
    await call("coder.gitCreateBranch", { projectId: id, name: "feature" });
    await call("coder.gitCheckout", { projectId: id, branch: "work" });
    // the resolve path's `merged` member: `feature` is at the same commit, so git resolves it by itself
    await call("coder.gitMergeResolve", { projectId: id, branch: "feature" });
    // the resolve path's `resolving` member: both sides change the same file
    run(repo, ["checkout", "-q", "feature"]);
    writeFileSync(join(repo, "c.txt"), "feature side\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "feature side"]);
    run(repo, ["checkout", "-q", "work"]);
    writeFileSync(join(repo, "c.txt"), "work side\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "work side"]);
    await call("coder.gitMergeResolve", { projectId: id, branch: "feature" });
    // …and the merge it left is finished once the conflict is staged
    writeFileSync(join(repo, "c.txt"), "both\n");
    run(repo, ["add", "c.txt"]);
    await call("coder.gitMergeContinue", { projectId: id });
    // abort: one more conflict, taken back
    run(repo, ["checkout", "-q", "feature"]);
    writeFileSync(join(repo, "c.txt"), "feature again\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "feature again"]);
    run(repo, ["checkout", "-q", "work"]);
    writeFileSync(join(repo, "c.txt"), "work again\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "work again"]);
    await handlers["coder.gitMergeResolve"]?.({ projectId: id, branch: "feature" }, { session: undefined });
    await call("coder.gitMergeAbort", { projectId: id });
    // `gitMerge`'s own answer: a branch that touches nothing this one does
    run(repo, ["checkout", "-qb", "side"]);
    writeFileSync(join(repo, "side.txt"), "side\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "side"]);
    run(repo, ["checkout", "-q", "work"]);
    await call("coder.gitMerge", { projectId: id, branch: "side" });
    // stash, sync
    writeFileSync(join(repo, "d.txt"), "stash me\n");
    await call("coder.gitStashPush", { projectId: id });
    await call("coder.gitStashPop", { projectId: id, index: 0 });
    await call("coder.gitStashPush", { projectId: id });
    await call("coder.gitStashDrop", { projectId: id, index: 0 });
    await call("coder.gitFetch", { projectId: id });
    await call("coder.gitPull", { projectId: id });

    const failures: string[] = [];
    for (const { method, answer } of shapes) {
      const parsed = RPC_SPECS[method].result.safeParse(answer);
      if (!parsed.success) {
        failures.push(`${method}: ${JSON.stringify(parsed.error.issues)} — answer keys ${JSON.stringify(Object.keys(answer as object))}`);
      }
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
    // Every git method in the table is covered, so a spec cannot drift unmeasured.
    const covered = new Set(shapes.map((s) => s.method));
    const all = Object.keys(RPC_SPECS).filter((m) => m.startsWith("coder.git")) as RpcMethod[];
    expect(all.filter((m) => !covered.has(m))).toEqual([]);
  }, 60_000);
});
