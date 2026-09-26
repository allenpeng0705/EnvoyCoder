/**
 * One-shot JSON-RPC over WebSocket to another EnvoyDev daemon.
 *
 * Used for team join, offer delivery, accept/refuse notify, and step progress.
 * Auth for LAN is via `preAuthMethods` + team/offer credentials in params —
 * not phone pairing tokens (`docs/envoydev-collaboration.md` §4).
 */

export interface PeerRpcCall {
  url: string;
  method: string;
  params: unknown;
  timeoutMs?: number;
}

export interface PeerRpcResult<T = unknown> {
  ok: true;
  result: T;
}

export interface PeerRpcFailure {
  ok: false;
  message: string;
  code?: string;
}

export type PeerRpcOutcome<T = unknown> = PeerRpcResult<T> | PeerRpcFailure;

type WsLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data?: unknown }) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: "close", listener: () => void): void;
};

export type PeerWsConnect = (url: string) => WsLike;

function defaultConnect(url: string): WsLike {
  const WS = (globalThis as unknown as { WebSocket: new (url: string) => WsLike }).WebSocket;
  return new WS(url);
}

/**
 * Call one method on a peer daemon, then close the socket.
 *
 * Injectable `connect` keeps unit tests off the network.
 */
export async function callPeerDaemon<T = unknown>(
  call: PeerRpcCall,
  options: { connect?: PeerWsConnect } = {},
): Promise<PeerRpcOutcome<T>> {
  const timeoutMs = call.timeoutMs ?? 8_000;
  const connect = options.connect ?? defaultConnect;
  const id = `peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    let settled = false;
    let socket: WsLike | undefined;
    const timer = setTimeout(() => {
      finish({ ok: false, message: `Peer did not answer within ${timeoutMs} ms` });
    }, timeoutMs);

    function finish(outcome: PeerRpcOutcome<T>): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      resolve(outcome);
    }

    try {
      socket = connect(call.url);
    } catch (error) {
      finish({ ok: false, message: `Could not reach peer: ${String(error)}` });
      return;
    }

    socket.addEventListener("open", () => {
      socket?.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: call.method,
          params: call.params ?? {},
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : "";
      if (!text) return;
      let parsed: {
        id?: unknown;
        result?: unknown;
        error?: { message?: string; code?: string | number; data?: { code?: string } };
      };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        return;
      }
      if (parsed.id !== id && String(parsed.id) !== id) return;
      if (parsed.error) {
        const msg =
          typeof parsed.error.message === "string" ? parsed.error.message : "Peer refused the call";
        const code =
          typeof parsed.error.data?.code === "string"
            ? parsed.error.data.code
            : typeof parsed.error.code === "string"
              ? parsed.error.code
              : undefined;
        finish({ ok: false, message: msg, ...(code ? { code } : {}) });
        return;
      }
      finish({ ok: true, result: parsed.result as T });
    });

    socket.addEventListener("error", () => {
      finish({ ok: false, message: `Connection to ${call.url} failed` });
    });

    socket.addEventListener("close", () => {
      if (!settled) finish({ ok: false, message: `Connection to ${call.url} closed before a reply` });
    });
  });
}
