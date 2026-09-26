/**
 * Two real daemons — invite join, offer deliver, accept, heartbeat, origin stop.
 *
 * Uses `startCoderDaemon` on two homes and the real WebSocket peer RPC path
 * (preAuth team methods), which is the roadmap acceptance shape for M5.
 */

import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { coderPaths } from "@envoydev/host-bridge";

import { startCoderDaemon, type StartedCoderDaemon } from "../src/daemon/serve.js";

interface JsonRpcClient {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

async function connect(port: number): Promise<JsonRpcClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  let nextId = 1;
  const pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  socket.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    let msg: { id?: number | string; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return;
    }
    if (msg.id === undefined) return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message ?? "rpc error"));
    else waiter.resolve(msg.result);
  });
  return {
    call(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function boot(): Promise<{ daemon: StartedCoderDaemon; home: string; work: string }> {
  const home = await mkdtemp(join(tmpdir(), "envoy-m5-2d-"));
  const work = join(home, "repo");
  await mkdir(work, { recursive: true });
  const daemon = await startCoderDaemon({
    port: 0,
    home,
    paths: coderPaths(home),
    skipMeshAttach: true,
    isDirectory: async (path) => path.startsWith(home) || path.startsWith(tmpdir()),
  });
  cleanups.push(async () => {
    await daemon.stop();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return { daemon, home, work };
}

describe("M5 two-daemon path", () => {
  it("invite join → offer → accept → heartbeat → origin stop cancels inbound", async () => {
    const origin = await boot();
    const peer = await boot();
    const originClient = await connect(origin.daemon.port);
    const peerClient = await connect(peer.daemon.port);
    cleanups.push(async () => {
      originClient.close();
      peerClient.close();
    });

    const created = (await originClient.call("coder.createTeam", {
      label: "Desk",
    })) as { team: { id: string }; token: string; invite: string };
    expect(created.invite).toMatch(/^envoydev\.team\.v1\./);
    // Invite must name this origin's bound port (not a stale default).
    const { parseTeamInvite } = await import("../src/daemon/team-invite.js");
    const parsedInvite = parseTeamInvite(created.invite);
    expect(parsedInvite.originWs).toContain(`:${origin.daemon.port}`);

    const joined = (await peerClient.call("coder.joinTeam", {
      token: created.invite,
      label: "laptop",
      rolesOffered: ["implement", "review"],
    })) as { teamId: string; memberId: string; team: { label: string }; memberToken: string };
    expect(joined.teamId).toBe(created.team.id);
    expect(joined.team.label).toBe("Desk");
    expect(joined.memberToken.length).toBeGreaterThanOrEqual(16);

    const memberships = (await peerClient.call("coder.listTeamMemberships", {})) as {
      memberships: { teamId: string; originWs: string }[];
    };
    expect(memberships.memberships).toHaveLength(1);
    expect(memberships.memberships[0]!.originWs).toContain(`:${origin.daemon.port}`);

    // Heartbeat from peer keeps the member online on origin.
    const hb = (await peerClient.call("coder.teamHeartbeat", {
      teamId: joined.teamId,
      memberId: joined.memberId,
      token: created.token,
      memberToken: joined.memberToken,
    })) as { ok: true; connection: { status: string } };
    expect(hb.ok).toBe(true);
    expect(hb.connection.status).toBe("online");

    const status = (await originClient.call("coder.teamStatus", {
      teamId: created.team.id,
    })) as { board: { memberId: string; connection: { status: string } }[] };
    const peerRow = status.board.find((m) => m.memberId === joined.memberId);
    expect(peerRow?.connection.status).toBe("online");

    const job = (await originClient.call("coder.createJob", {
      teamId: created.team.id,
      title: "Across machines",
      goal: "prove M5",
      steps: [
        {
          role: "implement",
          brief: "touch a file",
          worktreeKey: "main",
          cwdHint: peer.work,
          assigneeMemberId: joined.memberId,
        },
      ],
    })) as { job: { id: string; steps: { id: string }[] } };

    // Offer — dials peer hostHints and delivers inbound offer.
    const offered = (await originClient.call("coder.offerJobStep", {
      jobId: job.job.id,
      stepId: job.job.steps[0]!.id,
      memberId: joined.memberId,
    })) as { status: string; offer?: { offerId: string; cancelNonce?: string } };
    expect(offered.status).toBe("offered");
    expect(offered.offer?.offerId).toBeTruthy();
    expect(offered.offer?.cancelNonce).toBeTruthy();

    const inbound = (await peerClient.call("coder.listInboundJobOffers", {})) as {
      offers: { offerId: string; brief: string }[];
    };
    expect(inbound.offers).toHaveLength(1);
    expect(inbound.offers[0]!.offerId).toBe(offered.offer!.offerId);

    // Control-plane accept (synthetic runId): real harness start needs a configured model and is
    // covered by daemon-rpc / run tests. Pre-auth accept still requires assignee + cancelNonce + memberToken.
    const accepted = (await originClient.call("coder.acceptJobStepOffer", {
      offerId: offered.offer!.offerId,
      resolvedCwd: peer.work,
      memberId: joined.memberId,
      teamToken: created.token,
      memberToken: joined.memberToken,
      cancelNonce: offered.offer!.cancelNonce,
      runId: "peer-run-synthetic",
    })) as { status: string; runId?: string };
    expect(accepted.status).toBe("accepted");
    expect(accepted.runId).toBe("peer-run-synthetic");

    const afterAccept = (await originClient.call("coder.getJob", {
      jobId: job.job.id,
    })) as { job: { steps: { status: string; resultRef?: string }[]; ledger: { message: string }[] } };
    expect(afterAccept.job.steps[0]!.status).toBe("running");
    expect(afterAccept.job.ledger.some((n) => /accepted/i.test(n.message))).toBe(true);

    // Origin stop must reach the peer (cancel inbound / run).
    const stopped = (await originClient.call("coder.stopJobStep", {
      jobId: job.job.id,
      stepId: job.job.steps[0]!.id,
      reason: "orchestrator-stop",
    })) as { job: { steps: { status: string }[] } };
    expect(stopped.job.steps[0]!.status).toBe("cancelled");

    const inboundAfter = (await peerClient.call("coder.listInboundJobOffers", {})) as {
      offers: unknown[];
    };
    // Pending list is empty after cancel.
    expect(inboundAfter.offers).toHaveLength(0);
  }, 30_000);

  it("peer accept → report succeeded → job done + finalReport", async () => {
    const origin = await boot();
    const peer = await boot();
    const originClient = await connect(origin.daemon.port);
    const peerClient = await connect(peer.daemon.port);
    cleanups.push(async () => {
      originClient.close();
      peerClient.close();
    });

    const created = (await originClient.call("coder.createTeam", {
      label: "Desk",
    })) as { team: { id: string }; token: string; invite: string };

    const joined = (await peerClient.call("coder.joinTeam", {
      token: created.invite,
      label: "laptop",
      rolesOffered: ["implement"],
    })) as { teamId: string; memberId: string; memberToken: string };

    await peerClient.call("coder.teamHeartbeat", {
      teamId: joined.teamId,
      memberId: joined.memberId,
      token: created.token,
      memberToken: joined.memberToken,
    });

    const job = (await originClient.call("coder.createJob", {
      teamId: created.team.id,
      title: "Finish across machines",
      goal: "done report",
      steps: [
        {
          role: "implement",
          brief: "ship it",
          worktreeKey: "main",
          cwdHint: peer.work,
          assigneeMemberId: joined.memberId,
        },
      ],
    })) as { job: { id: string; steps: { id: string }[] } };

    const offered = (await originClient.call("coder.offerJobStep", {
      jobId: job.job.id,
      stepId: job.job.steps[0]!.id,
      memberId: joined.memberId,
    })) as { status: string; offer?: { offerId: string; cancelNonce?: string } };
    expect(offered.status).toBe("offered");

    await originClient.call("coder.acceptJobStepOffer", {
      offerId: offered.offer!.offerId,
      resolvedCwd: peer.work,
      memberId: joined.memberId,
      teamToken: created.token,
      memberToken: joined.memberToken,
      cancelNonce: offered.offer!.cancelNonce,
        runId: "peer-run-done",
      });

    // Peer reports success to origin (team + member tokens) — proves §7.4 final report path.
    const done = (await originClient.call("coder.reportJobStepProgress", {
      jobId: job.job.id,
      stepId: job.job.steps[0]!.id,
      memberId: joined.memberId,
      teamToken: created.token,
      memberToken: joined.memberToken,
      runId: "peer-run-done",
      outcome: "succeeded",
      eventSeq: 0,
    })) as {
      ok: true;
      job: {
        status: string;
        finalReport?: { summary: string; failures: unknown[] };
        steps: { status: string }[];
      };
    };
    expect(done.job.steps[0]!.status).toBe("succeeded");
    expect(done.job.status).toBe("done");
    expect(done.job.finalReport?.summary).toMatch(/succeeded|All steps/i);
    expect(done.job.finalReport?.failures).toEqual([]);
  }, 30_000);
});
