/**
 * Member dial order + LAN / mesh / SSH probe (M5 off-LAN).
 */

import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureMemberDial,
  dialMember,
  dialOrderFor,
  extractWsFromMeshHint,
  preferMemberTransport,
} from "../src/daemon/member-dial.js";
import { createMemberPeerCall } from "../src/daemon/member-peer-call.js";
import {
  closeAllSshMemberTunnels,
  parseSshMemberHint,
  sshMemberTunnelCount,
} from "../src/daemon/ssh-member-tunnel.js";

afterEach(() => {
  configureMemberDial({ meshProbe: null, openSshTunnel: null });
  closeAllSshMemberTunnels();
});

describe("preferMemberTransport", () => {
  it("prefers LAN for ws:// hints, mesh for p2p, ssh for ssh:", () => {
    expect(preferMemberTransport("ws://192.168.1.2:4770/ws")).toBe("lan");
    expect(preferMemberTransport("/ip4/1.2.3.4/tcp/4001/p2p/Qm")).toBe("mesh");
    expect(preferMemberTransport("ssh:user@host")).toBe("ssh");
    expect(preferMemberTransport(undefined)).toBe("lan");
  });
});

describe("extractWsFromMeshHint", () => {
  it("pulls embedded ws URLs and multiaddr /ws hops", () => {
    expect(extractWsFromMeshHint("mesh:ws://relay.example:443/ws")).toBe("ws://relay.example:443/ws");
    expect(extractWsFromMeshHint("/dns4/relay.example/tcp/443/wss/p2p/Qm")).toBe(
      "wss://relay.example:443/ws",
    );
    expect(extractWsFromMeshHint("/ip4/10.0.0.2/tcp/4770/ws/p2p/Qm")).toBe("ws://10.0.0.2:4770/ws");
    expect(extractWsFromMeshHint("/ip4/1.2.3.4/tcp/4001/p2p/Qm")).toBeUndefined();
  });
});

describe("parseSshMemberHint", () => {
  it("parses user, host, ssh port, remote daemon port, and path", () => {
    expect(parseSshMemberHint("ssh:alice@box:2222/4770/ws")).toEqual({
      hint: "ssh:alice@box:2222/4770/ws",
      target: {
        host: "box",
        user: "alice",
        port: 2222,
        extraOptions: ["BatchMode=yes", "StrictHostKeyChecking=accept-new"],
      },
      remotePort: 4770,
      wsPath: "/ws",
    });
    expect(parseSshMemberHint("ssh:box")?.target.host).toBe("box");
    expect(parseSshMemberHint("ssh:box")?.remotePort).toBe(4770);
    expect(parseSshMemberHint("ws://x")).toBeUndefined();
  });
});

describe("dialOrderFor", () => {
  it("puts the preferred transport first then the rest of LAN→mesh→ssh", () => {
    expect(dialOrderFor("mesh:peer")).toEqual(["mesh", "lan", "ssh"]);
    expect(dialOrderFor("ws://h/ws")).toEqual(["lan", "mesh", "ssh"]);
  });
});

describe("dialMember", () => {
  it("treats local as online without probing", async () => {
    const probe = vi.fn(async () => false);
    const result = await dialMember({ memberId: "local" }, { probe });
    expect(result.reachable).toBe(true);
    expect(result.connection.transport).toBe("lan");
    expect(probe).not.toHaveBeenCalled();
  });

  it("probes LAN endpoints in order and reports online on success", async () => {
    const probe = vi.fn(async () => true);
    const result = await dialMember(
      { memberId: "peer-1", hostHints: "ws://10.0.0.2:4770/ws" },
      { probe },
    );
    expect(result.reachable).toBe(true);
    expect(result.connection.status).toBe("online");
    expect(result.connection.transport).toBe("lan");
    expect(probe).toHaveBeenCalledOnce();
  });

  it("probes mesh hints that embed a WebSocket hop", async () => {
    const probe = vi.fn(async () => true);
    const result = await dialMember(
      { memberId: "peer-1", hostHints: "mesh:ws://10.0.0.9:4770/ws" },
      { probe },
    );
    expect(result.reachable).toBe(true);
    expect(result.connection.transport).toBe("mesh");
    expect(probe).toHaveBeenCalledWith("ws://10.0.0.9:4770/ws", expect.any(Number));
  });

  it("marks pure /p2p/ mesh as connecting when no meshProbe is wired", async () => {
    const probe = vi.fn(async () => true);
    const result = await dialMember(
      { memberId: "peer-1", hostHints: "/ip4/1.2.3.4/tcp/4001/p2p/QmAbc" },
      { probe },
    );
    expect(result.reachable).toBe(false);
    expect(result.connection.status).toBe("connecting");
    expect(result.connection.transport).toBe("mesh");
    expect(result.connection.lastDialError).toBe("mesh-dial-pending");
  });

  it("reports online · mesh when meshProbe succeeds on a pure multiaddr", async () => {
    const meshProbe = vi.fn(async () => true);
    const result = await dialMember(
      { memberId: "peer-1", hostHints: "/ip4/1.2.3.4/tcp/4001/p2p/QmAbc" },
      { meshProbe, probe: async () => false },
    );
    expect(result.reachable).toBe(true);
    expect(result.connection.status).toBe("online");
    expect(result.connection.transport).toBe("mesh");
    expect(result.connection.endpoint).toBe("/ip4/1.2.3.4/tcp/4001/p2p/QmAbc");
    expect(meshProbe).toHaveBeenCalledOnce();
  });

  it("opens an SSH tunnel and probes the local ws URL", async () => {
    const openSshTunnel = vi.fn(async () => ({ localWsUrl: "ws://127.0.0.1:54321/ws" }));
    const probe = vi.fn(async (url: string) => url === "ws://127.0.0.1:54321/ws");
    const result = await dialMember(
      { memberId: "peer-1", hostHints: "ssh:alice@box/4770/ws" },
      { openSshTunnel, probe },
    );
    expect(result.reachable).toBe(true);
    expect(result.connection.transport).toBe("ssh");
    expect(result.connection.endpoint).toBe("ssh:alice@box/4770/ws");
    expect(openSshTunnel).toHaveBeenCalledWith("ssh:alice@box/4770/ws");
    expect(probe).toHaveBeenCalledWith("ws://127.0.0.1:54321/ws", expect.any(Number));
  });

  it("marks offline when every probe fails", async () => {
    const probe = vi.fn(async () => false);
    const result = await dialMember(
      { memberId: "peer-1", hostHints: "ws://10.0.0.2:4770/ws" },
      { probe },
    );
    expect(result.reachable).toBe(false);
    expect(result.connection.status).toBe("offline");
  });
});

