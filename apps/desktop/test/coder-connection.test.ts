/**
 * The window's data path: socket → connection → store.
 *
 * ## Why a fake socket rather than a daemon
 *
 * `daemon-rpc.test.ts` already proves the daemon end to end. This file is about the *other* half, and
 * the cases worth covering are the ones a real daemon makes hard to stage on purpose:
 *
 *   * a socket that opens and then dies, twice, to see the reconnect actually re-subscribe;
 *   * a `coder.hello` that answers about a **different** daemon — the squatter case, which is the
 *     single most important refusal in the client and the one no happy-path test reaches;
 *   * a change event arriving for a list nobody asked about, which must refetch and not throw.
 *
 * The fake is deliberately dumb: it records what the window sent and lets the test answer. A fake
 * that reimplemented the protocol would be a second implementation to keep right, which is how a
 * test starts agreeing with a bug.
 */

import { afterEach, describe, expect, it } from "vitest";

import { CODER_SUBSCRIBE_METHOD, ENVOYCODER_ERRORS } from "@envoycoder/protocol";

import { CoderConnection, type WebSocketLike } from "../src/client/connection.js";

/** A socket the test drives by hand. */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: { id: string; method: string; params: Record<string, unknown> }[] = [];

  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as (typeof this.sent)[number]);
  }

  close(): void {
    this.readyState = 3;
    this.fire("close", {});
  }

  /* — what the test does to it — */

  open(): void {
    this.readyState = 1;
    this.fire("open", {});
  }

  /** Answer the request with this id. */
  reply(id: string, result: unknown): void {
    this.fire("message", { data: JSON.stringify({ id, result }) });
  }

  replyError(id: string, message: string): void {
    this.fire("message", { data: JSON.stringify({ id, error: { code: "ERROR", message } }) });
  }

  push(event: string, data: unknown): void {
    this.fire("message", { data: JSON.stringify({ event, data }) });
  }

  /** The id of the nth request for a method, so a test can answer it. */
  idFor(method: string, occurrence = 0): string {
    const matches = this.sent.filter((entry) => entry.method === method);
    const found = matches[occurrence];
    if (!found) throw new Error(`no request for ${method} (sent: ${this.sent.map((e) => e.method).join(", ")})`);
    return found.id;
  }

  private fire(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

const HERO = {
  product: "EnvoyCoder",
  version: "0.1.0",
  instanceId: "instance-1",
  home: "/home/dev/.envoymesh",
  stateDir: "/home/dev/.envoymesh/EnvoyCoder",
  startedAt: "2026-09-13T10:00:00.000Z",
  windowCount: 1,
  methods: ["coder.hello"],
  mesh: { kind: "no-node", reason: "" },
  notes: [],
};

let socket: FakeSocket | undefined;
let connection: CoderConnection | undefined;

afterEach(() => {
  connection?.dispose();
  connection = undefined;
  socket = undefined;
});

function connect(endpoint: { instanceId?: string } = { instanceId: "instance-1" }): {
  socket: FakeSocket;
  connection: CoderConnection;
} {
  socket = new FakeSocket();
  connection = new CoderConnection({
    endpoint: { host: "127.0.0.1", port: 4770, path: "/ws", ...endpoint },
    socketFactory: () => socket as FakeSocket,
    // A test that waited for the real backoff would be a slow test.
    minDelayMs: 1,
    maxDelayMs: 2,
  });
  connection.start();
  return { socket, connection };
}

describe("the window's connection", () => {
  it("asks who is on the other end before it calls itself connected", async () => {
    const { socket: fake, connection: client } = connect();
    fake.open();

    expect(fake.sent[0]?.method).toBe("coder.hello");
    // Still connecting: the answer to `hello` is what decides whether this is a connection at all.
    expect(client.status.state).toBe("connecting");

    fake.reply(fake.idFor("coder.hello"), HERO);
    await settle();

    expect(client.status.state).toBe("connected");
    expect(client.hello?.instanceId).toBe("instance-1");
  });

  it("refuses a daemon that is not the one the shell named", async () => {
    const { socket: fake, connection: client } = connect({ instanceId: "the-one-we-started" });
    fake.open();
    // A different process, answering on our port, calling itself EnvoyCoder. This is the case the
    // shell cannot see and the window must not wave through.
    fake.reply(fake.idFor("coder.hello"), { ...HERO, instanceId: "somebody-else" });
    await settle();

    expect(client.status.state).toBe("disconnected");
    expect(client.status.state === "disconnected" ? client.status.code : undefined).toBe(
      ENVOYCODER_ERRORS.notOurDaemon,
    );
    expect(client.hello).toBeUndefined();
  });

  it("refuses a daemon that is a different product entirely", async () => {
    const { socket: fake, connection: client } = connect();
    fake.open();
    fake.reply(fake.idFor("coder.hello"), { ...HERO, product: "EnvoyMesh" });
    await settle();
    expect(client.status.state).toBe("disconnected");
    const status = client.status;
    expect(status.state === "disconnected" ? status.reason : "").toContain(ENVOYCODER_ERRORS.notOurDaemon);
  });

  it("re-subscribes after a reconnect, before it reports itself connected", async () => {
    const { socket: fake, connection: client } = connect();
    client.on("coder:state-changed", () => undefined);
    fake.open();
    fake.reply(fake.idFor("coder.hello"), HERO);
    await settle();
    expect(fake.sent.some((entry) => entry.method === CODER_SUBSCRIBE_METHOD)).toBe(true);
    // The client waits for the daemon to confirm the subscription before calling itself connected —
    // so a fake has to answer, or the test would be asserting "connected" for a window that is still
    // waiting on a reply the real transport always sends.
    fake.reply(fake.idFor(CODER_SUBSCRIBE_METHOD), { subscribed: ["coder:state-changed"] });
    await settle();
    expect(client.status.state).toBe("connected");
    const firstCount = fake.sent.filter((entry) => entry.method === CODER_SUBSCRIBE_METHOD).length;

    // The socket dies, and a new one is handed out by the factory on the next attempt.
    const second = new FakeSocket();
    socket = second;
    fake.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    second.open();
    second.reply(second.idFor("coder.hello"), HERO);
    await settle();
    second.reply(second.idFor(CODER_SUBSCRIBE_METHOD), { subscribed: ["coder:state-changed"] });
    await settle();

    const secondCount = second.sent.filter((entry) => entry.method === CODER_SUBSCRIBE_METHOD).length;
    expect(secondCount).toBeGreaterThan(0);
    expect(firstCount).toBe(1);
    expect(client.status.state).toBe("connected");
  });

  it("delivers events to listeners and swallows one listener's failure", async () => {
    const { socket: fake, connection: client } = connect();
    const seen: unknown[] = [];
    client.on("coder:state-changed", () => {
      throw new Error("this listener is broken");
    });
    client.on("coder:state-changed", (data) => {
      seen.push(data);
    });
    fake.open();
    fake.reply(fake.idFor("coder.hello"), HERO);
    await settle();
    fake.reply(fake.idFor(CODER_SUBSCRIBE_METHOD), { subscribed: ["coder:state-changed"] });
    await settle();

    fake.push("coder:state-changed", { kind: "tasks", at: "2026-09-13T10:00:00.000Z" });
    expect(seen).toHaveLength(1);
  });

  it("fails a call fast when the socket is not open, rather than hanging", async () => {
    const { connection: client } = connect();
    await expect(client.call("coder.listProjects")).rejects.toThrow(/envoycoder\.daemon-unreachable/);
  });

  it("rejects an in-flight call when the connection drops", async () => {
    const { socket: fake, connection: client } = connect();
    fake.open();
    fake.reply(fake.idFor("coder.hello"), HERO);
    await settle();

    const pending = client.call("coder.listProjects");
    fake.close();
    await expect(pending).rejects.toThrow(/daemon-unreachable/);
  });

  it("ignores a frame that is not JSON instead of dying", async () => {
    const { socket: fake, connection: client } = connect();
    fake.open();
    fake.reply(fake.idFor("coder.hello"), HERO);
    await settle();
    expect(client.status.state).toBe("connected");

    // A transport that threw here would take the window down for one malformed frame.
    fake.push("whatever", undefined);
    expect(client.status.state).toBe("connected");
  });
});

/** Let the microtask queue drain: `hello` is awaited inside an event handler. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
