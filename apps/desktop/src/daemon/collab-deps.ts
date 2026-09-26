/**
 * Shared deps for M5 collab handlers / runtime.
 */
import type { CoderPaths } from "@envoydev/host-bridge";
import type { CoderStore } from "./store.js";
import type { RunManager } from "./runs.js";
import type { MembershipHeartbeat } from "./membership-heartbeat.js";
import type { MemberPeerCall } from "./member-peer-call.js";

export interface CollabDeps {
  paths: CoderPaths;
  store: CoderStore;
  runs?: RunManager;
  /** Bound listen port — used to mint invites and hostHints. */
  port: number | (() => number);
  /** WebSocket path (default `/ws`). */
  wsPath?: string;
  /** Injectable peer RPC for tests (and production member-channel router). */
  callPeer?: MemberPeerCall;
  /**
   * Shared membership heartbeat — created once per daemon so join can refresh
   * and shutdown can stop. When absent, handlers create a lazy singleton.
   */
  membershipHeartbeat?: MembershipHeartbeat;
  /** Notify windows when a job ledger row changes. */
  onJobsChanged?: (jobId: string) => void;
}