describe("createMemberPeerCall", () => {
  it("routes ssh: hints through the tunnel opener then WebSocket RPC", async () => {
    const openSsh = vi.fn(async () => ({
      localWsUrl: "ws://127.0.0.1:9/ws",
      localPort: 9,
      stop: () => undefined,
    }));
    const connect = vi.fn(() => {
      const emitter = new EventEmitter();
      const socket = {
        send: vi.fn((data: string) => {
          const req = JSON.parse(data) as { id: string };
          setTimeout(() => {
            emitter.emit("message", {
              data: JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { ok: true } }),
            });
          }, 0);
        }),
        close: vi.fn(),
        addEventListener: (type: string, listener: (...args: unknown[]) => void) => {
          emitter.on(type, listener);
        },
      };
      setTimeout(() => emitter.emit("open"), 0);
      return socket;
    });

    const call = createMemberPeerCall({ openSsh, connect });
    const outcome = await call({
      url: "ssh:alice@box",
      method: "coder.teamHeartbeat",
      params: { teamId: "t", token: "tok" },
    });
    expect(openSsh).toHaveBeenCalledWith("ssh:alice@box");
    expect(outcome.ok).toBe(true);
  });

  it("routes pure /p2p/ hints through meshDial with the team token", async () => {
    const meshDial = vi.fn(async () => {
      throw new Error("dial should be invoked by callMeshHostRpc");
    });
    // Inject a meshDial that never succeeds — we only assert routing chose mesh and asked for a token.
    const call = createMemberPeerCall({ meshDial });
    const outcome = await call({
      url: "/ip4/1.2.3.4/tcp/4001/p2p/QmPeer",
      method: "coder.inboundJobStepOffer",
      params: { teamToken: "team-secret" },
      timeoutMs: 200,
    });
    expect(outcome.ok).toBe(false);
    expect(meshDial).toHaveBeenCalled();
  });
});

describe("openSshMemberTunnel (fake spawn)", () => {
  it("spawns ssh with a local forward and reuses the tunnel", async () => {
    const { openSshMemberTunnel } = await import("../src/daemon/ssh-member-tunnel.js");
    let allocate = 18000;
    const children: ChildProcess[] = [];
    const spawnSsh = vi.fn((args: string[]) => {
      expect(args).toContain("-N");
      expect(args.some((a) => a.startsWith("18000:127.0.0.1:"))).toBe(true);
      const child = new EventEmitter() as ChildProcess;
      (child as { killed: boolean }).killed = false;
      (child as { exitCode: number | null }).exitCode = null;
      child.kill = vi.fn(() => {
        (child as { killed: boolean }).killed = true;
        (child as { exitCode: number | null }).exitCode = 0;
        return true;
      }) as ChildProcess["kill"];
      children.push(child);
      return child;
    });

    const first = await openSshMemberTunnel("ssh:alice@box/4770/ws", {
      spawnSsh,
      allocatePort: async () => allocate++,
      readyMs: 10,
    });
    expect(first.localWsUrl).toBe("ws://127.0.0.1:18000/ws");
    const second = await openSshMemberTunnel("ssh:alice@box/4770/ws", {
      spawnSsh,
      allocatePort: async () => allocate++,
      readyMs: 10,
    });
    expect(second.localWsUrl).toBe(first.localWsUrl);
    expect(spawnSsh).toHaveBeenCalledOnce();
    expect(sshMemberTunnelCount()).toBe(1);
    closeAllSshMemberTunnels();
    expect(sshMemberTunnelCount()).toBe(0);
  });
});
