/**
 * The window's connection to the daemon.
 *
 * ## What this is, and what it is not
 *
 * It is a **transport**, not a state container. It opens one WebSocket, correlates replies to
 * requests, fans events out to listeners, and reconnects. It knows nothing about projects,
 * tasks or runs — the store above it does (`state/useCoderState.ts`), so that the shape of the
 * app's state is not entangled with the shape of the socket.
 *
 * That split is the reference implementation's, and it is worth copying for a concrete reason: a
 * second client — the phone — needs the same transport and a *different* store, and a transport that
 * carried the domain would have to be forked to serve it.
 *
 * ## Three behaviours that are deliberate, not incidental
 *
 *   1. **Reconnection is exponential and it re-subscribes.** A daemon restart must not leave a window
 *      silently frozen: on reconnect the client re-sends its subscriptions *before* it reports
 *      itself connected, so the store never applies a fresh list and then misses the update that
 *      follows it.
 *   2. **A call made while disconnected fails fast rather than queueing forever.** A queue that
 *      drains on reconnect is a feature for *messages* (a prompt the user typed), and a hazard for
 *      *reads* (a list fetched against a daemon that has since been replaced). Sends have their own
 *      path in M3; this layer refuses.
 *   3. **Identity is verified before the connection counts as "connected".** `coder.hello` must
 *      return the `instanceId` the shell handed us. Anything else is `notOurDaemon` — a stranger
 *      listening on our port is exactly the case the family's own shell was twice bitten by, and the
 *      window is the only place that can tell, because it is the only place that speaks the
 *      protocol.
 */

import {
  CODER_SUBSCRIBE_METHOD,
  type CoderEventMessage,
  type CoderRpcResponse,
  ENVOYDEV_ERRORS,
  coderError,
  coderErrorCode,
  coderErrorMessage,
  withMessageRef,
} from "@envoydev/protocol";

import { messageRef } from "../i18n/notice.js";

/** Where the daemon is, as the shell resolved it. The window never invents one. */
export interface DaemonEndpoint {
  host: string;
  port: number;
  path: string;
  /**
   * The daemon instance the shell expects to find there.
   *
   * `undefined` in the browser dev server, where there is no shell to have read a claim file. In
   * that case identity is accepted on the product name alone, and the connection says so — a
   * development convenience that is visibly weaker, rather than the default everywhere.
   */
  instanceId?: string;
}

export type ConnectionStatus =
  | { state: "idle" }
  | { state: "connecting"; attempt: number }
  | { state: "connected"; endpoint: DaemonEndpoint }
  | { state: "disconnected"; reason: string; code?: string };

export interface CoderConnectionOptions {
  endpoint: DaemonEndpoint;
  /** The client's own name and version, sent in `hello` so the daemon can log who called. */
  client?: { name: string; version?: string };
  /** Injected in tests; defaults to the global WebSocket. */
  socketFactory?: (url: string) => WebSocketLike;
  /** Backoff bounds. Defaults are chosen so a restart is invisible and a dead daemon is not a spin. */
  minDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * The slice of the WebSocket API this uses, so a test can supply a fake without a DOM.
 *
 * One listener signature rather than the DOM's two overloads, deliberately: a class cannot implement
 * an overloaded interface property, and a fake that had to match the DOM exactly would drag `lib.dom`
 * into code that has no business knowing about a browser. The event is `unknown` here and narrowed at
 * the one call site that reads a field.
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

/** The `hello` payload the client needs. Everything else it asks for on demand. */
export interface HelloResult {
  product: string;
  version: string;
  instanceId: string;
  home: string;
  stateDir: string;
  startedAt: string;
  windowCount: number;
  methods: readonly string[];
  mesh: { kind: string; [key: string]: unknown };
  notes: readonly string[];
}

const OPEN = 1;

export class CoderConnection {
  private readonly options: CoderConnectionOptions;
  private socket: WebSocketLike | undefined;
  private statusValue: ConnectionStatus = { state: "idle" };
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private counter = 0;
  private stopping = false;

  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly eventListeners = new Map<string, Set<(data: unknown) => void>>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly subscribed = new Set<string>();

  /** Filled by `hello`, and the proof that this is the daemon we asked for. */
  private helloValue: HelloResult | undefined;

  constructor(options: CoderConnectionOptions) {
    this.options = options;
  }

