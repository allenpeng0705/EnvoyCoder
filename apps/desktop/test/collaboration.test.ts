/**
 * Collaborative tasks (M5a / M5b): participants, handoffs, peer directory, offers.
 *
 * @vitest-environment node
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";
import type { RunEvent } from "@envoydev/protocol";

import { buildCollaboration, OfferBook } from "../src/daemon/collaboration.js";
import { forgetPeer, listPeers, registerPeer } from "../src/daemon/peers.js";
import { createCoderHandlers, type CoderHandler } from "../src/daemon/service.js";
import { CoderStore } from "../src/daemon/store.js";
import { RunManager } from "../src/daemon/runs.js";
import { buildTranscript } from "../src/state/transcript.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_AGENT = join(here, "fixtures", "fake-acp-agent.mjs");

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("buildCollaboration", () => {
  it("assigns roles and defaults active to the planner", () => {
    const collab = buildCollaboration({
      participants: [
        { id: "p1", kind: "agent", role: "plan", hostId: "local", harness: "envoy-harness" },
        { id: "p2", kind: "agent", role: "implement", hostId: "local", harness: "deepseek-harness" },
      ],
    });
    expect(collab.activeParticipantId).toBe("p1");
    expect(collab.participants).toHaveLength(2);
  });

  it("refuses two implementers on the same host", () => {
    expect(() =>
      buildCollaboration({
        participants: [
          { id: "a", kind: "agent", role: "implement", hostId: "local", harness: "envoy-harness" },
          { id: "b", kind: "agent", role: "implement", hostId: "local", harness: "deepseek-harness" },
        ],
      }),
    ).toThrow(/same host/);
  });
});

describe("peer directory", () => {
  it("registers, lists, and forgets peers", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-peers-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const stateDir = coderPaths(home).stateDir;
    expect(await listPeers(stateDir)).toEqual([]);
    const peer = await registerPeer(stateDir, { id: "workstation", label: "Workstation" });
    expect(peer.reachable).toBe(true);
    expect(await listPeers(stateDir)).toHaveLength(1);
    expect(await forgetPeer(stateDir, "workstation")).toBe(true);
    expect(await listPeers(stateDir)).toEqual([]);
  });
});

describe("coder collaboration RPC", () => {
  async function bench(): Promise<{
    call: (method: string, params?: unknown) => Promise<unknown>;
    taskId: string;
    runs: RunManager;
    events: RunEvent[];
  }> {
    const home = await mkdtemp(join(tmpdir(), "envoydev-collab-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });
    const project = await store.addProject({ path: home, label: "proj" });
    const task = await store.createTask({
      projectId: project.project.id,
      title: "collab",
      harness: "envoy-harness",
    });
    if (!task) throw new Error("createTask failed");
    const events: RunEvent[] = [];
    const runs = new RunManager({
      paths,
      store,
      onEvent: (event) => events.push(event),
      resolveLaunch: () => ({
        command: process.execPath,
        args: [FAKE_AGENT],
        cwd: home,
      }),
    });
    cleanups.push(() => runs.stopAll());
    const handlers = createCoderHandlers({
      store,
      paths,
      runs,
      instance: {
        instanceId: "collab-test",
        version: "0.1.0",
        startedAt: new Date().toISOString(),
        connectionCount: () => 1,
      },
      mesh: () => ({ kind: "no-node", reason: "not attached in this test" }),
    }) as Record<string, CoderHandler>;
    const call = async (method: string, params: unknown = {}) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`missing ${method}`);
      return handler(params, { session: undefined });
    };
    return { call, taskId: task.id, runs, events };
  }

  it("sets participants, hands off, and starts the active agent's harness", async () => {
    const b = await bench();
    const set = (await b.call("coder.setTaskCollaboration", {
      taskId: b.taskId,
      participants: [
        { id: "plan", kind: "agent", role: "plan", hostId: "local", harness: "envoy-harness" },
        {
          id: "impl",
          kind: "agent",
          role: "implement",
          hostId: "local",
          harness: "deepseek-harness",
        },
      ],
    })) as { task: { collaboration?: { activeParticipantId?: string } } };
    expect(set.task.collaboration?.activeParticipantId).toBe("plan");

    const handed = (await b.call("coder.handoffTask", {
      taskId: b.taskId,
      toParticipantId: "impl",
      brief: "Ship the fix.",
    })) as {
      task: { collaboration?: { activeParticipantId?: string; lastHandoff?: { brief?: string } } };
    };
    expect(handed.task.collaboration?.activeParticipantId).toBe("impl");
    expect(handed.task.collaboration?.lastHandoff?.brief).toBe("Ship the fix.");

    const started = (await b.call("coder.startRun", {
      taskId: b.taskId,
      prompt: "go",
    })) as { run: { harness: string; hostId: string } };
    expect(started.run.harness).toBe("deepseek-harness");
    expect(started.run.hostId).toBe("local");

    // Give the async record() of run.handoff a tick.
    await new Promise((r) => setTimeout(r, 100));
    const handoff = b.events.find((e) => e.kind === "run.handoff");
    expect(handoff && handoff.kind === "run.handoff" ? handoff.brief : undefined).toBe("Ship the fix.");
  });

  it("refuses an offer to an unreachable peer with a named policy", async () => {
    const b = await bench();
    await b.call("coder.registerPeer", {
      id: "desk-b",
      label: "Desk B",
      reachable: false,
    });
    await b.call("coder.setTaskCollaboration", {
      taskId: b.taskId,
      participants: [
        { id: "plan", kind: "agent", role: "plan", hostId: "local", harness: "envoy-harness" },
        { id: "remote", kind: "peer", role: "implement", hostId: "desk-b" },
      ],
      activeParticipantId: "remote",
    });
    const result = (await b.call("coder.offerParticipantRun", {
      taskId: b.taskId,
      participantId: "remote",
      prompt: "implement please",
    })) as { status: string; policy?: string };
    expect(result).toEqual({ status: "refused", policy: "peer-unreachable" });
  });

  it("offers to a reachable peer and accepts on this daemon", async () => {
    const b = await bench();
    // Peer participants inherit the task harness when theirs is unset; use an agent that needs no model.
    await b.call("coder.updateTask", { id: b.taskId, harness: "deepseek-harness" });
    await b.call("coder.registerPeer", { id: "desk-b", label: "Desk B", reachable: true });
    await b.call("coder.setTaskCollaboration", {
      taskId: b.taskId,
      participants: [
        { id: "plan", kind: "agent", role: "plan", hostId: "local", harness: "deepseek-harness" },
        { id: "remote", kind: "peer", role: "implement", hostId: "desk-b", harness: "deepseek-harness" },
      ],
    });
    const offered = (await b.call("coder.offerParticipantRun", {
      taskId: b.taskId,
      participantId: "remote",
      prompt: "hi",
    })) as { status: string; offerId?: string };
    expect(offered.status).toBe("offered");
    expect(offered.offerId).toBeTruthy();

    const accepted = (await b.call("coder.acceptParticipantOffer", {
      offerId: offered.offerId,
    })) as { status: string };
    expect(accepted.status).toBe("accepted");
  });
});

describe("run.handoff in the transcript", () => {
  it("renders a handoff note", () => {
    const transcript = buildTranscript([
      {
        runId: "r1",
        taskId: "t1",
        at: "2026-09-13T10:00:00.000Z",
        seq: 1,
        kind: "run.handoff",
        toId: "impl",
        role: "implement",
        brief: "Do the thing.",
      },
    ]);
    expect(transcript.entries[0]).toMatchObject({
      kind: "note",
      notice: { key: "run.handoff.brief", values: { role: "implement", brief: "Do the thing." } },
    });
  });
});

describe("OfferBook", () => {
  it("refuses a second answer", () => {
    const book = new OfferBook();
    const offer = book.create({
      taskId: "t",
      participantId: "p",
      prompt: "x",
      peerId: "peer",
    });
    book.refuse(offer.id, "owner-policy");
    expect(() => book.accept(offer.id)).toThrow(/already answered/);
  });
});
