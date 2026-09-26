/**
 * Peer → origin team heartbeats (§4.3–4.4).
 *
 * Without this, members age to offline after 3H even while the daemon is healthy.
 * Interval defaults to 15s (H in the design); injectable for tests.
 */

import { callPeerDaemon, type PeerRpcCall } from "./peer-rpc.js";
import { listMemberships, type TeamMembership } from "./memberships.js";

export type MembershipHeartbeatCall = (
  call: PeerRpcCall,
) => Promise<{ ok: true; result: unknown } | { ok: false; message: string }>;

export interface MembershipHeartbeat {
  /** Force one beat for every membership (tests / after join). */
  beatNow: () => Promise<void>;
  stop: () => void;
}

/**
 * Start a timer that presents each stored membership's token to its origin.
 * Call again after join — safe to call multiple times (restarts the timer).
 */
export function startMembershipHeartbeats(options: {
  membershipsFile: string;
  everyMs?: number;
  callPeer?: MembershipHeartbeatCall;
  /** When false, only `beatNow` works (used in unit tests). */
  auto?: boolean;
}): MembershipHeartbeat {
  const everyMs = options.everyMs ?? 15_000;
  const call = options.callPeer ?? callPeerDaemon;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function beatOne(m: TeamMembership): Promise<void> {
    await call({
      url: m.originWs,
      method: "coder.teamHeartbeat",
      params: {
        teamId: m.teamId,
        memberId: m.memberId,
        token: m.token,
        memberToken: m.memberToken,
        acceptPolicy: m.acceptPolicy,
      },
      timeoutMs: 5_000,
    });
  }

  async function beatNow(): Promise<void> {
    const memberships = await listMemberships(options.membershipsFile);
    for (const m of memberships) {
      try {
        await beatOne(m);
      } catch {
        /* next interval retries */
      }
    }
  }

  function stop(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  if (options.auto !== false) {
    timer = setInterval(() => {
      void beatNow();
    }, everyMs);
    // Unref so the timer does not keep a daemon process alive alone in tests.
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }
    void beatNow();
  }

  return { beatNow, stop };
}