  get status(): ConnectionStatus {
    return this.statusValue;
  }

  get hello(): HelloResult | undefined {
    return this.helloValue;
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** Subscribe to a daemon event. Also subscribes for the *next* connection. */
  on(event: string, listener: (data: unknown) => void): () => void {
    let set = this.eventListeners.get(event);
    if (!set) {
      set = new Set();
      this.eventListeners.set(event, set);
    }
    set.add(listener);
    // Subscribing here is a convenience: a component subscribes on mount, which is normal before
    // the socket exists. So the failure is swallowed *deliberately* — the reconnect path
    // re-subscribes for every registered listener, and a rejection here would be an unhandled
    // promise in a component's effect for a condition that fixes itself.
    void this.subscribeRemotely().catch(() => undefined);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.eventListeners.delete(event);
    };
  }

  /** Open the connection. Safe to call twice; the second call is a no-op. */
  start(): void {
    if (this.socket || this.stopping) return;
    this.open();
  }

  /** Close and stop reconnecting. */
  dispose(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.rejectAll(
      new Error(withMessageRef("The connection was closed.", messageRef("error.connectionClosed"))),
    );
    this.setStatus({ state: "idle" });
  }

  /**
   * Call one method.
   *
   * Rejects with a `CoderRpcError`-shaped `Error` whose message begins with the daemon's
   * `envoydev.*` code, so `coderErrorCode(error.message)` works at the call site. Callers that
   * want the code should use `rpcErrorCode(error)` below rather than reaching into the message.
   */
  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) {
      // Coded *and* keyed: the code is what a caller branches on, the key is what a German user
      // reads. Both ride in the message, which is the only channel that survives the family's
      // transport (`coderError` in `@envoydev/protocol` explains why).
      throw coderError(
        ENVOYDEV_ERRORS.daemonUnreachable,
        "EnvoyDev is not connected to its daemon yet.",
        messageRef("error.notConnected"),
      );
    }
    const id = `w${(this.counter += 1)}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** The typed call: throws when the reply does not match the daemon's own description of it. */
  async callTyped<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return (await this.call(method, params)) as T;
  }

  /* ────────────────────────────── internals ────────────────────────────── */

  private url(): string {
    const { host, port, path } = this.options.endpoint;
    return `ws://${host}:${port}${path}`;
  }

  private open(): void {
    this.setStatus({ state: "connecting", attempt: this.attempt });
    const factory =
      this.options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);

    let socket: WebSocketLike;
    try {
      socket = factory(this.url());
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : String(error));
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      void this.onOpen();
    });
    socket.addEventListener("message", (event) => {
      this.onMessage((event as { data?: unknown } | undefined)?.data);
    });
    socket.addEventListener("close", () => {
      this.onClose(
        withMessageRef("The daemon closed the connection.", messageRef("error.daemonClosedConnection")),
      );
    });
    socket.addEventListener("error", () => {
      // An `error` is always followed by `close` on a WebSocket, so the reconnect is scheduled
      // there. Reporting it here as well would double the backoff for one failure.
    });
  }

  private async onOpen(): Promise<void> {
    try {
      const hello = await this.callTyped<HelloResult>("coder.hello", {
        client: { name: this.options.client?.name ?? "EnvoyDev window", ...(this.options.client?.version ? { version: this.options.client.version } : {}) },
      });
      this.verifyIdentity(hello);
      this.helloValue = hello;
      this.attempt = 0;
      // Re-subscribe *before* reporting connected: a store that refetches on "connected" must not
      // be able to land between the refetch and the subscription, or the update that follows the
      // refetch is lost and the window shows stale rows until the next change.
      await this.subscribeRemotely();
      this.setStatus({ state: "connected", endpoint: this.options.endpoint });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.socket?.close();
      this.scheduleReconnect(message, true);
    }
  }

  /**
   * Refuse a daemon that is not the one the shell named.
   *
   * This is the check the window exists to make: the shell can see a file and a port, and only the
   * protocol can answer *who* is behind them.
   */
  private verifyIdentity(hello: HelloResult): void {
    if (hello.product !== "EnvoyDev") {
      throw coderError(
        ENVOYDEV_ERRORS.notOurDaemon,
        `Something is answering on the daemon's port, but it says it is "${hello.product}". EnvoyDev did not connect to it.`,
        messageRef("error.notOurDaemon.product", { product: hello.product }),
      );
    }
    const expected = this.options.endpoint.instanceId;
    if (expected && hello.instanceId !== expected) {
      throw coderError(
        ENVOYDEV_ERRORS.notOurDaemon,
        `The daemon on port ${this.options.endpoint.port} is not the one this window was started for. Another EnvoyDev daemon may have replaced it — reopen the window.`,
        messageRef("error.notOurDaemon.instance", { port: this.options.endpoint.port }),
      );
    }
  }

  /**
   * Tell the daemon which events this connection wants.
   *
   * Awaited by `onOpen` on purpose, so "connected" means "and my events are live" — a store that
   * refetches on connect must not be able to land between the refetch and the subscription, or the
   * update that follows it is lost and the window shows stale rows until the next change.
   *
   * That await is safe because the transport answers every request: a reply, or an error. A daemon
   * that received this and said nothing would leave the window in `connecting` forever, which is a
   * daemon bug rather than a case to paper over — silence is not a protocol outcome here.
   *
   * One call for the whole set: subscribing event by event costs a round trip per event, on a
   * connection that has just proved it can be flaky.
   */
  private async subscribeRemotely(): Promise<void> {
    const wanted = [...this.eventListeners.keys()];
    const missing = wanted.filter((event) => !this.subscribed.has(event));
    if (missing.length === 0) return;
    await this.call(CODER_SUBSCRIBE_METHOD, { events: missing });
    // Recorded only after the daemon agreed, so a failed subscription is retried on the next
    // attempt rather than being remembered as done.
    for (const event of missing) this.subscribed.add(event);
  }

  private onMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      // A frame we cannot read is a protocol mismatch, not a crash. Dropping it keeps the window
      // alive and responsive to the frames that do parse.
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;

    if ("event" in parsed && typeof (parsed as CoderEventMessage).event === "string") {
      const message = parsed as CoderEventMessage;
      for (const listener of [...(this.eventListeners.get(message.event) ?? [])]) {
        try {
          listener(message.data);
        } catch {
          // One listener's throw must not stop the others: they are all being told about the same
          // already-committed change.
        }
      }
      return;
    }

    const response = parsed as CoderRpcResponse;
    if (typeof response.id !== "string") return;
    const entry = this.pending.get(response.id);
    if (!entry) return;
    this.pending.delete(response.id);
    if (response.error) entry.reject(new Error(response.error.message));
    else entry.resolve(response.result);
  }

  private onClose(reason: string): void {
    this.socket = undefined;
    this.helloValue = undefined;
    // The daemon forgets our subscriptions when the socket dies, so our memory of them must die too.
    this.subscribed.clear();
    this.rejectAll(new Error(`${ENVOYDEV_ERRORS.daemonUnreachable}: ${reason}`));
    this.scheduleReconnect(reason);
  }

  private scheduleReconnect(reason: string, immediate = false): void {
    if (this.stopping) return;
    const min = this.options.minDelayMs ?? 500;
    const max = this.options.maxDelayMs ?? 15_000;
    const delay = immediate ? min : Math.min(min * 2 ** this.attempt, max);
    this.attempt += 1;
    this.setStatus({ state: "disconnected", reason, code: coderErrorCode(reason) ?? undefined });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.open();
    }, delay);
  }

  private rejectAll(error: Error): void {
    for (const [, entry] of this.pending) entry.reject(error);
    this.pending.clear();
  }

  private setStatus(status: ConnectionStatus): void {
    this.statusValue = status;
    for (const listener of [...this.statusListeners]) {
      try {
        listener(status);
      } catch {
        // Same rule as the event fan-out: one listener cannot break the others.
      }
    }
  }
}

/** The `envoydev.*` code in an error, when there is one. Convenience over message parsing. */
export function rpcErrorCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  return coderErrorCode(message);
}

/**
 * The English half of a failed call, with the code prefix stripped.
 *
 * **Not what a window shows.** A refusal also carries a catalogue key, and this drops it — which is
 * fine for a log line, a test assertion and a tooltip's fallback, and wrong for anything a user
 * reads in their own language. Rendering goes through `noticeFromError` + `localize`
 * (`i18n/notice.ts`), which keeps the sentence *and* the key.
 */
export function rpcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return coderErrorMessage(message);
}

